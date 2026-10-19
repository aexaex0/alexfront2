// The FPS mode's world logic (no WebGL needed): terrain built from map
// bytes, bot navigation, houses and the battlefield crop.

import { prepareBattle } from "../src/client/fps/FpsLauncher";
import { forward, fpsView, mat4 } from "../src/client/fps/FpsMath";
import { Cell, FpsNav, FpsTerrain } from "../src/client/fps/FpsTerrain";
import { FpsWorld, segmentBox } from "../src/client/fps/FpsWorld";

const W = 120;
const H = 80;
const LAND = 0x80;

/** Flat land (magnitude 5), a river down the middle that stops short of the
 * bottom, a hill on the left and a block of impassable cliffs top right. */
function syntheticMap(): Uint8Array {
  const b = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v = LAND | 5;
      if (x >= 58 && x <= 62 && y < 55) v = 3; // water, magnitude 3
      if (x >= 20 && x <= 30 && y >= 30 && y <= 40) v = LAND | 28; // hill
      if (x >= 90 && x <= 110 && y >= 5 && y <= 20) v = LAND | 31; // cliffs
      b[y * W + x] = v;
    }
  }
  return b;
}

function terrain(): FpsTerrain {
  // Full-resolution map is twice the size of the 4x bytes here.
  return new FpsTerrain(
    { bytes: syntheticMap(), width: W, height: H },
    W * 2,
    H * 2,
    360,
    400,
  );
}

describe("FPS terrain", () => {
  test("classifies land, water and cliffs", () => {
    const t = terrain();
    const c = t.cell;
    expect(t.kindAt(10 * c, 60 * c)).toBe(Cell.Land);
    expect(t.kindAt(60 * c, 20 * c)).toBe(Cell.Water);
    expect(t.kindAt(100 * c, 10 * c)).toBe(Cell.Wall);
    // The outer frame is always a wall.
    expect(t.kindAt(0, 0)).toBe(Cell.Wall);
    expect(t.passable(10 * c, 60 * c)).toBe(true);
    expect(t.passable(100 * c, 10 * c)).toBe(false);
    expect(t.isWater(60 * c, 20 * c)).toBe(true);
    expect(t.isWater(10 * c, 60 * c)).toBe(false);
  });

  test("land stands above the water line and hills rise", () => {
    const t = terrain();
    const c = t.cell;
    const plain = t.heightAt(10 * c, 60 * c);
    const hill = t.heightAt(25 * c, 35 * c);
    expect(plain).toBeGreaterThan(0);
    expect(hill).toBeGreaterThan(plain + 10);
    expect(t.heightAt(60 * c, 20 * c)).toBeLessThan(0);
  });

  test("maps manifest coordinates onto the world", () => {
    const t = terrain();
    const [x, z] = t.mapToWorld(W, H); // middle of the full-resolution map
    expect(x).toBeCloseTo(t.sizeX / 2, -1);
    expect(z).toBeCloseTo(t.sizeZ / 2, -1);
  });

  test("raycasts stop at hills and pass over plains", () => {
    const t = terrain();
    const c = t.cell;
    const y = t.heightAt(10 * c, 35 * c) + 2;
    // Low across the hill: blocked.
    const hit = t.raycast(10 * c, y, 35 * c, 40 * c, y, 35 * c);
    expect(hit).toBeGreaterThan(0);
    expect(hit).toBeLessThan(1);
    // High above everything: clear.
    expect(t.raycast(10 * c, 60, 35 * c, 40 * c, 60, 35 * c)).toBe(-1);
  });
});

describe("FPS navigation", () => {
  test("bots find their way around the river's end to a point", () => {
    const t = terrain();
    const nav = new FpsNav(t, () => false);
    const c = t.cell;
    const target: [number, number] = [90 * c, 40 * c];
    const field = nav.field(0, target[0], target[1]);
    let x = 20 * c;
    let z = 10 * c;
    for (let i = 0; i < 2000; i++) {
      if (Math.hypot(x - target[0], z - target[1]) < nav.step * 1.5) break;
      const [dx, dz] = nav.direction(field, x, z);
      expect(dx !== 0 || dz !== 0).toBe(true);
      x += dx * c;
      z += dz * c;
    }
    expect(Math.hypot(x - target[0], z - target[1])).toBeLessThan(
      nav.step * 1.5,
    );
  });
});

