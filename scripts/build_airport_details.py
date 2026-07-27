#!/usr/bin/env python3
"""Airport details pack — runways and frequencies, best available source first.

The pilots this app is for fly out of small and medium fields, so the data for
those has to be as good as the data for the majors. Three sources, in order of
authority, each field taking the best one that covers it:

  FAA   NASR 28-day subscription (APT + FRQ). Official, current, and it covers
        the non-towered fields OurAirports is thinnest on — CTAF and UNICOM for
        9,300+ US facilities. This is the differentiator: a 2,500 ft strip in
        Alabama gets the same quality of data as KMIA.
  AIP   COCESNA eAIP ENR 2.1/2.2 frequencies, for the CENAMER FIR. Small in
        volume but authoritative, and it fills fields OurAirports has nothing
        for (MGMM). It also cross-checks: every tower frequency it publishes
        agrees with the OurAirports value.
  OA    OurAirports, community-maintained, worldwide. The base layer, and the
        only source outside the two above.

Each entry records which source it came from and, for NASR, the cycle date, so
the app can show it. Anything outside the VHF aeronautical band is dropped
whatever the source: the community data carries occasional typos (an approach
frequency of 32.71 MHz), and a wrong frequency is worse than a missing one.

Output: src/data/geo/airport_details.json
  {"KMIA": {"s": "FAA", "f": [["Tower", 118.3], …],
            "r": [["08L","26R",8600,"ASPH",87], …]}, …,
   "_meta": {"cycles": {...}}}
"""
import csv, json, os, re, sys, urllib.request
from datetime import date, timedelta

# Downloads are cached here between runs. Override with AVIARA_CACHE; the
# default keeps the builders working identically on a laptop and on CI, where
# no session scratch directory exists.
CACHE = os.environ.get('AVIARA_CACHE') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE, exist_ok=True)


SCRATCH = CACHE
OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/geo'

NASR_BASE = 'https://nfdc.faa.gov/webContent/28DaySub/extra'

# NASR runs on the 28-day AIRAC-aligned cycle. Rather than pin a date that goes
# stale every four weeks, work it out: 9 Jul 2026 was an effective date, and
# every cycle since is a multiple of 28 days from it. The FAA publishes the
# next cycle ahead of time, so "current" means the latest one already in force.
NASR_EPOCH = date(2026, 7, 9)


def current_cycle(today=None):
    today = today or date.today()
    n = (today - NASR_EPOCH).days // 28
    return NASR_EPOCH + timedelta(days=28 * n)


def cycle_tag(d):
    return d.strftime('%d_%b_%Y')


NASR_CYCLE = os.environ.get('NASR_CYCLE') or cycle_tag(current_cycle())
OA_BASE = 'https://davidmegginson.github.io/ourairports-data'

VHF_LO, VHF_HI = 108.0, 137.0


def fetch(path, url):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f'downloading {os.path.basename(path)}…')
        urllib.request.urlretrieve(url, path)
    return path


def fetch_nasr(name, subset):
    """Download a NASR subset for the current cycle, stepping back a cycle if
    the FAA has not posted it — better a four-week-old official file than a
    failed build that leaves the app on data months older."""
    global NASR_CYCLE
    for back in (0, 1):
        tag = os.environ.get('NASR_CYCLE') or cycle_tag(current_cycle() - timedelta(days=28 * back))
        path = f'{SCRATCH}/nasr/{tag}_{name}'
        try:
            fetch(path, f'{NASR_BASE}/{tag}_{subset}_CSV.zip')
            NASR_CYCLE = tag
            return path
        except Exception as exc:                      # noqa: BLE001 - any HTTP failure
            print(f'  {tag} {subset}: {exc}')
            if os.path.exists(path):
                os.remove(path)
    raise SystemExit(f'NASR {subset} not available for this cycle or the last')


def unzip(zip_path, dest):
    if not os.path.isdir(dest):
        import zipfile
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(dest)
    return dest


def num(x):
    try:
        return int(float(x))
    except (TypeError, ValueError):
        return None


def in_band(mhz):
    return mhz is not None and VHF_LO <= mhz <= VHF_HI


