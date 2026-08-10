#!/usr/bin/env python3
"""Runway geometry pack — where each runway physically is, end to end.

`airport_details.json` already carries what a runway IS (designators, length,
surface, alignment). This pack carries where it LIES: the surveyed latitude and
longitude of both thresholds, plus the width, so the app can draw the runway on
the map at the size and angle it really is, instead of an approximation spun out
from the airport reference point.

That distinction matters. An ARP is the centroid of the whole field, so runways
drawn outward from it all cross at one point, which is right for a single-strip
aerodrome and wrong for everywhere else. Thresholds are surveyed points.

Two sources, in the same order of authority the details pack uses:

  FAA   NASR APT_RWY_END, LAT_DECIMAL / LONG_DECIMAL. Surveyed threshold
        coordinates for every open US runway, with the end elevation and true
        alignment alongside.
  OA    OurAirports runways.csv, community-maintained, worldwide. The only
        source outside the US, and the one that covers MSSS and MSLP.

Every entry records which of the two it came from, because the app may never
present community data as though a state authority had published it.

Geometry that does not agree with itself is dropped rather than drawn. If the
distance between the two published thresholds disagrees with the published
runway length by more than 20 percent, one of the three figures is wrong and
there is no way to tell which, so the runway keeps its row in the details pack
and simply gets no shape here. A runway drawn in the wrong place is worse than
a runway not drawn.

Output: src/data/geo/runway_geometry.json
  {"MSSS": {"s": "OA",
            "r": [["15","33",13.70850,-89.12450,13.69050,-89.11530,7349,148,1]]},
   …,
   "_meta": {"cycles": {...}, "fields": [...]}}

Each runway row is:
  [le_ident, he_ident, le_lat, le_lon, he_lat, he_lon, length_ft, width_ft, lit]

Lit is 1 / 0 / null (unknown). Length and width may be null where the source
does not publish them; the shape does not depend on either.
"""
import csv, json, math, os, sys, urllib.request
from datetime import date, timedelta

CACHE = os.environ.get('AVIARA_CACHE') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE, exist_ok=True)

SCRATCH = CACHE
OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/geo'

NASR_BASE = 'https://nfdc.faa.gov/webContent/28DaySub/extra'
NASR_EPOCH = date(2026, 7, 9)
OA_BASE = 'https://davidmegginson.github.io/ourairports-data'

# Beyond this the published length and the distance between the published
# thresholds are telling two different stories, and neither can be trusted.
TOLERANCE = 0.20
TOLERANCE_FLOOR_FT = 200


def current_cycle(today=None):
    today = today or date.today()
    n = (today - NASR_EPOCH).days // 28
    return NASR_EPOCH + timedelta(days=28 * n)


def cycle_tag(d):
    return d.strftime('%d_%b_%Y')


NASR_CYCLE = os.environ.get('NASR_CYCLE') or cycle_tag(current_cycle())


def fetch(path, url):
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print(f'downloading {os.path.basename(path)}…')
        urllib.request.urlretrieve(url, path)
    return path


def fetch_nasr(name, subset):
    """Current cycle, or the one before it if the FAA has not posted it yet."""
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


