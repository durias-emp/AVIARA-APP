#!/usr/bin/env python3
"""Geo pack — bundled coastline and aerodrome data for overflight analysis,
so it resolves in the cockpit without a network call.

Source: Natural Earth 1:10m land (public domain), from the official
natural-earth-vector repository. Natural Earth asks for no attribution and
places no restriction on use.

Why bundled rather than queried: overwater is a preflight equipment decision
(life jackets, raft, filed overwater leg) and it must resolve in the cockpit
with no signal. It is also static — coastlines do not change on a 28-day
cycle like navdata does.

Two size reductions, both deliberate:
  * Douglas-Peucker simplification. At the default tolerance a coastline
    vertex moves by at most ~1.2 NM. Every decision made from this data —
    over water or not, how far from shore, is the glide range enough — is
    taken in tens of NM, so the error is an order of magnitude below the
    granularity of the answer. Full 10m detail costs 10 MB for the same
    answers.
  * Islands whose bounding box is under ~1.8 NM across are dropped. A rock
    that small is not a landing option and not a shoreline anyone plans to
    reach, and keeping them nearly doubles the file.

Holes in the land polygons are preserved (the Caspian), and Natural Earth's
separate lakes layer is carried as a second set of polygons that subtract from
land — without it the Great Lakes read as solid ground, and a Chicago–Muskegon
crossing is exactly the kind of leg this feature exists to flag. Only lakes
over ~5 NM across are kept: anything smaller cannot change a glide-range or
life-jacket decision.

Aerodromes come from OurAirports (public domain, same source as the navaid
pack), in two files: the position list used for route proximity, and a details
file (runways and frequencies) that replaces scraping a third-party site for
the same information — worldwide, offline, and with no CORS proxy in the path. Large and medium fields carry their name; small fields are ident-only,
which halves the file — a strip you would look up by ident anyway. Heliports,
seaplane bases, balloonports and closed fields are excluded: none of them
change how you cross an airport's traffic.

Output: src/data/geo/land.json
  {"polys": [[lat,lon], ...],         # flat vertex store
   "rings": [[[start,count], ...]],   # per polygon, outer ring first
   "bbox":  [[minLat,maxLat,minLon,maxLon], ...],
   "lakePolys" / "lakeRings" / "lakeBbox": the same three, for lakes}
"""
import csv, json, math, os, re, sys, urllib.request

# Downloads are cached here between runs. Override with AVIARA_CACHE; the
# default keeps the builders working identically on a laptop and on CI, where
# no session scratch directory exists.
CACHE = os.environ.get('AVIARA_CACHE') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE, exist_ok=True)


SCRATCH = CACHE
URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_land.geojson'
LAKES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson'
AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv'
OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/geo'

TOLERANCE = float(os.environ.get('TOL', 0.02))    # degrees, ~1.2 NM
MIN_SPAN  = float(os.environ.get('MIN_SPAN', 0.03))  # degrees, ~1.8 NM
MIN_LAKE  = float(os.environ.get('MIN_LAKE', 0.15))  # degrees, ~9 NM across
DP = int(os.environ.get('DP', 3))  # coordinate decimals (~110 m at 3) — well below the simplification error


def perp(p, a, b):
    """Perpendicular distance p→segment ab, in degrees (flat-earth is fine at
    the scale a single simplification step operates on)."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(pts, tol):
    """Iterative Douglas-Peucker — recursion blows the stack on rings with
    tens of thousands of vertices."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        worst, wi = 0.0, -1
        for k in range(i + 1, j):
            d = perp(pts[k], pts[i], pts[j])
            if d > worst:
                worst, wi = d, k
        if worst > tol:
            keep[wi] = True
            stack.append((i, wi))
            stack.append((wi, j))
    return [p for p, k in zip(pts, keep) if k]


def fetch(name, url):
    path = os.path.join(SCRATCH, name)
    if not os.path.exists(path):
        print(f'downloading {name}…')
        urllib.request.urlretrieve(url, path)
    return json.load(open(path))