def add_freq(entry, label, mhz, seen):
    key = (label, round(mhz, 3))
    if key in seen:
        return
    seen.add(key)
    entry.setdefault('f', []).append([label, round(mhz, 3)])


# ── which airports we care about (same key set as airports.json) ──
known = {a[0] for a in json.load(open(f'{OUT}/airports.json'))['airports']}
details, sources = {}, {}

# ── 1. OurAirports base ───────────────────────────────────────────
oa_fq = fetch(f'{SCRATCH}/airport-frequencies.csv', f'{OA_BASE}/airport-frequencies.csv')
oa_rw = fetch(f'{SCRATCH}/runways.csv', f'{OA_BASE}/runways.csv')

OA_LABEL = {
    'TWR': 'Tower', 'GND': 'Ground', 'CLD': 'Clearance Delivery', 'APP': 'Approach',
    'DEP': 'Departure', 'A/D': 'Approach/Departure', 'ATIS': 'ATIS', 'CTAF': 'CTAF',
    'UNIC': 'UNICOM', 'AFIS': 'AFIS', 'CNTR': 'Center', 'RDO': 'Radio', 'ARR': 'Arrival',
    'AWOS': 'AWOS', 'ASOS': 'ASOS', 'ATF': 'ATF', 'FSS': 'FSS', 'RMP': 'Ramp',
    'EMRG': 'Emergency', 'OPS': 'Operations', 'MISC': 'Other',
}

oa_dropped = 0
seen_by_apt = {}
for row in csv.DictReader(open(oa_fq, encoding='utf-8')):
    ident = row['airport_ident']
    if ident not in known:
        continue
    try:
        mhz = float(row['frequency_mhz'])
    except ValueError:
        continue
    if not in_band(mhz):
        oa_dropped += 1
        continue
    e = details.setdefault(ident, {})
    add_freq(e, OA_LABEL.get(row['type'], row['type']), mhz, seen_by_apt.setdefault(ident, set()))
    sources[ident] = 'OA'

for row in csv.DictReader(open(oa_rw, encoding='utf-8')):
    ident = row['airport_ident']
    if ident not in known or row['closed'] == '1':
        continue
    details.setdefault(ident, {}).setdefault('r', []).append([
        row['le_ident'], row['he_ident'], num(row['length_ft']),
        (row['surface'] or '')[:12], num(row['le_heading_degT']),
    ])
    sources.setdefault(ident, 'OA')

print(f'OurAirports base: {len(details)} fields ({oa_dropped} out-of-band frequencies dropped)')

# ── 2. FAA NASR override (United States) ──────────────────────────
apt_zip = fetch_nasr('apt.zip', 'APT')
frq_zip = fetch_nasr('frq.zip', 'FRQ')
apt_dir = unzip(apt_zip, f'{SCRATCH}/nasr/{NASR_CYCLE}_apt')
frq_dir = unzip(frq_zip, f'{SCRATCH}/nasr/{NASR_CYCLE}_frq')

# FAA ident -> the key airports.json uses (ICAO where the field has one)
site_key, faa_to_key = {}, {}
for row in csv.DictReader(open(f'{apt_dir}/APT_BASE.csv', encoding='utf-8', errors='replace')):
    if row['ARPT_STATUS'] != 'O':          # closed or permanently shut
        continue
    # OurAirports keys many US fields by a K-prefixed form of the FAA ident
    # (0J0 -> K0J0), so that spelling has to be tried too or every one of them
    # silently keeps the community data instead of the FAA's.
    faa = row['ARPT_ID']
    for cand in (row['ICAO_ID'], faa, f'K{faa}' if len(faa) == 3 else ''):
        if cand and cand in known:
            site_key[row['SITE_NO']] = cand
            faa_to_key[row['ARPT_ID']] = cand
            break

