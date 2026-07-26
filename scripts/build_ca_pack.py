#!/usr/bin/env python3
"""Central America navdata pack — parses COCESNA's consolidated eAIP
(CENAMER FIR: Guatemala, El Salvador, Honduras, Nicaragua, Costa Rica,
Belize) into AVIARA's navdata files.

Inputs (download first, see URLS below):
  scratch/cocesna/CS-ENR-3.1.html   lower ATS routes
  scratch/cocesna/CS-ENR-3.2.html   upper ATS routes
  scratch/cocesna/CS-ENR-4.4.html   5-letter significant points

Outputs (merged in place, idempotent):
  src/data/navdata/fixes.json      + CA fixes (kept as dup-coords if a US
                                     ident collides — 5LNC are globally
                                     unique in practice)
  src/data/navdata/airways.json    + variants with loc "CA" (existing CA
                                     variants replaced on re-run)

URLS (AIRAC cycle in the path — bump per cycle):
  https://www.cocesna.org/aipca/AIP_2657/Eurocontrol/COCESNA/2026-07-09-NON%20AIRAC/html/eAIP/ES-CS-ENR-3.1-es-ES.html  (etc.)
"""
import json, os, re, sys

SCRATCH = "/private/tmp/claude-501/-Users-oliout-Desktop-CC-projects-AVIARA-APP/cc1f0f2f-31a5-48ef-ab87-7f9423836159/scratchpad/cocesna"
OUT = sys.argv[1] if len(sys.argv) > 1 else "src/data/navdata"

COORD_RE = re.compile(r'(\d{6}(?:\.\d+)?)([NS])\D{0,40}?(\d{7}(?:\.\d+)?)([EW])', re.S)
ROUTE_ID_RE = re.compile(r'^[A-Z]{1,2}\d{1,4}$')
NAME_RE = re.compile(r'^[A-Z]{3,5}$')

