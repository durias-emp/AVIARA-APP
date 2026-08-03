#!/usr/bin/env python3
"""Coordinates for the FAA winds-aloft (FB) reporting stations.

The FB bulletin identifies its stations by three-letter ident and nothing
else — no latitude, no longitude. To interpolate a wind at a point on a route
we have to know where the stations are, so this resolves the whole list once,
at build time, against NASR.

Two sources, in order:

  NAV_BASE  most FB stations are VORs, and the VOR is the published site
  APT_BASE  the rest are airports (AMA, CMH, FAT and friends)

The station list itself is scraped from the live bulletins rather than
hardcoded, because it is the FAA's list and it changes: stations get added and
dropped between cycles. Anything that cannot be resolved is reported, not
silently dropped — a station missing from this table is a hole in the wind
field, and the size of the hole is worth knowing.

Output: src/data/geo/fb_stations.json  { "IDENT": [lat, lon], ... }
"""

import csv
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / '.cache' / 'nasr'
OUT = ROOT / 'src' / 'data' / 'geo' / 'fb_stations.json'

AWC = 'https://aviationweather.gov/api/data/windtemp?region={r}&fcst={f}'
REGIONS = ['us', 'alaska', 'hawaii', 'bos', 'mia', 'chi', 'dfw', 'slc', 'sfo']
FCSTS = ['06', '12', '24']


def cycle_dir(suffix):
    hits = sorted(p for p in CACHE.glob(f'*_{suffix}') if p.is_dir())
    if not hits:
        sys.exit(f'no NASR {suffix} directory under {CACHE} — run the navdata build first')
    return hits[-1]


def dms_decimal(row, prefix):
    """NASR ships both DMS and a decimal column; the decimal one is a string
    like '32.48133' or occasionally blank, so fall back to DMS."""
    dec = (row.get(f'{prefix}_DECIMAL') or '').strip()
    if dec:
        try:
            return float(dec)
        except ValueError:
            pass
    try:
        d = float(row[f'{prefix}_DEG']); m = float(row[f'{prefix}_MIN']); s = float(row[f'{prefix}_SEC'])
    except (KeyError, TypeError, ValueError):
        return None
    v = d + m / 60 + s / 3600
    return -v if row.get(f'{prefix}_HEMIS') in ('S', 'W') else v


def load_navaids():
    out = {}
    path = cycle_dir('NAV') / 'NAV_BASE.csv'
    with open(path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            # VOR family plus TACAN — ECK (Peck) is a bare TACAN and is a
            # perfectly ordinary FB station. NDBs are excluded: their
            # three-letter idents collide freely with VORs elsewhere.
            nav_type = (row.get('NAV_TYPE') or '').upper()
            if 'VOR' not in nav_type and nav_type != 'TACAN':
                continue
            ident = (row.get('NAV_ID') or '').strip()
            lat, lon = dms_decimal(row, 'LAT'), dms_decimal(row, 'LONG')
            if ident and lat is not None and lon is not None:
                out.setdefault(ident, (round(lat, 4), round(lon, 4)))
    return out


def load_airports():
    out = {}
    path = cycle_dir('apt') / 'APT_BASE.csv'
    with open(path, newline='', encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            ident = (row.get('ARPT_ID') or '').strip()
            lat, lon = dms_decimal(row, 'LAT'), dms_decimal(row, 'LONG')
            if ident and lat is not None and lon is not None:
                out.setdefault(ident, (round(lat, 4), round(lon, 4)))
    return out


def fetch_idents():
    """Every station ident appearing in any current FB bulletin."""
    idents = set()
    for region in REGIONS:
        for fcst in FCSTS:
            url = AWC.format(r=region, f=fcst)
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'AVIARA-build/1.0'})
                with urllib.request.urlopen(req, timeout=30) as r:
                    text = r.read().decode('utf-8', 'replace')
            except Exception as e:                      # noqa: BLE001
                print(f'  {region}/{fcst}: {e}')
                continue
            body = text.split('\nFT ', 1)
            if len(body) < 2:
                continue
            for line in body[1].splitlines()[1:]:
                m = re.match(r'^([A-Z0-9]{3})\s', line)
                if m:
                    idents.add(m.group(1))
    return idents


def main():
    print('fetching FB bulletins…')
    idents = fetch_idents()
    if not idents:
        sys.exit('no station idents found — AWC unreachable?')
    print(f'  {len(idents)} distinct station idents')

    navaids, airports = load_navaids(), load_airports()
    print(f'  {len(navaids)} VORs, {len(airports)} airports available')

    out, from_nav, from_apt, missing = {}, 0, 0, []
    for ident in sorted(idents):
        if ident in navaids:
            out[ident] = list(navaids[ident]); from_nav += 1
        elif ident in airports:
            out[ident] = list(airports[ident]); from_apt += 1
        else:
            missing.append(ident)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(',', ':'), sort_keys=True))
    kb = OUT.stat().st_size / 1024
    print(f'\n{len(out)}/{len(idents)} resolved  ({from_nav} VOR, {from_apt} airport)  {kb:.1f} KB')
    if missing:
        # Mostly the oceanic grid points (H51, H61…) which have no NASR entry
        # by design. Printed so a real regression is visible among them.
        print(f'unresolved ({len(missing)}): {" ".join(missing)}')


if __name__ == '__main__':
    main()