# FREQ_USE is a terse operational code; only the ones a pilot tunes are kept.
# Procedure-specific entries (one row per STAR/SID) would bury the useful ones.
FAA_LABEL = [
    (re.compile(r'^D-?ATIS'), 'D-ATIS'),
    (re.compile(r'^ATIS'), 'ATIS'),
    (re.compile(r'^CTAF'), 'CTAF'),
    (re.compile(r'^UNICOM'), 'UNICOM'),
    (re.compile(r'^LCL'), 'Tower'),
    (re.compile(r'^GND'), 'Ground'),
    (re.compile(r'^CD'), 'Clearance Delivery'),
    (re.compile(r'^APCH.*DEP'), 'Approach/Departure'),
    (re.compile(r'^APCH'), 'Approach'),
    (re.compile(r'^DEP'), 'Departure'),
    (re.compile(r'^CLASS [BCD]'), 'Approach'),
    (re.compile(r'^EMERG'), 'Emergency'),
    # Automated weather is written as "<ident> AWOS-3PT" / "ASOS", so the
    # ident prefix has to be allowed. These are the frequencies that matter
    # most at the non-towered fields this pack is aimed at.
    (re.compile(r'(^|\s)AWOS'), 'AWOS'),
    (re.compile(r'(^|\s)AWSS'), 'AWSS'),
    (re.compile(r'(^|\s)ASOS'), 'ASOS'),
    (re.compile(r'^RAMP CTL'), 'Ramp'),
]

faa_fields, faa_freqs = set(), 0
new_freqs = {}
for row in csv.DictReader(open(f'{frq_dir}/FRQ.csv', encoding='utf-8', errors='replace')):
    key = faa_to_key.get(row['SERVICED_FACILITY'])
    if not key:
        continue
    m = re.match(r'([\d.]+)', row['FREQ'] or '')
    if not m:
        continue
    mhz = float(m.group(1))
    if not in_band(mhz):
        continue                            # UHF military pairs, mostly
    use = (row['FREQ_USE'] or '').upper().strip()
    label = next((lbl for rx, lbl in FAA_LABEL if rx.search(use)), None)
    if not label:
        continue
    new_freqs.setdefault(key, []).append((label, mhz))
    faa_fields.add(key)
    faa_freqs += 1

# NASR replaces the OurAirports frequency list wholesale for fields it covers —
# merging two lists of the same frequencies under different labels would read
# as duplicates.
for key, pairs in new_freqs.items():
    seen = set()
    entry = details.setdefault(key, {})
    entry['f'] = []
    for label, mhz in sorted(pairs, key=lambda p: (p[0], p[1])):
        add_freq(entry, label, mhz, seen)
    sources[key] = 'FAA'

# Runways from NASR: length/surface from APT_RWY, true heading per end from
# APT_RWY_END — surveyed rather than computed.
rwy_end = {}
for row in csv.DictReader(open(f'{apt_dir}/APT_RWY_END.csv', encoding='utf-8', errors='replace')):
    rwy_end[(row['SITE_NO'], row['RWY_ID'], row['RWY_END_ID'])] = row

faa_rwys = 0
rwy_by_key = {}
for row in csv.DictReader(open(f'{apt_dir}/APT_RWY.csv', encoding='utf-8', errors='replace')):
    key = site_key.get(row['SITE_NO'])
    if not key:
        continue
    length = num(row['RWY_LEN'])
    # NASR carries helipads and other non-runway surfaces in the same table;
    # a 75 ft "runway" or an "00X" designator is not something you line up on.
    if not length or length < 500 or 'X' in (row['RWY_ID'] or ''):
        continue
    ends = (row['RWY_ID'] or '').split('/')
    le, he = (ends + ['', ''])[:2]
    if le.startswith('H'):
        continue
    hdg = None
    end = rwy_end.get((row['SITE_NO'], row['RWY_ID'], le))
    if end:
        hdg = num(end.get('TRUE_ALIGNMENT'))
    rwy_by_key.setdefault(key, []).append([
        le, he, length, (row['SURFACE_TYPE_CODE'] or '')[:12], hdg,
    ])
    faa_rwys += 1

for key, rwys in rwy_by_key.items():
    details.setdefault(key, {})['r'] = rwys
    sources.setdefault(key, 'FAA')