def dms(v, hemi, lon=False):
    # DDMMSS(.s) lat / DDDMMSS(.s) lon — degrees are everything above MMSS
    v = float(v)
    deg = int(v // 10000)
    rest = v - deg * 10000
    mins = int(rest // 100)
    secs = rest - mins * 100
    dec = deg + mins / 60 + secs / 3600
    return round(-dec if hemi in 'SW' else dec, 5)

def strip_tags(html):
    return re.sub(r'<[^>]+>', ' ', html)

def parse_routes(path):
    """Yield (route_id, [(name, lat, lon)], [lower_limit_ft|None per segment]).

    The eAIP HTML has unbalanced/nested rows, so row-level parsing is
    unreliable. Instead, stream position-ordered tokens over the whole doc:
      - designator cells:  <td><p><span>UL200</span></p>
      - waypoints:         <span>NAME</span></a> … <span>DDMMSSN</span> <span>DDDMMSSW</span>
      - altitude tokens:   FL290 / 19500 FT  (last one before a waypoint is
                           that segment's lower limit — the MEA equivalent)
    """
    t = open(path, encoding='utf-8', errors='replace').read()

    events = []
    for m in re.finditer(r'<td[^>]*>\s*<p[^>]*>\s*<span[^>]*>\s*([A-Z]{1,2}\d{1,4})\s*</span>\s*</p>', t):
        events.append((m.start(), 'des', m.group(1)))
    # Waypoints: anchor on the coordinate pair, then back-scan for the
    # nearest preceding 3-5 letter ident span — fixes link to ENR 4.4 but
    # VOR points (SJO, AUR, CAT…) have a different structure, so anchoring
    # on the name misses them.
    for m in re.finditer(
            r'<span[^>]*>\s*(\d{6}(?:\.\d+)?)([NS])\s*</span>\s*'
            r'<span[^>]*>\s*(\d{7}(?:\.\d+)?)([EW])\s*</span>', t, re.S):
        back = t[max(0, m.start() - 400):m.start()]
        names = re.findall(r'<span[^>]*>\s*([A-Z]{3,5})\s*</span>', back)
        if not names:
            continue
        events.append((m.start(), 'wpt', (names[-1], *m.groups())))
    for m in re.finditer(r'FL\s*(\d{2,3})|(\d{3,5})\s*FT', t):
        val = int(m.group(1)) * 100 if m.group(1) else int(m.group(2))
        events.append((m.start(), 'alt', val))
    # Magnetic tracks: each segment prints forward°/reverse° — the FIRST one
    # seen after a waypoint is the charted forward track.
    for m in re.finditer(r'<span[^>]*>\s*(\d{1,3}(?:\.\d+)?)°\s*</span>', t):
        events.append((m.start(), 'trk', float(m.group(1))))
    events.sort(key=lambda e: e[0])

    out = []
    route_id, pts, seg_lo, seg_trk, pending_lo, pending_trk = None, [], [], [], None, None

    def flush():
        nonlocal route_id, pts, seg_lo, seg_trk, pending_lo, pending_trk
        if route_id and len(pts) >= 2:
            out.append((route_id, pts, seg_lo, seg_trk))
        route_id, pts, seg_lo, seg_trk, pending_lo, pending_trk = None, [], [], [], None, None

    for _, kind, data in events:
        if kind == 'des':
            flush()
            route_id = data
        elif kind == 'wpt' and route_id:
            name, la, lah, lo, loh = data
            if pts:
                seg_lo.append(pending_lo)
                seg_trk.append(round(pending_trk) if pending_trk is not None else None)
                pending_lo = None
                pending_trk = None
            pts.append((name, dms(la, lah), dms(lo, loh, lon=True)))
        elif kind == 'alt' and route_id:
            pending_lo = data
        elif kind == 'trk' and route_id and pending_trk is None:
            pending_trk = data
    flush()
    return out

def parse_points(path):
    """ENR 4.4 — 5-letter significant points: yield (name, lat, lon)."""
    t = open(path, encoding='utf-8', errors='replace').read()
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S):
        m = COORD_RE.search(strip_tags(row))
        if not m:
            continue
        names = re.findall(r'<span[^>]*>\s*([A-Z]{5})\s*</span>', row)
        if not names:
            continue
        yield names[0], dms(m.group(1), m.group(2)), dms(m.group(3), m.group(4), lon=True)

# ── Parse ────────────────────────────────────────────────────────
routes = {}   # id -> (pts, seg_lo) ; keep the longest chain if repeated
for f in ('CS-ENR-3.1.html', 'CS-ENR-3.2.html'):
    for rid, pts, seg_lo, seg_trk in parse_routes(os.path.join(SCRATCH, f)):
        if rid not in routes or len(pts) > len(routes[rid][0]):
            routes[rid] = (pts, seg_lo, seg_trk)

ca_fixes = {}
for name, lat, lon in parse_points(os.path.join(SCRATCH, 'CS-ENR-4.4.html')):
    ca_fixes[name] = [lat, lon]
# Airway points not in ENR 4.4 (VOR endpoints appear in navaids already;
# 4-5 letter fix points get added from route tables too)
for pts, _, _ in routes.values():
    for name, lat, lon in pts:
        if len(name) == 5 and name not in ca_fixes:
            ca_fixes[name] = [lat, lon]

# ── Merge ────────────────────────────────────────────────────────
fixes = json.load(open(f'{OUT}/fixes.json'))
added_fix = 0
for name, coord in ca_fixes.items():
    if name not in fixes:
        fixes[name] = coord
        added_fix += 1
    else:
        cur = fixes[name]
        cand = cur if isinstance(cur[0], list) else [cur]
        if not any(abs(c[0]-coord[0]) < 0.02 and abs(c[1]-coord[1]) < 0.02 for c in cand):
            fixes[name] = cand + [coord]
json.dump(fixes, open(f'{OUT}/fixes.json', 'w'), separators=(',', ':'))

airways = json.load(open(f'{OUT}/airways.json'))
for rid, (pts, seg_lo, seg_trk) in routes.items():
    variants = [v for v in airways.get(rid, []) if v.get('loc') != 'CA']
    mea = (seg_lo + [None] * len(pts))[:len(pts) - 1]
    trk = (seg_trk + [None] * len(pts))[:len(pts) - 1]
    variants.append({'loc': 'CA', 'pts': [p[0] for p in pts], 'mea': mea, 'trk': trk})
    airways[rid] = variants
json.dump(airways, open(f'{OUT}/airways.json', 'w'), separators=(',', ':'))

print(f'CA routes: {len(routes)} | CA fixes: {len(ca_fixes)} (added {added_fix} new)')
print(f'fixes.json: {os.path.getsize(f"{OUT}/fixes.json")/1e6:.2f} MB | airways.json: {os.path.getsize(f"{OUT}/airways.json")/1e6:.2f} MB')
ex = routes.get('UL200') or next(iter(routes.values()))
print('UL200:', [p[0] for p in ex[0]][:12], 'MEAs:', ex[1][:8])
