#!/usr/bin/env python3
"""Builds map-generator/assets/maps/budapest/{image.png,info.json}.

District outlines: github.com/tamasmrton/bp_map (data/BP_geojson.json, from
OpenStreetMap, (c) OpenStreetMap contributors, ODbL). The Danube is drawn
along the boundary between the Buda and Pest districts (district borders run
down the middle of the river), the Ráckeve (Soroksár) branch along Csepel's
eastern border. Hills are placed from known summits. Outside the city is
impassable (#000). Then: `cd map-generator && go run . --maps=budapest`.

Usage: python3 scripts/generate-budapest-map.py path/to/BP_geojson.json
"""

import json
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

OUT = "map-generator/assets/maps/budapest"
LON0, LON1 = 18.91, 19.35
LAT0, LAT1 = 47.34, 47.625
MID_LAT = 47.49
WIDTH = 1800
KX = WIDTH / (LON1 - LON0)
KY = KX / math.cos(math.radians(MID_LAT))
HEIGHT = int(round((LAT1 - LAT0) * KY / 4)) * 4

BUDA = {"I", "II", "III", "XI", "XII", "XXII"}
DANUBE_HALF_WIDTH = 9  # px (~170 m), so the main river is ~350 m wide
BRANCH_HALF_WIDTH = 3  # the Ráckeve branch is much narrower

# Nation name (Latin-1 only) per district number.
NAMES = {
    "I": "I. Budavár",
    "II": "II. kerület",
    "III": "III. Óbuda-Békásmegyer",
    "IV": "IV. Újpest",
    "V": "V. Belváros-Lipótváros",
    "VI": "VI. Terézváros",
    "VII": "VII. Erzsébetváros",
    "VIII": "VIII. Józsefváros",
    "IX": "IX. Ferencváros",
    "X": "X. Köbánya",
    "XI": "XI. Újbuda",
    "XII": "XII. Hegyvidék",
    "XIII": "XIII. kerület",
    "XIV": "XIV. Zugló",
    "XV": "XV. kerület",
    "XVI": "XVI. kerület",
    "XVII": "XVII. Rákosmente",
    "XVIII": "XVIII. Pestszentlörinc",
    "XIX": "XIX. Kispest",
    "XX": "XX. Pesterzsébet",
    "XXI": "XXI. Csepel",
    "XXII": "XXII. Budafok-Tétény",
    "XXIII": "XXIII. Soroksár",
}
STRONG = {"I": 2, "V": 2, "XI": 2, "XIII": 2, "III": 2}

# (lon, lat, radius in degrees, height 0-1)
RELIEF = [
    (18.958, 47.518, 0.035, 0.95),  # János-hegy
    (18.985, 47.553, 0.03, 0.8),  # Hármashatár-hegy
    (18.975, 47.495, 0.03, 0.7),  # Széchenyi-hegy / Svábhegy
    (18.94, 47.535, 0.035, 0.6),  # Nagy-Kopasz area
    (19.02, 47.585, 0.025, 0.45),  # Csúcs-hegy
    (19.047, 47.487, 0.007, 0.5),  # Gellért-hegy
    (19.034, 47.502, 0.005, 0.3),  # Castle Hill
    (18.98, 47.42, 0.04, 0.3),  # Tétény plateau
    (19.025, 47.52, 0.012, 0.3),  # Rózsadomb
]

TRIBES = [
    "Albertfalva", "Angyalföld", "Békásmegyer", "Budafok", "Cinkota",
    "Csillaghegy", "Csillagtelep", "Gazdagrét", "Herminamezö", "Káposztásmegyer",
    "Kelenföld", "Krisztinaváros", "Lágymányos", "Mátyásföld", "Máriaremete",
    "Nagytétény", "Pasarét", "Pesthidegkút", "Pestszentimre", "Rákoscsaba",
    "Rákoshegy", "Rákoskeresztúr", "Rákosliget", "Rákospalota", "Rákosszentmihály",
    "Rózsadomb", "Sashalom", "Svábhegy", "Tabán", "Újpalota", "Vízivaros",
    "Wekerletelep", "Zugliget",
]