print(f'FAA NASR {NASR_CYCLE}: {len(faa_fields)} fields with frequencies '
      f'({faa_freqs} kept), {faa_rwys} runways over {len(rwy_by_key)} fields')

# ── 3. COCESNA eAIP supplement (CENAMER) ──────────────────────────
# The eAIP publishes frequencies per *airspace*, and one airspace row can list
# several units and several airports: the LA AURORA control-zone row carries
# MGGT TWR 118.1 and SAN JOSE 118.5 side by side. Taking every frequency in a
# row and labelling it with the row's airport produced exactly the failure this
# pack exists to avoid — La Aurora tower on San Jose's frequency.
#
# So only two shapes are accepted, both unambiguous in the text itself:
#   "MGGT TWR 118.1"    ident + unit + frequency, adjacent
#   "TIKAL APP 121.4"   a published callsign mapped by hand to its field
CALLSIGN = {
    'TIKAL APP': ('MGMM', 'Approach'),
}
UNIT = {'TWR': 'Tower', 'APP': 'Approach', 'GND': 'Ground', 'ATIS': 'ATIS'}
IDENT_FREQ = re.compile(r'\b([A-Z]{4})\s+(TWR|APP|GND|ATIS)\s+(\d{3}\.\d{1,3})\s*MHZ')
CALL_FREQ = re.compile(r'\b(' + '|'.join(re.escape(k) for k in CALLSIGN) + r')\s+(\d{3}\.\d{1,3})\s*MHZ')

def aip_claims(body):
    """(ident, label, mhz) the text states outright — nothing inferred."""
    for ident, unit, mhz in IDENT_FREQ.findall(body):
        yield ident, UNIT[unit], float(mhz)
    for call, mhz in CALL_FREQ.findall(body):
        ident, label = CALLSIGN[call]
        yield ident, label, float(mhz)

aip_added, aip_agree, aip_conflict = 0, 0, []
for doc in ('CS-ENR-2.1.html', 'CS-ENR-2.2.html'):
    path = os.path.join(SCRATCH, 'cocesna', doc)
    if not os.path.exists(path):
        print(f'  (skipping {doc} — run build_cenamer_airspace.py first)')
        continue
    body = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', open(path, encoding='utf-8', errors='replace').read()))
    for ident, label, mhz in aip_claims(body):
        if ident not in known or not in_band(mhz):
            continue
        entry = details.setdefault(ident, {})
        if any(abs(f[1] - mhz) < 0.001 for f in entry.get('f', [])):
            aip_agree += 1
            continue
        same = [f for f in entry.get('f', []) if f[0] == label]
        if same:
            aip_conflict.append((ident, label, same[0][1], mhz))
            entry['f'] = [f for f in entry['f'] if f[0] != label]
        add_freq(entry, label, mhz, seen_by_apt.setdefault(ident, set()))
        aip_added += 1
        if sources.get(ident) != 'FAA':
            sources[ident] = 'AIP'

print(f'COCESNA eAIP: {aip_added} frequencies added, {aip_agree} already held and confirmed, '
      f'{len(aip_conflict)} corrected against the AIP')
for ident, label, old, mhz in aip_conflict:
    print(f'   {ident} {label}: held {old}, AIP says {mhz} — AIP wins')

# ── write ─────────────────────────────────────────────────────────
for ident, entry in details.items():
    entry['s'] = sources.get(ident, 'OA')
    if 'f' in entry:
        entry['f'].sort(key=lambda f: (f[0], f[1]))

details['_meta'] = {'cycles': {'FAA': NASR_CYCLE.replace('_', ' '), 'AIP': 'COCESNA 2026-07-09'}}

dest = f'{OUT}/airport_details.json'
json.dump(details, open(dest, 'w'), separators=(',', ':'))
by_src = {}
for s in sources.values():
    by_src[s] = by_src.get(s, 0) + 1
print(f'\nairport details: {len(details) - 1} fields '
      f'({by_src.get("FAA", 0)} FAA, {by_src.get("AIP", 0)} eAIP, {by_src.get("OA", 0)} OurAirports) '
      f'-> {os.path.getsize(dest)/1e6:.2f} MB')
