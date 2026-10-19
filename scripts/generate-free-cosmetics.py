#!/usr/bin/env python3
"""Generates this fork's free cosmetics catalog and skin images.

Everything here is original and free for every player:
  resources/cosmetics/cosmetics.json   the catalog (patterns, palettes,
                                       skins, trails and other effects)
  resources/cosmetics/skins/*.png      the territory skin stamps

Run from the repo root:  python3 scripts/generate-free-cosmetics.py
Needs Pillow (pip install pillow).
"""

import base64
import json
import math
import os

from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = "resources/cosmetics"
SKIN_DIR = os.path.join(OUT_DIR, "skins")


# ---------------------------------------------------------------- patterns
def encode_pattern(rows, scale):
    """rows: list of equal-length strings, '#' = secondary colour, '.' = primary."""
    h, w = len(rows), len(rows[0])
    assert 2 <= w <= 129 and 2 <= h <= 65 and 0 <= scale <= 7
    out = bytearray(
        [0, (scale & 0x07) | (((w - 2) & 0x1F) << 3), (((w - 2) >> 5) & 0x03) | (((h - 2) & 0x3F) << 2)]
    )
    bits = bytearray((w * h + 7) // 8)
    for y, row in enumerate(rows):
        assert len(row) == w
        for x, ch in enumerate(row):
            if ch == "#":
                i = y * w + x
                bits[i >> 3] |= 1 << (i & 7)
    out += bits
    return base64.urlsafe_b64encode(bytes(out)).decode().rstrip("=")


def grid(w, h, fn):
    return ["".join("#" if fn(x, y) else "." for x in range(w)) for y in range(h)]


PATTERNS = {
    "stripes": (grid(8, 8, lambda x, y: y < 2), 1, "common"),
    "checker": (grid(8, 8, lambda x, y: (x < 4) != (y < 4)), 1, "common"),
    "diagonal": (grid(8, 8, lambda x, y: (x + y) % 8 < 2), 1, "uncommon"),
    "dots": (grid(8, 8, lambda x, y: (x - 3.5) ** 2 + (y - 3.5) ** 2 < 4), 1, "uncommon"),
    "grid": (grid(8, 8, lambda x, y: x == 0 or y == 0), 1, "uncommon"),
    "diamonds": (grid(8, 8, lambda x, y: abs(x - 3.5) + abs(y - 3.5) < 3), 1, "rare"),
    "waves": (
        grid(16, 8, lambda x, y: abs(y - (3.5 + 2.5 * math.sin(x / 16 * 2 * math.pi))) < 1.1),
        1,
        "rare",
    ),
    "scales": (
        grid(8, 8, lambda x, y: abs(math.hypot(x - 3.5, y - (0 if y < 4 else 8)) - 3.5) < 0.9),
        1,
        "epic",
    ),
    "hexagons": (
        grid(
            12,
            14,
            lambda x, y: min(
                abs(abs(x - 6) * 0.866 + abs((y % 14) - 7) * 0.5 - 4.2),
                abs(abs((x + 6) % 12 - 6) * 0.866 + abs(((y + 7) % 14) - 7) * 0.5 - 4.2),
            )
            < 0.55,
        ),
        0,
        "rare",
    ),
    "triangles": (grid(8, 8, lambda x, y: x <= y), 1, "uncommon"),
    "zigzag": (grid(8, 8, lambda x, y: abs(((x + 2 * y) % 8) - 4) < 1.2), 1, "uncommon"),
    "bricks": (
        grid(8, 8, lambda x, y: y % 4 == 0 or (x == (0 if y < 4 else 4))),
        1,
        "common",
    ),
    "stars": (
        grid(
            10,
            10,
            lambda x, y: (abs(x - 4.5) < 0.6 and abs(y - 4.5) < 2.6)
            or (abs(y - 4.5) < 0.6 and abs(x - 4.5) < 2.6)
            or (abs(x - y) < 0.8 and abs(x - 4.5) < 1.6)
            or (abs(x + y - 9) < 0.8 and abs(x - 4.5) < 1.6),
        ),
        1,
        "epic",
    ),
    "crosses": (
        grid(8, 8, lambda x, y: (x in (3, 4) and 1 <= y <= 6) or (y in (3, 4) and 1 <= x <= 6)),
        1,
        "rare",
    ),
    "circuit": (
        grid(
            16,
            16,
            lambda x, y: (y == 3 and x < 11)
            or (x == 10 and 3 <= y <= 12)
            or (y == 12 and x >= 10)
            or (x == 4 and y >= 8)
            or (x - 4) ** 2 + (y - 8) ** 2 < 2
            or (x - 10) ** 2 + (y - 3) ** 2 < 2,
        ),
        0,
        "legendary",
    ),
}

PALETTES = {
    "chrome": ("#e5e7eb", "#6b7280"),
    "silver": ("#cbd5e1", "#334155"),
    "neon": ("#22d3ee", "#d946ef"),
    "ocean": ("#38bdf8", "#1e3a8a"),
    "sunset": ("#fb923c", "#9f1239"),
    "forest": ("#86efac", "#14532d"),
    "gold": ("#fde68a", "#a16207"),
    "midnight": ("#a5b4fc", "#0f172a"),
}


def cosmetic(name, rarity, **extra):
    return {"name": name, "product": None, "rarity": rarity, "artist": "OpenFront fork", **extra}


# ---------------------------------------------------------------- skins
SIZE = 512


def metal_fill(size, light, dark):
    """A vertical metallic gradient with a bright band, like polished chrome."""
    img = Image.new("RGBA", (size, size))
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        band = math.exp(-(((t - 0.38) / 0.09) ** 2)) * 0.9
        k = min(1.0, (1 - t) * 0.65 + band)
        c = tuple(int(dark[i] + (light[i] - dark[i]) * k) for i in range(3))
        for x in range(size):
            px[x, y] = c + (255,)
    return img


def stamp(mask, light, dark, outline=(30, 30, 35)):
    fill = metal_fill(SIZE, light, dark)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    edge = mask.filter(ImageFilter.MaxFilter(9))
    out.paste(Image.new("RGBA", (SIZE, SIZE), outline + (230,)), (0, 0), edge)
    out.paste(fill, (0, 0), mask)
    return out


def star_points(cx, cy, r_out, r_in, n=5, rot=-math.pi / 2):
    pts = []
    for i in range(n * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def mask_of(draw_fn):
    m = Image.new("L", (SIZE, SIZE), 0)
    draw_fn(ImageDraw.Draw(m))
    return m


def make_skins():
    os.makedirs(SKIN_DIR, exist_ok=True)
    c = SIZE / 2
    chrome = ((250, 250, 252), (95, 100, 112))
    skins = {
        "chrome_star": stamp(
            mask_of(lambda d: d.polygon(star_points(c, c * 1.04, 230, 95), fill=255)), *chrome
        ),
        "silver_shield": stamp(
            mask_of(
                lambda d: d.polygon(
                    [(c - 190, 60), (c + 190, 60), (c + 190, 250), (c, 470), (c - 190, 250)], fill=255
                )
            ),
            (235, 240, 248),
            (70, 82, 104),
        ),
        "neon_bolt": stamp(
            mask_of(
                lambda d: d.polygon(
                    [(300, 30), (130, 290), (240, 290), (190, 480), (390, 200), (275, 200), (350, 30)],
                    fill=255,
                )
            ),
            (165, 243, 252),
            (126, 34, 206),
            outline=(20, 10, 40),
        ),
        "golden_crown": stamp(
            mask_of(
                lambda d: (
                    d.polygon(
                        [(60, 400), (60, 150), (160, 270), (c, 90), (352, 270), (452, 150), (452, 400)],
                        fill=255,
                    ),
                    d.rectangle([60, 410, 452, 460], fill=255),
                )
            ),
            (254, 240, 138),
            (146, 64, 14),
        ),
        "target_rings": stamp(
            mask_of(
                lambda d: [
                    d.ellipse([c - r, c - r, c + r, c + r], outline=255, width=34)
                    for r in (230, 150, 70)
                ]
            ),
            (254, 202, 202),
            (153, 27, 27),
        ),
    }
    def ngon(cx, cy, r, n, rot=-math.pi / 2):
        return [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]

    def draw_sun(d):
        d.ellipse([c - 120, c - 120, c + 120, c + 120], fill=255)
        for i in range(12):
            a = i * math.pi / 6
            d.polygon(
                [
                    (c + 140 * math.cos(a - 0.12), c + 140 * math.sin(a - 0.12)),
                    (c + 235 * math.cos(a), c + 235 * math.sin(a)),
                    (c + 140 * math.cos(a + 0.12), c + 140 * math.sin(a + 0.12)),
                ],
                fill=255,
            )

    def draw_moon(d):
        d.ellipse([60, 40, 470, 450], fill=255)
        d.ellipse([170, 10, 540, 380], fill=0)
        d.polygon(star_points(390, 330, 55, 22), fill=255)

    def draw_snowflake(d):
        for i in range(6):
            a = i * math.pi / 3
            ex, ey = c + 220 * math.cos(a), c + 220 * math.sin(a)
            d.line([(c, c), (ex, ey)], fill=255, width=30)
            for t in (0.5, 0.75):
                bx, by = c + 220 * t * math.cos(a), c + 220 * t * math.sin(a)
                for s_ in (-1, 1):
                    b = a + s_ * math.pi / 4
                    d.line([(bx, by), (bx + 70 * math.cos(b), by + 70 * math.sin(b))], fill=255, width=22)
        d.polygon(ngon(c, c, 55, 6), fill=255)

    def draw_swords(d):
        for sgn in (-1, 1):
            a = math.pi / 4 * sgn
            dx, dy = math.sin(a), -math.cos(a)
            px, py = -dy, dx
            tip = (c + dx * 230, c + dy * 230)
            base = (c - dx * 150, c - dy * 150)
            d.polygon(
                [tip, (base[0] + px * 26, base[1] + py * 26), (base[0] - px * 26, base[1] - py * 26)], fill=255
            )
            g = (c - dx * 150, c - dy * 150)
            d.line([(g[0] + px * 80, g[1] + py * 80), (g[0] - px * 80, g[1] - py * 80)], fill=255, width=28)
            d.line([g, (c - dx * 235, c - dy * 235)], fill=255, width=30)

    def draw_anchor(d):
        d.ellipse([c - 50, 40, c + 50, 140], outline=255, width=26)
        d.line([(c, 140), (c, 440)], fill=255, width=40)
        d.line([(c - 120, 200), (c + 120, 200)], fill=255, width=32)
        d.arc([c - 190, 230, c + 190, 470], 10, 170, fill=255, width=40)
        d.polygon([(c - 210, 330), (c - 150, 300), (c - 160, 370)], fill=255)
        d.polygon([(c + 210, 330), (c + 150, 300), (c + 160, 370)], fill=255)

    def draw_rocket(d):
        d.polygon([(c, 30), (c + 85, 170), (c + 85, 360), (c - 85, 360), (c - 85, 170)], fill=255)
        d.polygon([(c - 85, 260), (c - 170, 400), (c - 85, 360)], fill=255)
        d.polygon([(c + 85, 260), (c + 170, 400), (c + 85, 360)], fill=255)
        d.polygon([(c - 50, 370), (c + 50, 370), (c, 480)], fill=255)

    def draw_flame(d):
        # Main teardrop: round base, pointed wavy tip.
        pts = []
        for i in range(181):
            t = i / 180 * 2 * math.pi
            x = 150 * math.sin(t)
            y = 150 * math.cos(t)
            if y < 0:  # upper half stretches into a point
                k = -y / 150
                x *= (1 - k) ** 0.8
                y = -150 - 230 * k
                x += 30 * math.sin(k * 5)
            pts.append((c + x, c + 120 + y))
        d.polygon(pts, fill=255)
        # Two side tongues.
        d.polygon([(c - 120, c + 120), (c - 205, c - 90), (c - 60, c - 20)], fill=255)
        d.polygon([(c + 120, c + 120), (c + 190, c - 60), (c + 60, c - 10)], fill=255)

    def draw_shuriken(d):
        pts = []
        for i in range(8):
            r = 235 if i % 2 == 0 else 70
            ang = math.pi / 4 * i + (0.25 if i % 2 else 0)
            pts.append((c + r * math.cos(ang), c + r * math.sin(ang)))
        d.polygon(pts, fill=255)
        d.ellipse([c - 32, c - 32, c + 32, c + 32], fill=0)

    def draw_skull(d):
        d.ellipse([c - 170, 40, c + 170, 360], fill=255)
        d.rounded_rectangle([c - 100, 300, c + 100, 450], radius=30, fill=255)
        d.ellipse([c - 120, 170, c - 30, 270], fill=0)
        d.ellipse([c + 30, 170, c + 120, 270], fill=0)
        d.polygon([(c, 280), (c - 25, 330), (c + 25, 330)], fill=0)
        for x in (-50, 0, 50):
            d.rectangle([c + x - 8, 390, c + x + 8, 450], fill=0)

    def draw_heart(d):
        pts = []
        for i in range(200):
            t = i / 200 * 2 * math.pi
            x = 16 * math.sin(t) ** 3
            y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
            pts.append((c + x * 13, c - 20 - y * 13))
        d.polygon(pts, fill=255)

    more = {
        "solar_crown": (draw_sun, (254, 249, 195), (194, 65, 12), "epic"),
        "crescent_night": (draw_moon, (224, 231, 255), (55, 48, 163), "rare"),
        "frost_flake": (draw_snowflake, (236, 254, 255), (14, 116, 144), "epic"),
        "crossed_blades": (draw_swords, (241, 245, 249), (71, 85, 105), "legendary"),
        "iron_anchor": (draw_anchor, (219, 234, 254), (30, 58, 138), "rare"),
        "star_rocket": (draw_rocket, (254, 226, 226), (127, 29, 29), "epic"),
        "wildfire": (draw_flame, (254, 240, 138), (194, 65, 12), "rare"),
        "ninja_star": (draw_shuriken, (250, 250, 249), (68, 64, 60), "legendary"),
        "bone_skull": (draw_skull, (250, 250, 250), (82, 82, 91), "epic"),
        "big_heart": (draw_heart, (254, 205, 211), (159, 18, 57), "uncommon"),
    }
    rarities = ["rare", "rare", "epic", "legendary", "uncommon"]
    for name, (fn, light, dark, rarity) in more.items():
        skins[name] = stamp(mask_of(fn), light, dark)
        rarities.append(rarity)

    for name, img in skins.items():
        img.save(os.path.join(SKIN_DIR, f"{name}.png"), optimize=True)
    return {
        name: cosmetic(name, rarity, url=f"cosmetics/skins/{name}.png")
        for name, rarity in zip(skins, rarities)
    }


# ---------------------------------------------------------------- effects
RAINBOW = ["#ff0000", "#ff8800", "#ffee00", "#22cc44", "#0088ff", "#8833ff"]
CHROME = ["#f8fafc", "#94a3b8", "#e2e8f0", "#475569"]
NEON = ["#22d3ee", "#d946ef", "#a3e635"]
FIRE = ["#fef08a", "#fb923c", "#dc2626", "#450a0a"]
ICE = ["#ecfeff", "#67e8f9", "#0e7490"]
GOLD = ["#fef3c7", "#facc15", "#a16207"]


def effect(effect_type, name, rarity, attributes):
    return cosmetic(name, rarity, effectType=effect_type, attributes=attributes)


def make_effects():
    e = {
        "transportShipTrail": [
            ("rainbow_wake", "rare", {"type": "gradient", "colors": RAINBOW, "colorSize": 3, "movementSpeed": 6}),
            ("chrome_wake", "uncommon", {"type": "gradient", "colors": CHROME, "colorSize": 2, "movementSpeed": 4}),
            ("neon_pulse", "rare", {"type": "transition", "colors": NEON, "frequency": 2}),
            ("ice_wake", "common", {"type": "gradient", "colors": ICE, "colorSize": 3, "movementSpeed": 3}),
            ("morse_wake", "rare", {"type": "dashed", "colors": CHROME, "dashLength": 2, "movementSpeed": 4}),
            ("candy_dash", "epic", {"type": "dashed", "colors": ["#f43f5e", "#ffffff"], "dashLength": 1.5, "movementSpeed": 3}),
            ("stardust_wake", "legendary", {"type": "sparkle", "colors": ["#fef9c3", "#bae6fd", "#f5d0fe"], "density": 0.45, "twinkleSpeed": 6}),
            ("sonar_pulse", "epic", {"type": "pulse", "colors": ["#22d3ee"], "pulseLength": 3, "movementSpeed": 12}),
        ],
        "nukeTrail": [
            ("fire_tail", "uncommon", {"type": "gradient", "colors": FIRE, "colorSize": 3, "movementSpeed": 8}),
            ("chrome_spiral", "epic", {"type": "spiral", "colors": CHROME, "radius": 6, "strands": 3, "rotationSpeed": 6}),
            ("plasma_spiral", "legendary", {"type": "spiral", "colors": NEON, "radius": 8, "strands": 4, "rotationSpeed": 8}),
            ("rainbow_tail", "rare", {"type": "gradient", "colors": RAINBOW, "colorSize": 4, "movementSpeed": 10}),
            ("tracer_dash", "rare", {"type": "dashed", "colors": ["#fde047", "#f97316"], "dashLength": 3, "movementSpeed": 15}),
            ("comet_sparks", "legendary", {"type": "sparkle", "colors": FIRE, "density": 0.6, "twinkleSpeed": 10}),
            ("ion_pulse", "epic", {"type": "pulse", "colors": NEON, "pulseLength": 4, "movementSpeed": 25}),
            ("ghost_sparks", "epic", {"type": "sparkle", "colors": ["#f8fafc", "#a5b4fc"], "density": 0.3, "twinkleSpeed": 4}),
        ],
        "nukeExplosion": [],
        "structures": [
            ("chrome_shine", "rare", {"type": "gradient", "colors": CHROME, "colorSize": 2, "movementSpeed": 3}),
            ("rainbow_buildings", "epic", {"type": "transition", "colors": RAINBOW, "frequency": 1}),
        ],
        "warship": [
            ("chrome_fleet", "rare", {"type": "gradient", "colors": CHROME, "colorSize": 2, "movementSpeed": 3}),
            ("neon_fleet", "epic", {"type": "transition", "colors": NEON, "frequency": 1.5}),
        ],
        "train": [
            ("gold_express", "rare", {"type": "gradient", "colors": GOLD, "colorSize": 2, "movementSpeed": 4}),
            ("rainbow_express", "epic", {"type": "transition", "colors": RAINBOW, "frequency": 2}),
        ],
        "railroad": [
            ("silver_rails", "uncommon", {"type": "gradient", "colors": CHROME, "colorSize": 3, "movementSpeed": 2}),
            ("neon_rails", "rare", {"type": "transition", "colors": NEON, "frequency": 1}),
        ],
    }
    explosion_looks = [
        ("chrome_shockwave", "rare", {"type": "shockwave", "colors": CHROME, "size": 40, "speed": 30, "thickness": 3, "transitionSpeed": 2}),
        ("neon_sparkles", "epic", {"type": "sparkles", "colors": NEON, "size": 45, "speed": 25, "thickness": 1.5, "transitionSpeed": 3, "density": 120}),
        ("fire_embers", "rare", {"type": "embers", "colors": FIRE, "size": 40, "speed": 20, "thickness": 1.5, "transitionSpeed": 2, "density": 150}),
    ]
    sizes = {"atom": 1.0, "hydro": 2.2, "mirvWarhead": 0.6}
    for nuke_type, mult in sizes.items():
        for name, rarity, attrs in explosion_looks:
            a = dict(attrs, nukeType=nuke_type, size=round(attrs["size"] * mult, 1))
            e["nukeExplosion"].append((f"{name}_{nuke_type.lower()}", rarity, a))
    return {
        t: {name: effect(t, name, rarity, attrs) for name, rarity, attrs in items}
        for t, items in e.items()
    }


def main():
    catalog = {
        "colorPalettes": {name: {"name": name, "primaryColor": a, "secondaryColor": b} for name, (a, b) in PALETTES.items()},
        "patterns": {
            name: cosmetic(
                name,
                rarity,
                pattern=encode_pattern(rows, scale),
                colorPalettes=[{"name": p, "isArchived": False} for p in PALETTES],
            )
            for name, (rows, scale, rarity) in PATTERNS.items()
        },
        "flags": {},
        "skins": make_skins(),
        "effects": make_effects(),
    }
    with open(os.path.join(OUT_DIR, "cosmetics.json"), "w") as f:
        json.dump(catalog, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
