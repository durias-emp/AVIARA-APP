#!/usr/bin/env python3
"""CENAMER controlled-airspace pack — parses COCESNA's eAIP into polygons
AVIARA can test a route against:

  ENR 2.1  FIR, UIR, TMA and CTA   (FIR/UIR skipped, see below)
  ENR 2.2  CTR, ATZ and TWR        (the surface zones under each TMA)

ENR 5.1 (prohibited, restricted and danger areas) was the obvious next
source and is NOT here: COCESNA publishes the section as an empty stub, as
it does the whole of ENR 5 — no restricted areas, no military areas, no
ADIZ. Those exist only in each state's own AIP (DGAC Guatemala, AAC El
Salvador, DGAC Costa Rica…), which are separate documents in separate
formats. Nothing is silently missing here; the regional AIP simply does not
carry them.

Why this exists: controlled-airspace detection reads the FAA class-airspace
service, which stops at the US border. openAIP has 7,670 airspaces for the US,
14 for Mexico and 0 for Guatemala — so for Central America there is no
queryable source at all, and La Aurora's TMA simply never appeared. The eAIP
publishes it; it just publishes it as prose.

Lateral limits come in four forms, all of which have to be turned into a ring:
  * a list of DMS coordinates                       -> vertices
  * "Circle of R NM of radius with center in (…)"   -> 72-point circle
  * "Along the arc of R NM … until: <coord>"        -> arc sampled every 5°
  * "Along the border: X - Y"                       -> NOT published as
    geometry. The two endpoints are joined by a straight line and the area is
    flagged approx=True, because a national border is not a straight line and
    the difference reaches tens of NM. Every area carrying that flag says so
    in the app rather than pretending to a precision it does not have.

FIR and UIR are skipped: they cover the whole region, so flagging them would
fire on every flight in Central America and carry no information — the same
reason Class E is excluded from the US check.

Output: src/data/geo/cenamer_airspace.json
  {"areas": [{name, country, cls, lowerFt, upperFt, ref, approx, poly}], …}
"""
import json, math, os, re, sys, urllib.request

SCRATCH = ("/private/tmp/claude-501/-Users-oliout-Desktop-CC-projects-AVIARA-APP/"
           "cc1f0f2f-31a5-48ef-ab87-7f9423836159/scratchpad/cocesna")
OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/geo'
BASE = ('https://www.cocesna.org/aipca/AIP_2657/Eurocontrol/COCESNA/'
        '2026-07-09-NON%20AIRAC/html/eAIP')
SRCS = [('CS-ENR-2.1.html', 'ES-CS-ENR-2.1-es-ES.html', None),
        ('CS-ENR-2.2.html', 'ES-CS-ENR-2.2-es-ES.html', 'CTR')]
CYCLE = '2026-07-09'

NM_PER_DEG = 60.0

# ENR 2.1 prints DMS (173222.62N 0881850.32W); ENR 2.2 mixes in plain decimal
# degrees (10.0699N 084.3019W). Five or more digits before the point means the
# minutes and seconds are packed in.
LATP = r'(\d{6}(?:\.\d+)?|\d{1,3}\.\d+)([NS])'
LONP = r'(\d{7}(?:\.\d+)?|\d{1,4}\.\d+)([EW])'
COORD = re.compile(LATP + r'\s*' + LONP)
NAME_DIV = re.compile(r'<div class="strong center large-padding-after"[^>]*>(.*?)</div>', re.S)
# "19500FT AMSL ------ 2500FT AMSL", "FL 195 ------ GND", "UNL ------ 20000FT AMSL"
LIMIT = r'(UNL|GND|SFC|FL\s*\d+|\d{3,5}\s*FT\s*(?:AMSL|AGL))'
BAND = re.compile(LIMIT + r'\s*-{3,}\s*' + LIMIT)
CLS = re.compile(r'CLASE/CLASS\s+([A-G])')


def flat(html):
    return re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', html)).strip()


