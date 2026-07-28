"""Published IFR routes, from the FAA's NASR PFR subset.

Between two airports there is usually a routing that ATC actually issues, and
filing something else earns a full-route clearance amendment before the wheels
turn. The FAA publishes those: Preferred IFR Routes for the en-route structure,
TEC routes for the short low-altitude hops between adjacent terminal areas, and
the North American Routes over the oceans. This turns that file into something
the route card can offer the moment a departure and destination are known.

What is kept: the route string as published, its designator, its type, and the
altitude and hours it applies to. What is dropped: rows with no route string,
which describe an area rather than a routing and are of no use to a pilot
filling in waypoints.

The route strings contain SID and STAR names (CWARD2, PHLBO4). Those are
procedures, not fixes, and expanding them needs the FAA CIFP, which this app
does not carry. They are left in the string exactly as published and the app
shows them as text rather than pretending to resolve them.

Output: src/data/geo/preferred_routes.json
    { "_meta": {...}, "KSAN>KLAX": [ {d,t,r,a,h,ac,dir}, ... ] }
"""
import csv
import json
import os
import sys

from faa_cycle import nasr_subset

# The published order of usefulness when several routes serve a pair: the low
# and TEC routes are what a light aircraft is actually given, the high and NAR
# routes belong to traffic that is not this app's user.
TYPE_ORDER = {'TEC': 0, 'L': 1, 'LDD': 1, 'SLD': 2, 'H': 3, 'HDD': 3, 'HPD': 4, 'SHD': 4, 'NAR': 5}


def find_csv(root, name):
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.upper() == name.upper():
                return os.path.join(dirpath, f)
    raise SystemExit(f'{name} not found under {root}')


def clean(v):
    v = (v or '').strip()
    return v or None


def build(out_path):
    src, tag = nasr_subset('PFR')
    path = find_csv(src, 'PFR_BASE.csv')

    pairs = {}
    rows = kept = 0
    with open(path, newline='', encoding='utf-8-sig') as fh:
        for row in csv.DictReader(fh):
            rows += 1
            route = clean(row.get('ROUTE_STRING'))
            origin = clean(row.get('ORIGIN_ID'))
            dest = clean(row.get('DSTN_ID'))
            # An area-wide row ("all airports in the Boston area") carries no
            # routing a pilot can file, and a pair with no route string is
            # worse than no entry at all — it offers a choice that does nothing.
            if not route or not origin or not dest:
                continue
            kept += 1
            entry = {
                'd': clean(row.get('DESIGNATOR')) or clean(row.get('ROUTE_NO')),
                't': clean(row.get('PFR_TYPE_CODE')) or '?',
                'r': ' '.join(route.split()),
            }
            for key, col in (('a', 'ALT_DESCRIP'), ('h', 'HOURS'),
                             ('ac', 'AIRCRAFT'), ('dir', 'ROUTE_DIR_DESCRIP')):
                v = clean(row.get(col))
                if v:
                    entry[key] = v
            pairs.setdefault(f'{origin}>{dest}', []).append(entry)

    for routes in pairs.values():
        routes.sort(key=lambda e: (TYPE_ORDER.get(e['t'], 9), e['d'] or ''))

    out = {'_meta': {'source': 'FAA NASR PFR', 'cycle': tag,
                     'pairs': len(pairs), 'routes': kept}}
    out.update(dict(sorted(pairs.items())))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'), ensure_ascii=False)

    size = os.path.getsize(out_path) / 1024
    print(f'preferred routes: {kept} of {rows} rows over {len(pairs)} airport '
          f'pairs, cycle {tag} ({size:.0f} KB)')
    return len(pairs)


if __name__ == '__main__':
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    dest = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, 'src/data/geo/preferred_routes.json')
    build(dest)