def dec(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def feet_between(a_lat, a_lon, b_lat, b_lon):
    r = math.pi / 180
    # 20,902,231 ft is the earth's mean radius; a great circle is plenty at
    # runway scale and avoids pulling in a projection library.
    dlat = (b_lat - a_lat) * r
    dlon = (b_lon - a_lon) * r
    s = (math.sin(dlat / 2) ** 2
         + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin(dlon / 2) ** 2)
    return 2 * 20902231 * math.asin(min(1.0, math.sqrt(s)))


def plausible(a_lat, a_lon, b_lat, b_lon, length_ft):
    """The two thresholds and the published length must agree."""
    if None in (a_lat, a_lon, b_lat, b_lon):
        return False
    span = feet_between(a_lat, a_lon, b_lat, b_lon)
    if span < 300:                                    # a helipad, or two copies
        return False                                  # of the same point
    if not length_ft:
        return True                                   # nothing to disagree with
    slack = max(TOLERANCE_FLOOR_FT, length_ft * TOLERANCE)
    return abs(span - length_ft) <= slack


known = {a[0] for a in json.load(open(f'{OUT}/airports.json'))['airports']}
geom, sources, elev = {}, {}, {}
rejected = {'OA': 0, 'FAA': 0}

# ── 0. Field elevation ────────────────────────────────────────────
# airports.json stops at the name, so the elevation a pilot reads off the top
# of an aerodrome chart is not otherwise in the app. It rides along here rather
# than in a pack of its own: it is one number per field, it is wanted at
# exactly the moment this pack is, and the sources are the same two.
oa_apt = fetch(f'{SCRATCH}/airports_oa.csv', f'{OA_BASE}/airports.csv')
for row in csv.DictReader(open(oa_apt, encoding='utf-8')):
    if row['ident'] in known:
        e = num(row['elevation_ft'])
        if e is not None:
            elev[row['ident']] = e

# ── 1. OurAirports base, worldwide ────────────────────────────────
oa_rw = fetch(f'{SCRATCH}/runways.csv', f'{OA_BASE}/runways.csv')

for row in csv.DictReader(open(oa_rw, encoding='utf-8')):
    ident = row['airport_ident']
    if ident not in known or row['closed'] == '1':
        continue
    a_lat, a_lon = dec(row['le_latitude_deg']), dec(row['le_longitude_deg'])
    b_lat, b_lon = dec(row['he_latitude_deg']), dec(row['he_longitude_deg'])
    length = num(row['length_ft'])
    if not plausible(a_lat, a_lon, b_lat, b_lon, length):
        if None not in (a_lat, a_lon, b_lat, b_lon):
            rejected['OA'] += 1
        continue
    lit = 1 if row['lighted'] == '1' else 0
    geom.setdefault(ident, []).append([
        row['le_ident'], row['he_ident'],
        round(a_lat, 5), round(a_lon, 5), round(b_lat, 5), round(b_lon, 5),
        length, num(row['width_ft']), lit,
    ])
    sources[ident] = 'OA'

print(f'OurAirports: {sum(len(v) for v in geom.values())} runways over {len(geom)} fields '
      f'({rejected["OA"]} rejected: thresholds disagree with published length)')

# ── 2. FAA NASR override, United States ───────────────────────────
apt_zip = fetch_nasr('apt.zip', 'APT')
apt_dir = unzip(apt_zip, f'{SCRATCH}/nasr/{NASR_CYCLE}_apt')

site_key = {}
for row in csv.DictReader(open(f'{apt_dir}/APT_BASE.csv', encoding='utf-8', errors='replace')):
    if row['ARPT_STATUS'] != 'O':
        continue
    faa = row['ARPT_ID']
    for cand in (row['ICAO_ID'], faa, f'K{faa}' if len(faa) == 3 else ''):
        if cand and cand in known:
            site_key[row['SITE_NO']] = cand
            e = num(row['ELEV'])
            if e is not None:
                elev[cand] = e
            break

# Thresholds, keyed the way APT_RWY names its two ends.
rwy_end = {}
for row in csv.DictReader(open(f'{apt_dir}/APT_RWY_END.csv', encoding='utf-8', errors='replace')):
    rwy_end[(row['SITE_NO'], row['RWY_ID'], row['RWY_END_ID'])] = row

faa_geom = {}
for row in csv.DictReader(open(f'{apt_dir}/APT_RWY.csv', encoding='utf-8', errors='replace')):
    key = site_key.get(row['SITE_NO'])
    if not key:
        continue
    length = num(row['RWY_LEN'])
    # Same exclusions the details pack applies: helipads and other non-runway
    # surfaces share this table, and a 75 ft "runway" is not one.
    if not length or length < 500 or 'X' in (row['RWY_ID'] or ''):
        continue
    ends = (row['RWY_ID'] or '').split('/')
    le, he = (ends + ['', ''])[:2]
    if le.startswith('H'):
        continue
    a = rwy_end.get((row['SITE_NO'], row['RWY_ID'], le))
    b = rwy_end.get((row['SITE_NO'], row['RWY_ID'], he))
    if not a or not b:
        continue
    a_lat, a_lon = dec(a.get('LAT_DECIMAL')), dec(a.get('LONG_DECIMAL'))
    b_lat, b_lon = dec(b.get('LAT_DECIMAL')), dec(b.get('LONG_DECIMAL'))
    if not plausible(a_lat, a_lon, b_lat, b_lon, length):
        if None not in (a_lat, a_lon, b_lat, b_lon):
            rejected['FAA'] += 1
        continue
    lgt = (row['RWY_LGT_CODE'] or '').strip().upper()
    lit = None if not lgt else (0 if lgt == 'NSTD' or lgt == 'NONE' else 1)
    faa_geom.setdefault(key, []).append([
        le, he,
        round(a_lat, 5), round(a_lon, 5), round(b_lat, 5), round(b_lon, 5),
        length, num(row['RWY_WIDTH']), lit,
    ])

# NASR replaces the community geometry wholesale for a field it covers, rather
# than merging: two sources describing the same strip a few metres apart would
# draw the runway twice.
for key, rwys in faa_geom.items():
    geom[key] = rwys
    sources[key] = 'FAA'

print(f'FAA NASR {NASR_CYCLE}: {sum(len(v) for v in faa_geom.values())} runways over '
      f'{len(faa_geom)} fields ({rejected["FAA"]} rejected)')

# ── write ─────────────────────────────────────────────────────────
out = {}
for ident, rwys in geom.items():
    if not rwys:
        continue
    entry = {'s': sources[ident], 'r': rwys}
    if ident in elev:
        entry['e'] = elev[ident]
    out[ident] = entry

out['_meta'] = {
    'cycles': {'FAA': NASR_CYCLE.replace('_', ' '), 'OA': 'OurAirports, rebuilt with this pack'},
    'fields': ['le', 'he', 'leLat', 'leLon', 'heLat', 'heLon', 'lengthFt', 'widthFt', 'lit'],
    'e': 'field elevation, ft',
}

dest = f'{OUT}/runway_geometry.json'
json.dump(out, open(dest, 'w'), separators=(',', ':'))
by_src = {}
for s in sources.values():
    by_src[s] = by_src.get(s, 0) + 1
print(f'\nrunway geometry: {len(out) - 1} fields '
      f'({by_src.get("FAA", 0)} FAA, {by_src.get("OA", 0)} OurAirports) '
      f'-> {os.path.getsize(dest)/1e6:.2f} MB')
