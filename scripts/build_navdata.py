#!/usr/bin/env python3
"""Build compact navdata JSON for AVIARA from FAA NASR CSVs + openAIP navaids.

Outputs:
  fixes.json   {"AAALL": [lat, lon], ...}            5-letter US GPS/RNAV fixes
  navaids.json {"MCO": [[lat, lon, "NAME", freq], ...], ...}  VOR-family, global
Coords rounded to 5 decimals (~1 m).
"""
import csv, json, math, os, sys

# Downloads are cached here between runs. Override with AVIARA_CACHE; the
# default keeps the builders working identically on a laptop and on CI, where
# no session scratch directory exists.
CACHE = os.environ.get('AVIARA_CACHE') or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.cache')
os.makedirs(CACHE, exist_ok=True)


SCRATCH = CACHE
OUT = sys.argv[1] if len(sys.argv) > 1 else SCRATCH

# ---------- Fixes (NASR FIX_BASE) ----------
fixes = {}
dup_fix = 0
with open(f"{SCRATCH}/nasr/FIX_BASE.csv", newline="", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        fid = row["FIX_ID"].strip().upper()
        if len(fid) != 5 or not fid.isalpha():
            continue
        try:
            lat = round(float(row["LAT_DECIMAL"]), 5)
            lon = round(float(row["LONG_DECIMAL"]), 5)
        except ValueError:
            continue
        if fid in fixes:
            dup_fix += 1
            # keep list-of-coords on duplicates
            if isinstance(fixes[fid][0], list):
                fixes[fid].append([lat, lon])
            else:
                fixes[fid] = [fixes[fid], [lat, lon]]
        else:
            fixes[fid] = [lat, lon]

# ---------- Navaids: NASR VOR family ----------
VOR_TYPES = {"VOR", "VOR/DME", "VORTAC", "VOT", "TACAN", "DME"}
navaids = {}  # ident -> list of [lat, lon, name, freq]

def add_navaid(ident, lat, lon, name, freq):
    ident = ident.strip().upper()
    if not (2 <= len(ident) <= 3) or not ident.isalpha():
        return
    entry = [round(lat, 5), round(lon, 5), name.strip().title()[:24], freq]
    lst = navaids.setdefault(ident, [])
    # dedupe: skip if within ~1nm of an existing entry for the same ident
    for e in lst:
        if abs(e[0] - entry[0]) < 0.02 and abs(e[1] - entry[1]) < 0.02:
            return
    lst.append(entry)

nasr_count = 0
with open(f"{SCRATCH}/nasr/NAV_BASE.csv", newline="", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        ntype = row["NAV_TYPE"].strip().upper()
        if ntype not in VOR_TYPES:
            continue
        try:
            lat = float(row["LAT_DECIMAL"]); lon = float(row["LONG_DECIMAL"])
        except ValueError:
            continue
        freq = row.get("FREQ", "").strip()
        try:
            freq = float(freq)
        except ValueError:
            freq = None
        add_navaid(row["NAV_ID"], lat, lon, row.get("NAME", ""), freq)
        nasr_count += 1

# ---------- Navaids: OurAirports global (public domain, ~11k navaids) ----------
# Far better worldwide coverage than openAIP, especially Latin America
# (AUR Guatemala, LIM Peru, ...). https://davidmegginson.github.io/ourairports-data/navaids.csv
OA_VOR = {"VOR", "VOR-DME", "VORTAC", "DME", "TACAN", "VOT"}
oa_count = 0
try:
    with open(f"{SCRATCH}/navaids_oa.csv", newline="", encoding="utf-8", errors="replace") as f:
        for row in csv.DictReader(f):
            if row.get("type") not in OA_VOR:
                continue
            try:
                lat = float(row["latitude_deg"]); lon = float(row["longitude_deg"])
            except (ValueError, KeyError):
                continue
            freq = None
            try:
                freq = round(float(row.get("frequency_khz")) / 1000, 2)
            except (TypeError, ValueError):
                pass
            add_navaid(row.get("ident", ""), lat, lon, row.get("name", "").replace(" VOR-DME", "").replace(" VORTAC", "").replace(" VOR", ""), freq)
            oa_count += 1
except FileNotFoundError:
    print("WARNING: navaids_oa.csv not in scratch — OurAirports layer skipped")

# ---------- Navaids: openAIP global (fills non-US: YVR etc.) ----------
# openAIP navaid types: 0 DME, 1 TACAN, 2 NDB, 3 VOR, 4 VOR-DME, 5 VORTAC, 6 DVOR, 7 DVOR-DME, 8 DVORTAC
OAIP_VOR = {0, 1, 3, 4, 5, 6, 7, 8}
oaip_count = 0
for p in range(1, 7):
    with open(f"{SCRATCH}/oaip_nav_{p}.json") as f:
        data = json.load(f)
    for item in data.get("items", []):
        if item.get("type") not in OAIP_VOR:
            continue
        coords = item.get("geometry", {}).get("coordinates")
        if not coords:
            continue
        lon, lat = coords[0], coords[1]
        freq = None
        fq = item.get("frequency") or {}
        try:
            freq = float(fq.get("value"))
        except (TypeError, ValueError):
            pass
        add_navaid(item.get("identifier", ""), lat, lon, item.get("name", ""), freq)
        oaip_count += 1

json.dump(fixes, open(f"{OUT}/fixes.json", "w"), separators=(",", ":"))
json.dump(navaids, open(f"{OUT}/navaids.json", "w"), separators=(",", ":"))

import os
print(f"fixes: {len(fixes)} ids ({dup_fix} dups) -> {os.path.getsize(f'{OUT}/fixes.json')/1e6:.2f} MB")
print(f"navaids: {len(navaids)} idents (nasr {nasr_count}, oaip {oaip_count}) -> {os.path.getsize(f'{OUT}/navaids.json')/1e6:.2f} MB")
for probe in ("GOOFY", "GINDU", "IPGOP", "SUNOL"):
    print(probe, fixes.get(probe))
for probe in ("MCO", "MIA", "YVR", "OSI", "SFO"):
    print(probe, navaids.get(probe))

# ---------- Airways (NASR AWY_BASE + AWY_SEG_ALT) ----------
# {"V25": [{"loc": "C", "pts": ["MZB", ...], "mea": [18000|null per segment]}]}
# Idents only — the app resolves coordinates at runtime from fixes/navaids,
# disambiguating duplicates by chain proximity.
awys = {}
mea_by_from = {}
trk_by_from = {}
with open(f"{SCRATCH}/nasr/AWY_SEG_ALT.csv", newline="", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        key = (row["AWY_ID"].strip(), row["AWY_LOCATION"].strip(), row["FROM_POINT"].strip().upper())
        try:
            mea_by_from[key] = int(float(row["MIN_ENROUTE_ALT"]))
        except (ValueError, TypeError):
            pass
        try:
            trk_by_from[key] = round(float(row["MAG_COURSE"]))
        except (ValueError, TypeError):
            pass

with open(f"{SCRATCH}/nasr/AWY_BASE.csv", newline="", encoding="utf-8", errors="replace") as f:
    for row in csv.DictReader(f):
        awy_id = row["AWY_ID"].strip().upper()
        loc = row["AWY_LOCATION"].strip()
        pts = row["AIRWAY_STRING"].split()
        if len(pts) < 2:
            continue
        mea = [mea_by_from.get((awy_id, loc, pts[i].upper())) for i in range(len(pts) - 1)]
        trk = [trk_by_from.get((awy_id, loc, pts[i].upper())) for i in range(len(pts) - 1)]
        awys.setdefault(awy_id, []).append({"loc": loc, "pts": pts, "mea": mea, "trk": trk})

json.dump(awys, open(f"{OUT}/airways.json", "w"), separators=(",", ":"))
print(f"airways: {len(awys)} ids -> {os.path.getsize(f'{OUT}/airways.json')/1e6:.2f} MB")
v25 = next(v for v in awys.get("V25", []) if v["loc"] == "C")
i1, i2 = v25["pts"].index("SNS"), v25["pts"].index("RZS")
print("V25 SNS..RZS:", v25["pts"][min(i1,i2):max(i1,i2)+1], "MEAs:", v25["mea"][min(i1,i2):max(i1,i2)])