def xy(lon, lat):
    return ((lon - LON0) * KX, (LAT1 - lat) * KY)


def district_number(name):
    # "Budapest XIII. kerület" -> "XIII"
    return name.split()[1].rstrip(".")


def main(path):
    with open(path) as f:
        data = json.load(f)

    labels = Image.new("I", (WIDTH, HEIGHT), 0)
    d = ImageDraw.Draw(labels)
    ids = {}
    for i, feat in enumerate(data["features"], start=1):
        num = district_number(feat["properties"]["name"])
        ids[i] = num
        geom = feat["geometry"]
        polys = (
            geom["coordinates"]
            if geom["type"] == "MultiPolygon"
            else [geom["coordinates"]]
        )
        for poly in polys:
            d.polygon([xy(*p) for p in poly[0]], fill=i)
            for hole in poly[1:]:
                d.polygon([xy(*p) for p in hole], fill=0)
    lab = np.array(labels, dtype=np.int32)
    inside = lab > 0

    buda = np.isin(lab, [k for k, v in ids.items() if v in BUDA])
    csepel = lab == next(k for k, v in ids.items() if v == "XXI")
    pest = inside & ~buda & ~csepel

    def near(mask, r):
        return ndimage.binary_dilation(mask, iterations=r)

    # Main Danube: Buda against Pest, and Buda against Csepel.
    river = (near(buda, DANUBE_HALF_WIDTH) & near(pest | csepel, DANUBE_HALF_WIDTH))
    # Ráckeve branch: Csepel against Pest.
    river |= near(csepel, BRANCH_HALF_WIDTH) & near(pest, BRANCH_HALF_WIDTH)
    river &= inside

    # Height field.
    yy, xx = np.mgrid[0:HEIGHT, 0:WIDTH]
    h = np.zeros((HEIGHT, WIDTH))
    for lon, lat, r, hgt in RELIEF:
        cx, cy = xy(lon, lat)
        rr = r * KX
        h = np.maximum(h, hgt * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (rr * rr) * 1.6))
    h += 0.03 * np.sin(xx * 0.05) * np.cos(yy * 0.043)
    h = np.clip(h, 0, 1)
    blue = (141 + h * 55).astype(np.uint8)

    img = np.zeros((HEIGHT, WIDTH, 3), dtype=np.uint8)
    img[inside, 0] = 190
    img[inside, 1] = (219 - (blue.astype(int) - 141))[inside]
    img[inside, 2] = blue[inside]
    img[river] = (0, 0, 106)
    os.makedirs(OUT, exist_ok=True)
    Image.fromarray(img, "RGB").save(os.path.join(OUT, "image.png"), optimize=True)

    # Each district's spawn: its land pixel farthest from its own edge.
    land = inside & ~river
    nations = []
    for i, num in sorted(ids.items(), key=lambda kv: roman(kv[1])):
        mask = (lab == i) & land
        dist = ndimage.distance_transform_edt(mask)
        y, x = np.unravel_index(np.argmax(dist), dist.shape)
        nations.append(
            {
                "coordinates": [int(x), int(y)],
                "name": NAMES[num],
                "strength": STRONG.get(num, 1),
                "flag": "hu",
            }
        )

    info = {
        "id": "Budapest",
        "name": "Budapest",
        "translation_key": "map.budapest",
        "categories": ["europe", "countries"],
        "multiplayer_frequency": 1,
        "custom_tribes": TRIBES,
        "nations": nations,
        "themes": ["europe"],
    }
    with open(os.path.join(OUT, "info.json"), "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
        f.write("\n")


def roman(s):
    vals = {"I": 1, "V": 5, "X": 10}
    total = 0
    for a, b in zip(s, s[1:] + " "):
        v = vals[a]
        total += -v if b != " " and vals.get(b, 0) > v else v
    return total


if __name__ == "__main__":
    main(sys.argv[1])
