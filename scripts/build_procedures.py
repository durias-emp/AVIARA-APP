"""SIDs and STARs, from the FAA's CIFP.

A filed route rarely starts at a fix. It starts with a procedure — CWARD2,
CAMRN5 — a published, named departure or arrival that packs a paragraph of
clearance into one word. Until now the app could show those names but not draw
them, because procedures are a separate product from the fixes, navaids and
airways the navdata carries. This is that product.

The source is the FAA's Coded Instrument Flight Procedures file, ARINC 424
fixed-width records, republished on the same 28-day cycle as everything else.

WHAT IS KEPT, AND WHAT IS DELIBERATELY NOT

In ARINC 424 every leg is a path and a terminator: not "go to this fix" but
"how you fly" plus "what ends it". Most legs (91% across the SID/STAR set) end
at a named fix — TF, IF, DF, CF and friends — and those have real geometry we
can draw. The rest do not. VA is "fly a heading until an altitude"; VM is "fly
a heading until vectors"; FM is "from a fix on a course until ATC turns you".
Where those legs go depends on the temperature, the aircraft's climb rate and
what the controller says. There is no line to draw, and drawing one anyway
would be inventing the most safety-critical part of a departure.

So fix-terminated legs are kept as ident sequences and everything else is
counted, not guessed. Each transition carries `u`: how many of its legs cannot
be drawn, so the app can say so rather than quietly present a partial path as
a complete one.

No coordinates are stored. Every ident resolves against the navdata the app
already carries — of 10,328 idents referenced, 20 are absent, and those are
airports rather than fixes. The pack is therefore a routing table, not a
geometry file, which is why it stays small.

Output: src/data/navdata/procedures.json
    { "_meta": {...},
      "KCRQ": { "CWARD2": { "t": "SID",
                            "c": ["GYWNN","PADRZ","CWARD"],      # common
                            "e": {"SLI": ["MADOW","SLI"]},       # enroute transitions
                            "r": {"RW10B": [...]},               # runway transitions
                            "u": 0 } } }                         # undrawable legs
"""
import collections
import json
import os
import re
import sys
import urllib.request
import zipfile

from faa_cycle import CACHE, cycle_tag, current_cycle

CIFP_LIST = ('https://www.faa.gov/air_traffic/flight_info/aeronav/'
             'digital_products/cifp/download/')

# A leg that ends at a named fix has geometry; the others end at an altitude,
# an intercept or a controller's instruction, and have none.
FIX_TERMINATED = {'IF', 'TF', 'DF', 'CF', 'AF', 'RF'}

# ARINC 424 route types. The meaning inverts between a departure and an
# arrival — a SID's enroute transition is where you leave it, a STAR's is
# where you join — which is the sort of thing worth stating rather than
# leaving as three bare tuples.
SID_KIND = {'1': 'r', '4': 'r', 'F': 'r',      # runway transition
            '2': 'c', '5': 'c', 'M': 'c',      # common portion
            '3': 'e', '6': 'e', 'S': 'e'}      # enroute transition
STAR_KIND = {'1': 'e', '4': 'e', 'F': 'e',
             '2': 'c', '5': 'c', 'M': 'c',
             '3': 'r', '6': 'r', 'S': 'r'}


def fetch_cifp(cache=None):
    """Download the current CIFP, stepping back a cycle if the FAA has not
    posted it yet. Returns (zip_path, cycle_tag)."""
    cache = cache or CACHE
    os.makedirs(os.path.join(cache, 'cifp'), exist_ok=True)
    req = urllib.request.Request(CIFP_LIST, headers={'User-Agent': 'AVIARA-App/1.0'})
    with urllib.request.urlopen(req, timeout=60) as r:
        html = r.read().decode('utf-8', 'ignore')
    # CIFP_YYMMDD.zip, newest last once sorted — the FAA lists the current
    # cycle and the next one as soon as it is available.
    urls = sorted(set(re.findall(r'href="([^"]*CIFP_(\d{6})\.zip)"', html)))
    if not urls:
        raise SystemExit('no CIFP download link found on the FAA page')

    wanted = current_cycle().strftime('%y%m%d')
    for url, tag in reversed(urls):
        if tag > wanted:
            continue                      # a future cycle, not yet effective
        path = os.path.join(cache, 'cifp', f'CIFP_{tag}.zip')
        if not os.path.exists(path):
            print(f'  downloading CIFP_{tag}…')
            urllib.request.urlretrieve(url, path)
        return path, tag
    raise SystemExit('no effective CIFP cycle available')


