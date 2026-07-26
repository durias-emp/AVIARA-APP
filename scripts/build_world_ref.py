#!/usr/bin/env python3
"""World reference airway layer (TIER 2) — global airway geometry for the
regions AVIARA has no authoritative pack for.

Source: X-Plane's earth_awy.dat, descended from Robin Peel's community
navigation database and distributed under GPL v3 (redistribution permitted,
including commercially, with the copyright notice preserved). Mirror:
https://github.com/mcantsin/x-plane-navdata

*** THIS DATA IS NOT CURRENT (cycle 2012.08). *** It exists to give the map
continuous worldwide structure for orientation. It is drawn in a distinct
lighter style, labelled as reference, and is deliberately NOT loaded by the
route planner: airways here cannot be expanded into a filed route. Tier 1
(FAA NASR / COCESNA / SENEAM) remains the only navigational source.

Output: src/data/navdata/world_ref.json
  {"lines": [[[lat,lon],...], ...], "hi": [bool, ...]}
Coordinates rounded to 3 dp (~100 m) — plenty for a reference backdrop and
keeps the file small.
"""
import json, os, re, sys
from collections import defaultdict

SCRATCH = "/private/tmp/claude-501/-Users-oliout-Desktop-CC-projects-AVIARA-APP/cc1f0f2f-31a5-48ef-ab87-7f9423836159/scratchpad"
OUT = sys.argv[1] if len(sys.argv) > 1 else "src/data/navdata"

# Boxes already covered by an authoritative pack — Tier 2 stays out of them
# so the map never mixes current and stale data in the same airspace.
COVERED = [
    (24.0, 50.0, -125.0, -66.0),   # CONUS   (FAA NASR)
    (51.0, 72.0, -170.0, -129.0),  # Alaska  (FAA NASR)
    (18.0, 23.0, -161.0, -154.0),  # Hawaii  (FAA NASR)
    (14.0, 33.0, -118.0, -86.0),   # Mexico  (SENEAM)
    (5.0, 19.5, -93.0, -77.0),     # CENAMER (COCESNA)
]

def covered(la, lo):
    return any(a <= la <= b and c <= lo <= d for a, b, c, d in COVERED)

src = os.path.join(SCRATCH, 'xp_awy.dat')
if not os.path.exists(src):
    sys.exit(f'missing {src} — download earth_awy.dat first')

# Group segments per airway so we can stitch them into continuous polylines
segs = defaultdict(list)   # (airway, hi) -> [((lat1,lon1),(lat2,lon2))]
for line in open(src, encoding='utf-8', errors='replace'):
    p = line.split()
    if len(p) < 10:
        continue
    try:
        la1, lo1, la2, lo2 = float(p[1]), float(p[2]), float(p[4]), float(p[5])
        layer = int(p[6])          # 1 = low, 2 = high, 3 = both
    except ValueError:
        continue
    if covered(la1, lo1) and covered(la2, lo2):
        continue
    if abs(la1) > 90 or abs(la2) > 90:
        continue
    a = (round(la1, 3), round(lo1, 3))
    b = (round(la2, 3), round(lo2, 3))
    if a == b:
        continue
    for hi in ([False, True] if layer == 3 else [layer == 2]):
        segs[(p[-1], hi)].append((a, b))

# Stitch each airway's segments into runs (chains sharing endpoints)
lines, his = [], []
for (awy, hi), pairs in segs.items():
    nxt = defaultdict(list)
    for a, b in pairs:
        nxt[a].append(b)
    used = set()
    for a, b in pairs:
        if (a, b) in used:
            continue
        chain = [a, b]
        used.add((a, b))
        cur = b
        while nxt.get(cur):
            step = next((x for x in nxt[cur] if (cur, x) not in used), None)
            if step is None:
                break
            used.add((cur, step))
            chain.append(step)
            cur = step
        if len(chain) >= 2:
            lines.append([list(p) for p in chain])
            his.append(hi)

data = {'lines': lines, 'hi': his,
        'note': 'X-Plane/Robin Peel airway data, GPL v3, cycle 2012.08 — reference only, not current'}
path = f'{OUT}/world_ref.json'
json.dump(data, open(path, 'w'), separators=(',', ':'))
print(f'world reference: {len(lines)} polylines '
      f'({sum(his)} high / {len(his)-sum(his)} low) -> {os.path.getsize(path)/1e6:.2f} MB')