describe("FPS world", () => {
  test("puts houses around points, never on them, and they block", () => {
    const t = terrain();
    const c = t.cell;
    const site = { x: 30 * c, z: 65 * c, radius: 11 };
    const world = new FpsWorld(t, [site], 7);
    expect(world.houses.length).toBeGreaterThan(0);
    expect(world.staticCount).toBeGreaterThan(world.houses.length);
    for (const h of world.houses) {
      const cx = (h.minX + h.maxX) / 2;
      const cz = (h.minZ + h.maxZ) / 2;
      expect(Math.hypot(cx - site.x, cz - site.z)).toBeGreaterThan(site.radius);
    }
    const h = world.houses[0];
    const cx = (h.minX + h.maxX) / 2;
    const cz = (h.minZ + h.maxZ) / 2;
    expect(world.houseAt(cx, cz)).toBe(h);
    // Someone standing in the middle of a house is pushed outside it.
    const [px, pz] = world.collide(cx, h.minY + 1, cz, 0.4);
    const inside = px > h.minX && px < h.maxX && pz > h.minZ && pz < h.maxZ;
    expect(inside).toBe(false);
    // A shot straight through the house hits its wall.
    const y = h.minY + 1.5;
    const hit = world.raycastHouses(h.minX - 5, y, cz, h.maxX + 5, y, cz);
    expect(hit).toBeGreaterThan(0);
    expect(hit).toBeLessThan(1);
  });

  test("segmentBox finds where a segment enters a box", () => {
    const box = { minX: 1, minY: 0, minZ: -1, maxX: 2, maxY: 1, maxZ: 1 };
    expect(segmentBox(0, 0.5, 0, 4, 0, 0, box)).toBeCloseTo(0.25);
    expect(segmentBox(0, 5, 0, 4, 0, 0, box)).toBe(-1);
  });
});

describe("FPS camera math", () => {
  test("the view matrix looks along the forward vector", () => {
    const yaw = 0.7;
    const pitch = -0.3;
    const view = fpsView(mat4(), 3, 4, 5, yaw, pitch);
    const [fx, fy, fz] = forward(yaw, pitch);
    // A point straight ahead lands on the view's -Z axis.
    const p = [3 + fx * 10, 4 + fy * 10, 5 + fz * 10];
    const vx = view[0] * p[0] + view[4] * p[1] + view[8] * p[2] + view[12];
    const vy = view[1] * p[0] + view[5] * p[1] + view[9] * p[2] + view[13];
    const vz = view[2] * p[0] + view[6] * p[1] + view[10] * p[2] + view[14];
    expect(vx).toBeCloseTo(0, 5);
    expect(vy).toBeCloseTo(0, 5);
    expect(vz).toBeCloseTo(-10, 5);
  });
});

describe("FPS battlefield", () => {
  const nations = [
    { name: "A", x: 20, y: 20, strength: 1 },
    { name: "B", x: 60, y: 30, strength: 2 },
    { name: "C", x: 200, y: 140, strength: 3 },
    { name: "D", x: 40, y: 60, strength: 1 },
  ];
  const map = {
    terrain: { bytes: syntheticMap(), width: W, height: H },
    fullWidth: W * 2,
    fullHeight: H * 2,
    nations,
  };

  test("puts the player's nation first with its nearest neighbours", () => {
    const b = prepareBattle(map, 1, 3);
    expect(b.playerNation).toBe(0);
    expect(b.nations.map((n) => n.name)).toEqual(["B", "D", "A"]);
  });

  test("crops the map around the chosen nations", () => {
    const b = prepareBattle(map, 1, 3);
    expect(b.terrain.width).toBeLessThanOrEqual(W);
    expect(b.terrain.height).toBeLessThanOrEqual(H);
    expect(b.terrain.bytes.length).toBe(b.terrain.width * b.terrain.height);
    for (const n of b.nations) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x).toBeLessThanOrEqual(b.fullWidth);
      expect(n.y).toBeLessThanOrEqual(b.fullHeight);
    }
  });
});