def build(geojson, min_span, biggest=False):
    """GeoJSON polygons -> (flat vertex store, per-polygon ring index, bboxes).

    biggest=False keeps a shape unless BOTH dimensions are under min_span —
    right for islands, where a long thin cay is still landfall. biggest=True
    requires the longer dimension to reach min_span, which is what filters
    lakes down to the ones big enough to matter."""
    polys, rings, bboxes = [], [], []
    kept = dropped = src = 0
    for feat in geojson['features']:
        g = feat.get('geometry') or {}
        if g.get('type') not in ('Polygon', 'MultiPolygon'):
            continue
        shapes = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
        for shape in shapes:                  # shape = [outer, hole, hole…]
            outer = shape[0]
            src += sum(len(r) for r in shape)
            xs = [c[0] for c in outer]
            ys = [c[1] for c in outer]
            dx, dy = max(xs) - min(xs), max(ys) - min(ys)
            small = max(dx, dy) < min_span if biggest else (dx < min_span and dy < min_span)
            if small:
                dropped += 1
                continue
            idx = []
            for ring in shape:
                sr = simplify([(c[0], c[1]) for c in ring], TOLERANCE)
                if len(sr) < 4:               # collapsed to nothing meaningful
                    continue
                start = len(polys)
                # stored [lat, lon] to match the rest of the app
                polys.extend([round(y, DP), round(x, DP)] for x, y in sr)
                idx.append([start, len(sr)])
                kept += len(sr)
            if not idx:
                continue
            rings.append(idx)
            # bbox of the outer ring only — holes are inside it by definition
            o = polys[idx[0][0]: idx[0][0] + idx[0][1]]
            bboxes.append([
                round(min(p[0] for p in o), DP), round(max(p[0] for p in o), DP),
                round(min(p[1] for p in o), DP), round(max(p[1] for p in o), DP),
            ])
    return polys, rings, bboxes, kept, dropped, src


lp, lr, lb, lkept, ldrop, lsrc = build(fetch('ne_10m_land.geojson', URL), MIN_SPAN)
kp, kr, kb, kkept, kdrop, ksrc = build(fetch('ne_10m_lakes.geojson', LAKES_URL), MIN_LAKE, biggest=True)

os.makedirs(OUT, exist_ok=True)
path = f'{OUT}/land.json'
json.dump({'polys': lp, 'rings': lr, 'bbox': lb,
           'lakePolys': kp, 'lakeRings': kr, 'lakeBbox': kb,
           'note': 'Natural Earth 1:10m land + lakes, public domain. '
                   f'Simplified {TOLERANCE} deg; islands under {MIN_SPAN} deg '
                   f'and lakes under {MIN_LAKE} deg dropped.'},
          open(path, 'w'), separators=(',', ':'))

print(f'land:  {len(lr)} polygons, {lkept} vertices (from {lsrc}, {ldrop} tiny islands dropped)')
print(f'lakes: {len(kr)} polygons, {kkept} vertices (from {ksrc}, {kdrop} small lakes dropped)')
print(f'-> {os.path.getsize(path)/1e6:.2f} MB')


# ── Aerodromes ────────────────────────────────────────────────────
# [ident, lat, lon, class, name?] where class is 2 large / 1 medium / 0 small.
# Names are carried for 2 and 1 only; including them for all 43k small fields
# adds a megabyte for strips that are identified by code in practice.
CLASS = {'large_airport': 2, 'medium_airport': 1, 'small_airport': 0}

ap_path = os.path.join(SCRATCH, 'airports.csv')
if not os.path.exists(ap_path):
    print('downloading OurAirports…')
    urllib.request.urlretrieve(AIRPORTS_URL, ap_path)

airports = []
for row in csv.DictReader(open(ap_path, encoding='utf-8')):
    cls = CLASS.get(row['type'])
    if cls is None:
        continue
    try:
        la, lo = round(float(row['latitude_deg']), 4), round(float(row['longitude_deg']), 4)
    except ValueError:
        continue
    ident = row['icao_code'] or row['gps_code'] or row['ident']
    # OurAirports assigns placeholders like "SV-0001" to fields with no code.
    # They are not identifiers a pilot can use, so they are not worth listing.
    if not ident or re.fullmatch(r'[A-Z]{2}-\d+', ident):
        continue
    entry = [ident, la, lo, cls]
    if cls:
        entry.append(row['name'][:30])
    airports.append(entry)

ap_out = f'{OUT}/airports.json'
json.dump({'airports': airports,
           'note': 'OurAirports, public domain. Large/medium/small airports; '
                   'heliports, seaplane bases and closed fields excluded.'},
          open(ap_out, 'w'), separators=(',', ':'))
print(f'aerodromes: {len(airports)} fields -> {os.path.getsize(ap_out)/1e6:.2f} MB')

# Runway and frequency details are built separately, from the FAA's NASR
# subscription and the COCESNA eAIP where those cover the field — see
# scripts/build_airport_details.py.
