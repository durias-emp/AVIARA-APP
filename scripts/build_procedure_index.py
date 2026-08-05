#!/usr/bin/env python3
"""Procedure chart index — airport, approach, departure and visual charts per US airport.

The FAA republishes its Terminal Procedures Publication (d-TPP) every 28-day
NASR cycle, same cadence as the rest of this pack. Unlike the NASR subscription
zips, the metadata feed here is a single self-describing "current" document —
no cycle date to guess, the FAA always serves whatever's in force right now.

Source: https://nfdc.faa.gov/webContent/dtpp/current.xml (confirmed live,
public-domain U.S. government data — 17 U.S.C. §105). Each <record> under an
<airport_name> carries a chart_code (IAP = instrument approach — visual
approaches are IAP records too, distinguished only by "VISUAL" in the chart
name, the FAA has no separate category for them; DP/ODP = departures; APD =
the surveyed airport diagram) and a pdf_name, fetchable at
https://aeronav.faa.gov/d-tpp/{cycle}/{pdf_name}. STARs (arrivals) are in the
feed and still discarded here — worth adding, not yet done.

Airports are matched by BOTH icao_ident (present inconsistently for smaller
fields) and a derived apt_ident (the FAA's own identifier with the K/PA/PH
ICAO prefix stripped) — matching only one silently drops coverage for exactly
the small-GA-field population this pack already goes out of its way to serve
(see build_airport_details.py's own header for why that matters here).

Output: src/data/geo/procedures_index.json
  {"KJFK": {"airport": [["AIRPORT DIAGRAM", "00610AD.PDF"]],
            "approach": [["ILS Y OR LOC Y RWY 23", "00123IL23.PDF"], ...],
            "departure": [...], "visual": [...]},
   ...,
   "_meta": {"cycle": "2607"}}
"""
import json, os, re, sys, urllib.request
import xml.etree.ElementTree as ET

OUT = sys.argv[1] if len(sys.argv) > 1 else 'src/data/geo'
FEED_URL = 'https://nfdc.faa.gov/webContent/dtpp/current.xml'

# Same prefixes as isUSIdent() in src/lib/faaAirportGeometry.js — kept in sync
# by hand since this runs in a different language/runtime.
US_PREFIX = re.compile(r'^(K|PA|PH)', re.IGNORECASE)


def strip_prefix(icao):
    return US_PREFIX.sub('', icao or '', count=1)


known = {a[0] for a in json.load(open(f'{OUT}/airports.json'))['airports']}
by_icao = {k for k in known if US_PREFIX.match(k)}
by_stripped = {}
for k in by_icao:
    by_stripped.setdefault(strip_prefix(k).upper(), k)

print('downloading current d-TPP metadata…')
try:
    with urllib.request.urlopen(FEED_URL, timeout=60) as resp:
        root = ET.fromstring(resp.read())
except Exception as exc:                                  # noqa: BLE001 - any HTTP/parse failure
    raise SystemExit(f'could not fetch/parse {FEED_URL}: {exc}')

cycle = root.attrib.get('cycle', '')
print(f'cycle {cycle}')
if not cycle:
    raise SystemExit('no cycle attribute on the feed root — FAA likely changed the format')

index = {}
dropped_dead = 0
matched, unmatched = 0, 0

for airport in root.iter('airport_name'):
    icao_ident = (airport.attrib.get('icao_ident') or '').strip().upper()
    apt_ident = (airport.attrib.get('apt_ident') or '').strip().upper()

    key = None
    if icao_ident and icao_ident in by_icao:
        key = icao_ident
    elif apt_ident and apt_ident in by_stripped:
        key = by_stripped[apt_ident]

    if not key:
        unmatched += 1
        continue
    matched += 1

    entry = index.setdefault(key, {'airport': [], 'approach': [], 'departure': [], 'visual': []})
    for record in airport.findall('record'):
        chart_code = (record.findtext('chart_code') or '').strip().upper()
        chart_name = (record.findtext('chart_name') or '').strip()
        pdf_name = (record.findtext('pdf_name') or '').strip()

        # A withdrawn chart's metadata row can outlive the PDF itself.
        if not pdf_name or pdf_name.upper() == 'DELETED':
            dropped_dead += 1
            continue

        if chart_code == 'IAP':
            bucket = 'visual' if 'VISUAL' in chart_name.upper() else 'approach'
        elif chart_code in ('DP', 'ODP'):
            bucket = 'departure'
        elif chart_code == 'APD':
            # The official airport diagram — the surveyed taxi chart. The app
            # draws its own from OpenStreetMap for everywhere the FAA doesn't
            # cover, but where this exists it is the authoritative one.
            bucket = 'airport'
        else:
            continue
        entry[bucket].append([chart_name, pdf_name])

# Airports with nothing usable at all just clutter the index. 'airport' has to
# be in this test as well: a towered field can publish a diagram and no
# instrument procedures, and omitting it here would drop that field entirely.
index = {k: v for k, v in index.items()
         if v['airport'] or v['approach'] or v['departure'] or v['visual']}
index['_meta'] = {'cycle': cycle}

dest = f'{OUT}/procedures_index.json'
json.dump(index, open(dest, 'w'), separators=(',', ':'))
print(f'matched {matched} airports ({unmatched} in the feed not in our airport list), '
      f'{dropped_dead} dead chart rows dropped -> {os.path.getsize(dest)/1e6:.2f} MB')

# A collapse in coverage here means the FAA changed their XML layout and this
# parser silently stopped working — fail the build rather than ship an empty
# (or near-empty) index that looks fine but has nothing in it.
for spot_check in ('KJFK', 'KATL', 'KORD'):
    rec = index.get(spot_check, {})
    n = len(rec.get('approach', []))
    if n == 0:
        raise SystemExit(f'sanity check failed: {spot_check} has 0 approach charts — parser likely broken')
    # Checked by name for the same reason the approach count is: if the FAA
    # renames the APD code, the diagrams vanish silently and the app quietly
    # stops offering official charts at every field at once.
    if not rec.get('airport'):
        raise SystemExit(f'sanity check failed: {spot_check} has no airport diagram — APD code may have changed')
    print(f'  {spot_check}: {n} approach charts, {len(rec["airport"])} airport diagram(s)')