def dms(v, hemi):
    """DDMMSS(.s) / DDDMMSS(.s), or a plain decimal degree value."""
    if len(v.split('.')[0]) < 5:
        dec = float(v)
    else:
        f = float(v)
        deg = int(f // 10000)
        rest = f - deg * 10000
        dec = deg + int(rest // 100) / 60 + (rest - int(rest // 100) * 100) / 3600
    return round(-dec if hemi in 'SW' else dec, 5)


def ft(limit):
    """'FL 195' -> 19500, 'GND' -> 0, 'UNL' -> None (no ceiling)."""
    s = limit.replace(' ', '').upper()
    if s in ('GND', 'SFC'):
        return 0
    if s == 'UNL':
        return None
    if s.startswith('FL'):
        return int(s[2:]) * 100
    return int(re.match(r'(\d+)', s).group(1))


def bearing_to(c, p):
    """Bearing centre->point, degrees, in the local flat frame the eAIP's own
    'NM radius' construction implies."""
    return math.degrees(math.atan2((p[1] - c[1]) * math.cos(math.radians(c[0])), p[0] - c[0]))


def offset(c, brg_deg, r_nm):
    b = math.radians(brg_deg)
    dlat = (r_nm / NM_PER_DEG) * math.cos(b)
    dlon = (r_nm / NM_PER_DEG) * math.sin(b) / max(0.05, math.cos(math.radians(c[0])))
    return [round(c[0] + dlat, 5), round(c[1] + dlon, 5)]


def circle(c, r_nm, n=72):
    return [offset(c, 360.0 * i / n, r_nm) for i in range(n)]


def radius_nm(c, p):
    return math.hypot((p[0] - c[0]) * NM_PER_DEG,
                      (p[1] - c[1]) * NM_PER_DEG * math.cos(math.radians(c[0])))


def arc(c, r_nm, start, end, clockwise=True, step=5.0):
    """Arc from `start` to `end` about `c`.

    Two guards, both from real entries in this document:

    * The stated radius sometimes disagrees with the endpoints — TMA COCO
      describes a "30 NM" arc whose endpoints sit 10 NM out. Coordinates are
      surveyed and the prose is typed, so when they disagree materially the
      coordinates win.
    * A near-zero sweep between coincident endpoints is a slit, not a circle:
      the eAIP walks in and back out along the same line to describe a
      cut-out. Sweeping the full 360 there wraps the ring around the wrong
      centre and the airspace stops containing its own airport.
    """
    r_start, r_end = radius_nm(c, start), radius_nm(c, end)
    if r_nm and abs(r_start - r_nm) > 0.15 * r_nm and abs(r_start - r_end) < 0.15 * max(r_start, 1):
        r_nm = (r_start + r_end) / 2

    a0, a1 = bearing_to(c, start), bearing_to(c, end)
    sweep = (a1 - a0) % 360 if clockwise else -((a0 - a1) % 360)
    if abs(sweep) > 350 and radius_nm(start, end) < 1:
        return [end]

    n = max(2, int(abs(sweep) / step))
    return [offset(c, a0 + sweep * i / n, r_nm) for i in range(n + 1)]


_LAT = r'(?P<{}>\d{{6}}(?:\.\d+)?|\d{{1,3}}\.\d+)(?P<{}>[NS])'
_LON = r'(?P<{}>\d{{7}}(?:\.\d+)?|\d{{1,4}}\.\d+)(?P<{}>[EW])'
ARC = re.compile(
    r'Along the arc(?P<ccw>\s+anticlockwise)?\s*of\s*(?P<r>[\d.]+)\s*NM of radius'
    r'.*?\(\s*' + _LAT.format('clat', 'cns') + r'\s*' + _LON.format('clon', 'cew') + r'\s*\)'
    r'.*?until:\s*' + _LAT.format('elat', 'ens') + r'\s*' + _LON.format('elon', 'eew'),
    re.S)
CIRCLE = re.compile(
    r'Circle of\s*(?P<r>[\d.]+)\s*NM of radius'
    r'.*?\(\s*' + _LAT.format('clat', 'cns') + r'\s*' + _LON.format('clon', 'cew') + r'\s*\)',
    re.S)


def parse_lateral(text):
    """Text of one entry's lateral-limits cell -> (ring, approx).

    Arc and circle phrases are matched whole — radius, centre and end point in
    one regex — and their character spans are then excluded from the plain
    coordinate scan. Reading the tokens positionally instead lets an arc's own
    centre be mistaken for a boundary vertex, which produces a ring that spins
    a full turn around the wrong point and no longer contains its own airport.
    """
    spans, events = [], []

    for m in CIRCLE.finditer(text):
        c = [dms(m.group('clat'), m.group('cns')), dms(m.group('clon'), m.group('cew'))]
        events.append((m.start(), 'circle', (c, float(m.group('r')))))
        spans.append((m.start(), m.end()))

    for m in ARC.finditer(text):
        c = [dms(m.group('clat'), m.group('cns')), dms(m.group('clon'), m.group('cew'))]
        e = [dms(m.group('elat'), m.group('ens')), dms(m.group('elon'), m.group('eew'))]
        events.append((m.start(), 'arc', (c, float(m.group('r')), e, not m.group('ccw'))))
        spans.append((m.start(), m.end()))

    consumed = lambda i: any(a <= i < b for a, b in spans)
    for m in COORD.finditer(text):
        if consumed(m.start()):
            continue
        events.append((m.start(), 'pt', [dms(m.group(1), m.group(2)), dms(m.group(3), m.group(4))]))

    approx = False
    for m in re.finditer(r'Along the border', text):
        if not consumed(m.start()):
            events.append((m.start(), 'border', None))

    events.sort(key=lambda e: e[0])

    ring = []
    for _, kind, data in events:
        if kind == 'pt':
            if not ring or ring[-1] != data:      # the eAIP repeats vertices
                ring.append(data)
        elif kind == 'circle':
            c, r = data
            return circle(c, r), False            # a circle is the whole shape
        elif kind == 'arc':
            c, r, end, cw = data
            if ring:
                ring.extend(arc(c, r, ring[-1], end, clockwise=cw))
            ring.append(end)
        elif kind == 'border':
            approx = True                          # endpoints joined by a line
    return ring, approx


def parse(path, default_kind=None):
    html = open(path, encoding='utf-8', errors='replace').read()
    names = list(NAME_DIV.finditer(html))
    out = []
    for i, m in enumerate(names):
        head = flat(m.group(1))
        body = flat(html[m.end(): names[i + 1].start() if i + 1 < len(names) else len(html)])

        name = re.sub(r'\(.*?\)', '', head).strip()
        # ENR 2.2 names several control zones by bare place name (BELIZE, COCO,
        # LA AURORA). Without the prefix they read like airports in the list.
        if default_kind and not re.search(r'\b(CTR|ATZ|TMA|CTA|TWR)\b', name):
            name = f'{default_kind} {name}'
        country = (re.search(r'\((.*?)\)', head) or [None, ''])[1]
        # FIR/UIR and the region-wide oceanic blocks would fire on every flight
        if re.match(r'^(FIR|UIR|OCEANIC|REGION INFERIOR)', name):
            continue

        # Lateral limits are the text before the first vertical band; past
        # that point the row carries frequencies and remarks, and those can
        # contain coordinates of their own (COCESNA prints poor-reception
        # areas in the remarks column).
        first_band = BAND.search(body)
        lateral = body[:first_band.start()] if first_band else body
        ring, approx = parse_lateral(lateral)
        if len(ring) < 3:
            print(f'  ! no geometry: {name}')
            continue

        # Vertical bands, each with the class printed after it. A handful of
        # zones (SAN JOSE CTR, the Sandino ATZ) publish geometry and no limits
        # at all — they are kept, and say so, rather than dropped: a zone whose
        # ceiling is unknown is still a zone you have to call before entering.
        bands = [(mm.group(1), mm.group(2), mm.end()) for mm in BAND.finditer(body)]
        if not bands:
            print(f'  · limits not published: {name}')
            out.append({
                'name': name, 'country': country, 'cls': None,
                'lowerFt': None, 'upperFt': None, 'ref': 'AMSL', 'approx': approx,
                'poly': [[round(a, 4), round(b, 4)] for a, b in ring],
            })
            continue
        for upper, lower, pos in bands:
            cls_m = CLS.search(body, pos)
            cls = cls_m.group(1) if cls_m else None
            ref = 'AGL' if 'AGL' in lower.upper() else 'AMSL'
            out.append({
                'name': name, 'country': country, 'cls': cls,
                'lowerFt': ft(lower), 'upperFt': ft(upper), 'ref': ref,
                'approx': approx,
                'poly': [[round(a, 4), round(b, 4)] for a, b in ring],
            })
    return out


areas = []
for local, remote, kind in SRCS:
    path = os.path.join(SCRATCH, local)
    if not os.path.exists(path):
        os.makedirs(SCRATCH, exist_ok=True)
        print(f'downloading COCESNA {local}…')
        urllib.request.urlretrieve(f'{BASE}/{remote}', path)
    areas += parse(path, kind)
os.makedirs(OUT, exist_ok=True)
dest = f'{OUT}/cenamer_airspace.json'
json.dump({'areas': areas, 'cycle': CYCLE,
           'note': 'COCESNA eAIP ENR 2.1 + 2.2 (CENAMER FIR). FIR/UIR excluded. '
                   'approx=true means a boundary follows a national border, '
                   'published as prose and approximated by a straight line.'},
          open(dest, 'w'), separators=(',', ':'))

print(f'\nCENAMER airspace: {len(areas)} bands over '
      f'{len({a["name"] for a in areas})} areas -> {os.path.getsize(dest)/1e3:.0f} KB')
for a in areas:
    print(f'  {a["cls"] or "-"}  {a["name"][:28]:30s} {a["lowerFt"]}–{a["upperFt"]} {a["ref"]:4s} '
          f'{len(a["poly"]):3d} pts{"  (approx boundary)" if a["approx"] else ""}')
