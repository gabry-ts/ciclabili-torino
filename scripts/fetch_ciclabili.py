#!/usr/bin/env python3
"""Fetch Torino bike infrastructure from OpenStreetMap via the Overpass API
and write a GeoJSON FeatureCollection to data/ciclabili-torino.geojson."""

import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

QUERY = """
[out:json][timeout:120];
area["name"="Torino"]["admin_level"="8"]->.torino;
(
  way["highway"="cycleway"](area.torino);
  way["highway"="path"]["bicycle"="designated"](area.torino);
  way["cycleway"~"lane|track|shared_lane|opposite_lane|opposite_track|share_busway"](area.torino);
  way["cycleway:left"~"lane|track|shared_lane|share_busway"](area.torino);
  way["cycleway:right"~"lane|track|shared_lane|share_busway"](area.torino);
  way["cycleway:both"~"lane|track|shared_lane|share_busway"](area.torino);
);
out geom tags;
"""


def fetch(endpoint: str) -> dict:
    req = urllib.request.Request(
        endpoint,
        data=("data=" + urllib.parse.quote(QUERY)).encode("utf-8"),
        headers={"User-Agent": "ciclabili-torino/1.0"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8"))


def classify(tags: dict) -> str:
    if tags.get("highway") == "cycleway":
        return "cycleway"
    if tags.get("bicycle") == "designated":
        return "designated_path"
    for key in ("cycleway", "cycleway:both", "cycleway:left", "cycleway:right"):
        v = tags.get(key)
        if v in ("track", "opposite_track"):
            return "track"
        if v in ("lane", "opposite_lane", "share_busway"):
            return "lane"
        if v == "shared_lane":
            return "shared_lane"
    return "other"


def to_geojson(osm: dict) -> dict:
    features = []
    for el in osm.get("elements", []):
        if el.get("type") != "way" or "geometry" not in el:
            continue
        coords = [[p["lon"], p["lat"]] for p in el["geometry"]]
        if len(coords) < 2:
            continue
        tags = el.get("tags", {})
        features.append({
            "type": "Feature",
            "id": el["id"],
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {
                "osm_id": el["id"],
                "name": tags.get("name") or tags.get("ref") or "",
                "highway": tags.get("highway", ""),
                "surface": tags.get("surface", ""),
                "category": classify(tags),
                "oneway": tags.get("oneway:bicycle") or tags.get("oneway", ""),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def main() -> int:
    import urllib.parse  # noqa: F401  (used inside fetch)

    last_err = None
    for ep in OVERPASS_ENDPOINTS:
        print(f"Trying {ep} ...", file=sys.stderr)
        try:
            osm = fetch(ep)
            break
        except (urllib.error.URLError, TimeoutError) as err:
            print(f"  failed: {err}", file=sys.stderr)
            last_err = err
    else:
        print(f"All endpoints failed. Last error: {last_err}", file=sys.stderr)
        return 1

    gj = to_geojson(osm)
    out_path = Path(__file__).resolve().parent.parent / "data" / "ciclabili-torino.geojson"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(gj, ensure_ascii=False), encoding="utf-8")

    by_cat = {}
    for f in gj["features"]:
        c = f["properties"]["category"]
        by_cat[c] = by_cat.get(c, 0) + 1
    print(f"Wrote {len(gj['features'])} features to {out_path}", file=sys.stderr)
    for c, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"  {c}: {n}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    import urllib.parse
    sys.exit(main())
