#!/usr/bin/env python3
"""Mexico navdata pack — parses the AIP de Mexico (SENEAM) ENR 3.1/3.2 ATS
route tables into AVIARA's navdata files.

The official portal (aipmexico.seneam.gob.mx) refuses automated requests, so
the PDFs come from the public eAIP mirror at edgardos.com.mx/eAIP/manual.html.
Unlike COCESNA's Eurocontrol HTML, Mexico publishes PDF, so this reads the
text layer with pdfplumber and streams position-ordered tokens:

  designator   B-646            (route id, hyphenated in the chart)
  waypoint     ▲ NAME           or  ▲ VOR MERIDA (MID)
               230501N 0884702W (coordinates on the following line)
  altitudes    18000 / 4000     upper then lower — lower is the MEA
  distance     30               standalone 1-3 digit number between fixes

Outputs (merged in place, idempotent): fixes.json + airways.json variants
tagged loc "MX".
"""
import json, os, re, sys

SCRATCH = "/private/tmp/claude-501/-Users-oliout-Desktop-CC-projects-AVIARA-APP/cc1f0f2f-31a5-48ef-ab87-7f9423836159/scratchpad/mx"
OUT = sys.argv[1] if len(sys.argv) > 1 else "src/data/navdata"

try:
    import pdfplumber
except ImportError:
    sys.exit("pip install pdfplumber")


def dms(v, hemi):
    v = float(v)
    deg = int(v // 10000)
    rest = v - deg * 10000
    return round((-1 if hemi in 'SW' else 1) * (deg + int(rest // 100) / 60 + (rest - int(rest // 100) * 100) / 3600), 5)


def parse_pdf(path):
    """Return [(route_id, [(name, lat, lon)], [mea|None per segment])]."""
    text = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text.append(page.extract_text() or '')
    # Drop page furniture: headers, footers, AIRAC/amendment lines and dates
    # all carry 4-digit numbers that would otherwise read as altitudes.
    JUNK = re.compile(r'(AIP DE MEX|AIRAC|AMDT|SCT-DGAC|SENEAM|^ENR \d|\d{2}-[A-Z]{3}-\d{4})')
    t = '\n'.join(l for l in '\n'.join(text).split('\n') if not JUNK.search(l))

    events = []
    # Route designator: "B-646", "UM-783", "UJ-2" — hyphenated in the chart,
    # stored the ICAO way (B646).
    for m in re.finditer(r'\b([A-Z]{1,2})-(\d{1,4})\b', t):
        events.append((m.start(), 'des', m.group(1) + m.group(2)))
    # Waypoint: coordinates are the reliable anchor; the ident is either the
    # last (PAREN) group or the last ▲NAME before them.
    for m in re.finditer(r'(\d{6})N\s+(\d{7})W', t):
        back = t[max(0, m.start() - 200):m.start()]
        paren = re.findall(r'\(([A-Z]{2,3})\)', back)
        tri = re.findall(r'▲\s*([A-Z]{3,5})\b', back)
        name = paren[-1] if paren and (not tri or back.rfind('(') > back.rfind('▲')) else (tri[-1] if tri else None)
        if not name:
            continue
        events.append((m.start(), 'wpt', (name, m.group(1), m.group(2))))
    # Altitudes (4-5 digits, >= 1000 ft). Distances are 1-3 digits so they
    # can't be confused.
    for m in re.finditer(r'(?<![\d/])(\d{4,5})(?![\d/])', t):
        v = int(m.group(1))
        # Published limits are always round hundreds — this also rejects
        # stray years and amendment numbers.
        if 1000 <= v <= 60000 and v % 100 == 0:
            events.append((m.start(), 'alt', v))
    events.sort(key=lambda e: e[0])

    out = []
    rid, pts, meas, pending = None, [], [], []

    def flush():
        nonlocal rid, pts, meas, pending
        if rid and len(pts) >= 2:
            out.append((rid, pts, meas))
        rid, pts, meas, pending = None, [], [], []

    for _, kind, data in events:
        if kind == 'des':
            flush()
            rid = data
        elif kind == 'wpt' and rid:
            name, la, lo = data
            if pts:
                # The window between two fixes can contain this segment's
                # lower limit AND the next block's upper limit (the chart
                # prints upper on the fix line, lower under it). The lower
                # limit is by definition the smaller number.
                meas.append(min(pending) if pending else None)
                pending = []
            pts.append((name, dms(la, 'N'), dms(lo, 'W')))
        elif kind == 'alt' and rid:
            pending.append(data)
    flush()
    return out


routes = {}
for f in ('ENR_3.1..pdf', 'ENR_3.2..pdf'):
    p = os.path.join(SCRATCH, f)
    if not os.path.exists(p):
        print('missing', p); continue
    for rid, pts, meas in parse_pdf(p):
        # keep the longest chain when a designator repeats across pages
        if rid not in routes or len(pts) > len(routes[rid][0]):
            routes[rid] = (pts, meas)

# Sanity filter: Mexican airspace box, drop chains that fall outside it
def sane(pts):
    return all(12 < la < 34 and -120 < lo < -84 for _, la, lo in pts)

routes = {k: v for k, v in routes.items() if sane(v[0])}

mx_fixes = {}
for pts, _ in routes.values():
    for name, la, lo in pts:
        if len(name) == 5:
            mx_fixes.setdefault(name, [la, lo])

fixes = json.load(open(f'{OUT}/fixes.json'))
added = 0
for name, coord in mx_fixes.items():
    if name not in fixes:
        fixes[name] = coord; added += 1
    else:
        cur = fixes[name]
        cand = cur if isinstance(cur[0], list) else [cur]
        if not any(abs(c[0]-coord[0]) < 0.02 and abs(c[1]-coord[1]) < 0.02 for c in cand):
            fixes[name] = cand + [coord]
json.dump(fixes, open(f'{OUT}/fixes.json', 'w'), separators=(',', ':'))

airways = json.load(open(f'{OUT}/airways.json'))
suppressed = 0
for rid, (pts, meas) in routes.items():
    variants = [v for v in airways.get(rid, []) if v.get('loc') != 'MX']
    mea = (meas + [None] * len(pts))[:len(pts) - 1]
    # On a LOWER route, FL180 is the airspace ceiling, not a minimum — a
    # segment reading exactly 18000 means we captured the upper limit
    # because the lower one wasn't in the text window. Publish nothing
    # rather than an altitude that is wrong in the dangerous direction.
    if not rid.startswith('U'):
        for i, m in enumerate(mea):
            if m == 18000:
                mea[i] = None
                suppressed += 1
    variants.append({'loc': 'MX', 'pts': [p[0] for p in pts], 'mea': mea,
                     'trk': [None] * (len(pts) - 1)})
    airways[rid] = variants
json.dump(airways, open(f'{OUT}/airways.json', 'w'), separators=(',', ':'))

print(f"MX MEAs suppressed as unreliable: {suppressed}")
print(f"MX routes: {len(routes)} | MX fixes: {len(mx_fixes)} (added {added} new)")
print(f'airways.json: {os.path.getsize(f"{OUT}/airways.json")/1e6:.2f} MB')
for k in list(routes)[:4]:
    print(' ', k, [p[0] for p in routes[k][0]][:8], 'MEA', routes[k][1][:5])