def parse(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        name = next(n for n in z.namelist() if n.startswith('FAACIFP'))
        with z.open(name) as f:
            lines = f.read().decode('latin-1').splitlines()

    # (airport, proc) -> {'t': 'SID', kind -> transition -> [seq, fix], 'u': n}
    procs = {}
    undrawable = collections.Counter()
    for rec in lines:
        if len(rec) < 50 or rec[4] != 'P' or rec[12] not in 'DE':
            continue
        airport = rec[6:10].strip()
        ident = rec[13:19].strip()
        if not airport or not ident:
            continue
        is_sid = rec[12] == 'D'
        table = SID_KIND if is_sid else STAR_KIND
        kind = table.get(rec[19])
        if kind is None:
            # RNAV variants (T, V) carry no documented route type here; the
            # transition's own name says what it is — RW09 is a runway, a
            # five-letter fix is an enroute transition.
            trans_raw = rec[20:25].strip()
            kind = 'r' if trans_raw.startswith('RW') else 'c' if trans_raw in ('', 'ALL') else 'e'

        key = (airport, ident)
        entry = procs.setdefault(key, {'t': 'SID' if is_sid else 'STAR',
                                       'c': [], 'e': {}, 'r': {}, 'u': 0})
        trans = rec[20:25].strip()
        seq = rec[26:29].strip()
        fix = rec[29:34].strip()
        pt = rec[47:49].strip()

        if pt not in FIX_TERMINATED or not fix:
            entry['u'] += 1
            undrawable[pt or '??'] += 1
            continue

        if kind == 'c':
            entry['c'].append((seq, fix))
        else:
            entry[kind].setdefault(trans or 'ALL', []).append((seq, fix))

    # Order every leg list by its sequence number and drop the numbers, then
    # collapse consecutive repeats: a transition normally restates the fix the
    # common portion ended on, and a route reading "CWARD CWARD" is noise.
    def finish(pairs):
        out = []
        for _seq, fix in sorted(pairs, key=lambda p: p[0]):
            if not out or out[-1] != fix:
                out.append(fix)
        return out

    data = {}
    for (airport, ident), entry in procs.items():
        rec = {'t': entry['t'], 'c': finish(entry['c'])}
        for kind in ('e', 'r'):
            trans = {k: finish(v) for k, v in entry[kind].items()}
            trans = {k: v for k, v in trans.items() if v}
            if trans:
                rec[kind] = trans
        if entry['u']:
            rec['u'] = entry['u']
        if not rec['c'] and 'e' not in rec and 'r' not in rec:
            continue                       # nothing drawable at all
        data.setdefault(airport, {})[ident] = rec
    return data, undrawable


def build(out_path):
    zip_path, tag = fetch_cifp()
    data, undrawable = parse(zip_path)

    sids = sum(1 for a in data.values() for p in a.values() if p['t'] == 'SID')
    stars = sum(1 for a in data.values() for p in a.values() if p['t'] == 'STAR')
    out = {'_meta': {'source': 'FAA CIFP (ARINC 424)', 'cycle': tag,
                     'airports': len(data), 'sids': sids, 'stars': stars,
                     'undrawable_legs': sum(undrawable.values())}}
    out.update(dict(sorted(data.items())))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)

    size = os.path.getsize(out_path) / 1024
    print(f'procedures: {sids} SIDs and {stars} STARs at {len(data)} airports, '
          f'cycle {tag} ({size:.0f} KB)')
    print(f'  legs with no fixed geometry, kept as counts: '
          f'{sum(undrawable.values())} — {dict(undrawable.most_common(6))}')
    return len(data)


if __name__ == '__main__':
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = (sys.argv[1] if len(sys.argv) > 1
            else os.path.join(here, 'src/data/navdata/procedures.json'))
    build(dest)
