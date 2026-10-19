#!/usr/bin/env python3
"""Generates the AlexFront logo, wordmark and favicon.

Run from the repo root:  python3 scripts/generate-alexfront-logo.py
Writes into resources/images/:
  AlexFrontLogo.svg   wordmark used in the menus
  AlexFront.png       wide wordmark (social preview image)
  AF.png              short "AF" mark (mobile)
  AlexFrontIcon.svg   favicon
"""

import os

from PIL import Image, ImageDraw

OUT = "resources/images"

# A blocky 5x7 pixel font, drawn for this logo.
GLYPHS = {
    "A": [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "X": ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
    "F": ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
    "R": ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "N": ["#...#", "##..#", "#.#.#", "#.#.#", "#..##", "#...#", "#...#"],
    "T": ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
}

CELL = 10  # px per font pixel in the SVG
GAP = 1  # font pixels between letters
PAD = 1  # font pixels of padding around the word

# Chrome gradient stops (top -> bottom) and the dark outline.
STOPS = [(0.0, "#ffffff"), (0.35, "#cbd5e1"), (0.5, "#64748b"), (0.62, "#e2e8f0"), (1.0, "#94a3b8")]
OUTLINE = "#0f172a"


def cells(word):
    out, x = [], PAD
    for ch in word:
        g = GLYPHS[ch]
        for y, row in enumerate(g):
            for dx, c in enumerate(row):
                if c == "#":
                    out.append((x + dx, y + PAD))
        x += 5 + GAP
    width = x - GAP + PAD
    return out, width, 7 + 2 * PAD


def svg(word, accent_from=None):
    pts, w, h = cells(word)
    W, H = w * CELL, h * CELL
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in STOPS)
    rects = "".join(f'<rect x="{x * CELL}" y="{y * CELL}" width="{CELL}" height="{CELL}"/>' for x, y in pts)
    outline = "".join(
        f'<rect x="{x * CELL - 2}" y="{y * CELL - 2}" width="{CELL + 4}" height="{CELL + 4}"/>' for x, y in pts
    )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" shape-rendering="crispEdges">'
        f'<defs><linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">{stops}</linearGradient></defs>'
        f'<g fill="{OUTLINE}">{outline}</g><g fill="url(#chrome)">{rects}</g></svg>\n'
    )


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def hex_rgb(h):
    return tuple(int(h[i : i + 2], 16) for i in (1, 3, 5))


def chrome_at(t):
    for (o1, c1), (o2, c2) in zip(STOPS, STOPS[1:]):
        if o1 <= t <= o2:
            return lerp(hex_rgb(c1), hex_rgb(c2), (t - o1) / (o2 - o1))
    return hex_rgb(STOPS[-1][1])


def png(word, height):
    pts, w, h = cells(word)
    s = max(1, height // h)
    img = Image.new("RGBA", (w * s, h * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    o = max(1, s // 5)
    for x, y in pts:
        d.rectangle([x * s - o, y * s - o, (x + 1) * s + o - 1, (y + 1) * s + o - 1], fill=hex_rgb(OUTLINE) + (255,))
    for x, y in pts:
        for py in range(s):
            t = (y * s + py - PAD * s) / (7 * s)
            d.line([x * s, y * s + py, (x + 1) * s - 1, y * s + py], fill=chrome_at(max(0, min(1, t))) + (255,))
    return img


def main():
    with open(os.path.join(OUT, "AlexFrontLogo.svg"), "w") as f:
        f.write(svg("ALEXFRONT"))
    with open(os.path.join(OUT, "AlexFrontIcon.svg"), "w") as f:
        f.write(svg("AF"))
    png("ALEXFRONT", 298).save(os.path.join(OUT, "AlexFront.png"), optimize=True)
    png("AF", 298).save(os.path.join(OUT, "AF.png"), optimize=True)


if __name__ == "__main__":
    main()
