#!/usr/bin/env python3
"""Builds map-generator/assets/maps/hungary/{image.png,info.json}.

The border comes from the Natural Earth based country outlines of
github.com/datasets/geo-countries (pass the path to countries.geojson). The
relief (hills and mountains) and the rivers and lakes are drawn from known
coordinates. Everything outside Hungary is impassable (#000), like the
Germany map. Then run the map generator: `cd map-generator && go run . --maps=hungary`.

Usage: python3 scripts/generate-hungary-map.py path/to/countries.geojson
"""

import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

OUT = "map-generator/assets/maps/hungary"
LON0, LON1 = 15.95, 23.05
LAT0, LAT1 = 45.6, 48.72
MID_LAT = 47.2
WIDTH = 2000
KX = WIDTH / (LON1 - LON0)  # px per degree of longitude
KY = KX / math.cos(math.radians(MID_LAT))  # px per degree of latitude
HEIGHT = int(round((LAT1 - LAT0) * KY / 4)) * 4


def xy(lon, lat):
    return ((lon - LON0) * KX, (LAT1 - lat) * KY)


# (lon, lat, radius in degrees, height 0-1): hills and mountains.
RELIEF = [
    (20.0, 47.88, 0.28, 0.85),  # Mátra
    (20.5, 48.05, 0.3, 0.8),  # Bükk
    (21.45, 48.35, 0.25, 0.6),  # Zemplén
    (19.6, 47.95, 0.25, 0.45),  # Cserhát
    (19.0, 47.78, 0.22, 0.6),  # Pilis / Visegrád hills
    (18.6, 47.65, 0.25, 0.45),  # Gerecse
    (18.3, 47.38, 0.2, 0.4),  # Vértes
    (17.8, 47.2, 0.35, 0.6),  # Bakony
    (17.5, 46.95, 0.2, 0.35),  # Keszthely hills
    (18.2, 46.15, 0.25, 0.6),  # Mecsek
    (18.4, 45.85, 0.12, 0.35),  # Villány hills
    (16.5, 47.4, 0.15, 0.45),  # Kőszeg hills
    (21.1, 48.3, 0.2, 0.35),  # Cserehát
    (16.9, 46.65, 0.35, 0.25),  # Zala hills
    (18.0, 46.6, 0.45, 0.2),  # Somogy / Tolna hills
]

# River centerlines as (lon, lat) points.
DANUBE = [
    (17.15, 48.02), (17.45, 47.85), (17.65, 47.75), (17.95, 47.76),
    (18.12, 47.76), (18.5, 47.77), (18.75, 47.8), (18.88, 47.82),
    (18.98, 47.79), (19.08, 47.73), (19.12, 47.65), (19.06, 47.56),
    (19.05, 47.48), (19.03, 47.35), (18.97, 47.18), (18.94, 46.98),
    (18.92, 46.8), (18.87, 46.62), (18.92, 46.4), (18.94, 46.18),
    (18.78, 46.05), (18.7, 45.98), (18.85, 45.88), (18.92, 45.78),
]
TISZA = [
    (22.84, 48.12), (22.6, 48.2), (22.3, 48.13), (22.0, 48.2),
    (21.75, 48.25), (21.42, 48.12), (21.2, 48.02), (21.08, 47.93),
    (20.95, 47.78), (20.76, 47.62), (20.55, 47.45), (20.35, 47.3),
    (20.2, 47.18), (20.1, 46.98), (20.14, 46.71), (20.12, 46.5),
    (20.15, 46.25), (20.1, 46.12),
]
DRAVA = [  # forms part of the southern border
    (16.85, 46.38), (17.1, 46.2), (17.3, 46.05), (17.6, 45.93),
    (17.95, 45.8), (18.3, 45.77), (18.55, 45.8), (18.8, 45.85),
]
RIVERS = [(DANUBE, 3), (TISZA, 2), (DRAVA, 2)]


def balaton():
    # Long thin lake from Keszthely (SW) to Balatonkenese (NE).
    a = xy(17.25, 46.72)
    b = xy(18.1, 47.03)
    pts = []
    n = 60
    half = 0.035 * KY  # half-width
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    px, py = -uy, ux
    for i in range(n + 1):
        t = i / n
        w = half * math.sin(math.pi * t) ** 0.6
        pts.append((a[0] + dx * t + px * w, a[1] + dy * t + py * w))
    for i in range(n, -1, -1):
        t = i / n
        w = half * math.sin(math.pi * t) ** 0.6
        pts.append((a[0] + dx * t - px * w, a[1] + dy * t - py * w))
    return pts


def main(geojson_path):
    with open(geojson_path) as f:
        data = json.load(f)
    feature = next(
        f for f in data["features"] if f["properties"].get("ISO3166-1-Alpha-3") == "HUN"
    )
    geom = feature["geometry"]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]

    mask = Image.new("L", (WIDTH, HEIGHT), 0)
    d = ImageDraw.Draw(mask)
    for poly in polys:
        d.polygon([xy(lon, lat) for lon, lat in poly[0]], fill=255)
        for hole in poly[1:]:
            d.polygon([xy(lon, lat) for lon, lat in hole], fill=0)

    # Relief as a height field 0..1, plus gentle noise.
    rnd = random.Random(1848)
    h = Image.new("L", (WIDTH, HEIGHT), 0)
    hp = h.load()
    blobs = [(xy(lon, lat), r * KX, hgt) for lon, lat, r, hgt in RELIEF]
    phases = [rnd.uniform(0, 6.28) for _ in range(4)]
    for y in range(HEIGHT):
        for x in range(WIDTH):
            v = 0.0
            for (cx, cy), r, hgt in blobs:
                dd = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r)
                if dd < 4:
                    v = max(v, hgt * math.exp(-dd * 1.6))
            v += 0.04 * (
                math.sin(x * 0.021 + phases[0]) * math.cos(y * 0.017 + phases[1])
                + math.sin(x * 0.053 + phases[2]) * math.sin(y * 0.047 + phases[3])
            )
            hp[x, y] = max(0, min(255, int(v * 255)))
    h = h.filter(ImageFilter.GaussianBlur(3))

    img = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    ip = img.load()
    mp = mask.load()
    hp = h.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            if mp[x, y] < 128:
                continue
            v = hp[x, y] / 255
            blue = int(141 + v * 55)  # plains ~141, mountains up to ~196
            ip[x, y] = (190, max(0, 219 - (blue - 141)), blue)

    d = ImageDraw.Draw(img)
    water = (0, 0, 106)
    for line, width in RIVERS:
        d.line([xy(lon, lat) for lon, lat in line], fill=water, width=width, joint="curve")
    d.polygon(balaton(), fill=water)
    # Lake Velence.
    vx, vy = xy(18.58, 47.22)
    d.ellipse([vx - 9, vy - 4, vx + 9, vy + 4], fill=water)
    # Keep water only inside Hungary (rivers on the border are kept by the
    # mask's own edge); everything else stays impassable black.
    black = Image.new("RGB", (WIDTH, HEIGHT), (0, 0, 0))
    grown = mask.filter(ImageFilter.MaxFilter(5))
    img = Image.composite(img, black, grown)
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, "image.png"), optimize=True)

    def nation(name, lon, lat, strength=1):
        x, y = xy(lon, lat)
        return {
            "coordinates": [int(round(x)), int(round(y))],
            "name": name,
            "strength": strength,
            "flag": "hu",
        }

    nations = [
        nation("Budapest", 19.04, 47.50, 3),
        nation("Pest", 19.80, 47.17, 2),
        nation("Győr-Moson-Sopron", 17.65, 47.69, 2),
        nation("Komárom-Esztergom", 18.39, 47.59),
        nation("Fejér", 18.42, 47.19, 2),
        nation("Veszprém", 17.91, 47.09),
        nation("Vas", 16.62, 47.23),
        nation("Zala", 16.85, 46.84),
        nation("Somogy", 17.80, 46.36),
        nation("Baranya", 18.23, 46.07, 2),
        nation("Tolna", 18.71, 46.35),
        nation("Bács-Kiskun", 19.69, 46.91, 2),
        nation("Csongrád-Csanád", 20.14, 46.25, 2),
        nation("Békés", 21.09, 46.68),
        nation("Jász-Nagykun-Szolnok", 20.19, 47.18),
        nation("Hajdú-Bihar", 21.63, 47.53, 2),
        nation("Szabolcs-Szatmár-Bereg", 21.72, 47.96),
        nation("Borsod-Abaúj-Zemplén", 20.78, 48.10, 2),
        nation("Heves", 20.38, 47.90),
        nation("Nógrád", 19.80, 48.10),
    ]
    tribes = [
        "Ajka", "Baja", "Balassagyarmat", "Békéscsaba", "Cegléd", "Debrecen",
        "Dunakeszi", "Dunaújváros", "Eger", "Érd", "Esztergom", "Gödöllő",
        "Gyöngyös", "Győr", "Gyula", "Hajdúböszörmény", "Hatvan", "Hódmezővásárhely",
        "Jászberény", "Kaposvár", "Karcag", "Kazincbarcika", "Kecskemét", "Keszthely",
        "Kiskunfélegyháza", "Kiskunhalas", "Kőszeg", "Makó", "Miskolc", "Mohács",
        "Mosonmagyaróvár", "Nagykanizsa", "Nyíregyháza", "Orosháza", "Ózd", "Paks",
        "Pápa", "Pécs", "Salgótarján", "Sárospatak", "Siófok", "Sopron", "Szeged",
        "Szekszárd", "Székesfehérvár", "Szentendre", "Szolnok", "Szombathely",
        "Tata", "Tatabánya", "Tokaj", "Vác", "Várpalota", "Visegrád",
        "Zalaegerszeg",
    ]
    info = {
        "id": "Hungary",
        "name": "Hungary",
        "translation_key": "map.hungary",
        "categories": ["europe", "countries"],
        "multiplayer_frequency": 1,
        "custom_tribes": tribes,
        "nations": nations,
        "themes": ["europe"],
    }
    # Nation and town names must stay within Latin-1 (no ő/ű).
    latin1 = str.maketrans("őűŐŰ", "öüÖÜ")
    for n in nations:
        n["name"] = n["name"].translate(latin1)
    info["custom_tribes"] = [t.translate(latin1) for t in tribes]
    with open(os.path.join(OUT, "info.json"), "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
