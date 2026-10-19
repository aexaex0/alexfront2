// The FPS world's ground, built from an AlexFront map's terrain bytes:
// land becomes rolling hills (height from the tile's magnitude), water stays
// water, and the map's impassable border becomes a ring of cliffs.

import { clamp } from "./FpsMath";

export enum Cell {
  Land = 0,
  Water = 1,
  Wall = 2,
}

/** Terrain bytes as the map files store them (see GameMapImpl). */
const IS_LAND_BIT = 7;
const MAGNITUDE_MASK = 0x1f;
const IMPASSABLE = 31;

export const WATER_LEVEL = 0;
const LAND_MIN = 0.7;
const HILL_HEIGHT = 26;
const WALL_HEIGHT = 34;

export interface TerrainSource {
  /** One terrain byte per tile, row-major. */
  bytes: Uint8Array;
  width: number;
  height: number;
}

export class FpsTerrain {
  /** Grid vertices along x and z. */
  readonly gw: number;
  readonly gh: number;
  /** Meters between grid vertices. */
  readonly cell: number;
  /** Size of the playable rectangle in meters. */
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly heights: Float32Array;
  readonly kinds: Uint8Array;
  /** Source-map pixels per grid cell (to place manifest coordinates). */
  readonly srcPerCellX: number;
  readonly srcPerCellZ: number;

  constructor(
    src: TerrainSource,
    /** Width of the full-resolution map (manifest coordinates are in it). */
    fullWidth: number,
    fullHeight: number,
    maxGrid = 360,
    targetSize = 900,
  ) {
    const factor = Math.max(
      1,
      Math.ceil(Math.max(src.width, src.height) / maxGrid),
    );
    this.gw = Math.floor(src.width / factor);
    this.gh = Math.floor(src.height / factor);
    this.cell = clamp(targetSize / Math.max(this.gw, this.gh), 1.6, 4);
    this.sizeX = (this.gw - 1) * this.cell;
    this.sizeZ = (this.gh - 1) * this.cell;
    this.srcPerCellX = fullWidth / this.gw;
    this.srcPerCellZ = fullHeight / this.gh;

    const n = this.gw * this.gh;
    const kinds = new Uint8Array(n);
    const land = new Float32Array(n);
    const waterDepth = new Float32Array(n);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) {
        let water = 0;
        let wall = 0;
        let landCount = 0;
        let mag = 0;
        let wmag = 0;
        for (let dj = 0; dj < factor; dj++) {
          const row = (j * factor + dj) * src.width;
          for (let di = 0; di < factor; di++) {
            const b = src.bytes[row + i * factor + di];
            if (b & (1 << IS_LAND_BIT)) {
              const m = b & MAGNITUDE_MASK;
              if (m === IMPASSABLE) wall++;
              else {
                landCount++;
                mag += m;
              }
            } else {
              water++;
              wmag += b & MAGNITUDE_MASK;
            }
          }
        }
        const k = j * this.gw + i;
        const total = factor * factor;
        if (wall * 2 > total) kinds[k] = Cell.Wall;
        else if (water > 0 && water * 3 >= total * 1) kinds[k] = Cell.Water;
        else if (landCount === 0 && water > 0) kinds[k] = Cell.Water;
        else kinds[k] = Cell.Land;
        land[k] = landCount > 0 ? mag / landCount : 0;
        waterDepth[k] = water > 0 ? wmag / water : 0;
      }
    }
    // The map's outer frame is always wall, so nobody walks off the world.
    for (let i = 0; i < this.gw; i++) {
      kinds[i] = Cell.Wall;
      kinds[(this.gh - 1) * this.gw + i] = Cell.Wall;
    }
    for (let j = 0; j < this.gh; j++) {
      kinds[j * this.gw] = Cell.Wall;
      kinds[j * this.gw + this.gw - 1] = Cell.Wall;
    }
    this.kinds = kinds;

    // Raw heights, then a few smoothing passes over land only (walls keep
    // their cliff edge, water its shore).
    let h = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (kinds[k] === Cell.Wall) h[k] = WALL_HEIGHT;
      else if (kinds[k] === Cell.Water)
        h[k] = WATER_LEVEL - clamp(1.2 + waterDepth[k] * 0.6, 1.2, 7);
      else h[k] = LAND_MIN + (land[k] / 30) * HILL_HEIGHT;
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = new Float32Array(h);
      for (let j = 1; j < this.gh - 1; j++) {
        for (let i = 1; i < this.gw - 1; i++) {
          const k = j * this.gw + i;
          if (kinds[k] === Cell.Wall) continue;
          let s = 0;
          let c = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const kk = k + dj * this.gw + di;
              if (kinds[kk] === Cell.Wall) continue;
              if ((kinds[kk] === Cell.Water) !== (kinds[k] === Cell.Water))
                continue;
              s += h[kk];
              c++;
            }
          }
          next[k] = s / c;
        }
      }
      h = next;
    }
    // Land always stands above the water line; walls get a rough top.
    for (let k = 0; k < n; k++) {
      if (kinds[k] === Cell.Land) h[k] = Math.max(h[k], LAND_MIN);
      if (kinds[k] === Cell.Wall) {
        const i = k % this.gw;
        const j = (k / this.gw) | 0;
        h[k] = WALL_HEIGHT + Math.sin(i * 0.7) * 2 + Math.cos(j * 0.9) * 2;
      }
    }
    this.heights = h;
  }

  kindAt(x: number, z: number): Cell {
    const i = Math.round(x / this.cell);
    const j = Math.round(z / this.cell);
    if (i < 0 || j < 0 || i >= this.gw || j >= this.gh) return Cell.Wall;
    return this.kinds[j * this.gw + i] as Cell;
  }

  /** Ground height (bilinear over the grid). */
  heightAt(x: number, z: number): number {
    const fx = clamp(x / this.cell, 0, this.gw - 1.001);
    const fz = clamp(z / this.cell, 0, this.gh - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * this.gw + i;
    const h = this.heights;
    const a = h[k] + (h[k + 1] - h[k]) * tx;
    const b = h[k + this.gw] + (h[k + this.gw + 1] - h[k + this.gw]) * tx;
    return a + (b - a) * tz;
  }

  /** True when a person can stand or swim here. */
  passable(x: number, z: number): boolean {
    if (x < this.cell || z < this.cell) return false;
    if (x > this.sizeX - this.cell || z > this.sizeZ - this.cell) return false;
    return this.kindAt(x, z) !== Cell.Wall && this.heightAt(x, z) < 22;
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < WATER_LEVEL - 0.6;
  }

  /** Converts a full-resolution map pixel (manifest coordinates) to meters. */
  mapToWorld(px: number, py: number): [number, number] {
    return [
      (px / this.srcPerCellX) * this.cell,
      (py / this.srcPerCellZ) * this.cell,
    ];
  }

  /**
   * First point where the segment from a to b goes under ground, as a
   * fraction of the way (0..1), or -1 when it stays above it.
   */
  raycast(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
  ): number {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(2, Math.ceil(len / (this.cell * 0.5)));
    let prevT = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const y = ay + dy * t;
      if (y < this.heightAt(ax + dx * t, az + dz * t)) {
        // Refine between the last clear sample and this one.
        let lo = prevT;
        let hi = t;
        for (let r = 0; r < 6; r++) {
          const mid = (lo + hi) / 2;
          if (ay + dy * mid < this.heightAt(ax + dx * mid, az + dz * mid))
            hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prevT = t;
    }
    return -1;
  }

  /** Nearest land cell center to (x, z), searching outward. */
  nearestLand(x: number, z: number): [number, number] {
    const ci = Math.round(x / this.cell);
    const cj = Math.round(z / this.cell);
    for (let r = 0; r < Math.max(this.gw, this.gh); r++) {
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 2 || j < 2 || i >= this.gw - 2 || j >= this.gh - 2) continue;
          const k = j * this.gw + i;
          if (this.kinds[k] === Cell.Land && this.heights[k] < 20) {
            return [i * this.cell, j * this.cell];
          }
        }
      }
    }
    return [this.sizeX / 2, this.sizeZ / 2];
  }

  /** Surface normal (unnormalized is fine for slope checks) at (x, z). */
  slope(x: number, z: number): number {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.hypot(dx, dz) / (2 * e);
  }
}

/**
 * Coarse navigation grid with one distance field per objective, so bots can
 * walk downhill on it toward any capture point around water and walls.
 */
export class FpsNav {
  readonly nw: number;
  readonly nh: number;
  readonly step: number;
  /** 0 = blocked, otherwise the cost to enter. */
  readonly cost: Uint8Array;
  private fields = new Map<number, Float32Array>();

  constructor(
    private terrain: FpsTerrain,
    blocked: (x: number, z: number) => boolean,
  ) {
    this.step = terrain.cell * 2;
    this.nw = Math.floor(terrain.sizeX / this.step) + 1;
    this.nh = Math.floor(terrain.sizeZ / this.step) + 1;
    this.cost = new Uint8Array(this.nw * this.nh);
    for (let j = 0; j < this.nh; j++) {
      for (let i = 0; i < this.nw; i++) {
        const x = i * this.step;
        const z = j * this.step;
        let c = 1;
        if (!terrain.passable(x, z) || blocked(x, z)) c = 0;
        else if (terrain.isWater(x, z)) c = 4;
        else if (terrain.slope(x, z) > 0.9) c = 3;
        this.cost[j * this.nw + i] = c;
      }
    }
  }

  /** Builds (once) the field of walking distances to (x, z). */
  field(id: number, x: number, z: number): Float32Array {
    const cached = this.fields.get(id);
    if (cached) return cached;
    const n = this.nw * this.nh;
    const dist = new Float32Array(n).fill(Infinity);
    // Dial's algorithm-ish: small integer costs, bucket queue.
    const buckets: number[][] = [];
    const si = clamp(Math.round(x / this.step), 0, this.nw - 1);
    const sj = clamp(Math.round(z / this.step), 0, this.nh - 1);
    const start = sj * this.nw + si;
    dist[start] = 0;
    buckets[0] = [start];
    for (let d = 0; d < buckets.length; d++) {
      const b = buckets[d];
      if (!b) continue;
      for (let q = 0; q < b.length; q++) {
        const k = b[q];
        if (dist[k] < d) continue;
        const i = k % this.nw;
        const j = (k / this.nw) | 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const ni = i + di;
            const nj = j + dj;
            if (ni < 0 || nj < 0 || ni >= this.nw || nj >= this.nh) continue;
            const nk = nj * this.nw + ni;
            const c = this.cost[nk];
            if (c === 0) continue;
            // Diagonals cost a bit more (integer buckets: 2 vs 3 per cost).
            const nd = d + c * (di && dj ? 3 : 2);
            if (nd < dist[nk]) {
              dist[nk] = nd;
              (buckets[nd] ??= []).push(nk);
            }
          }
        }
      }
    }
    this.fields.set(id, dist);
    return dist;
  }

  /**
   * Direction to walk from (x, z) to reach the field's origin: toward the
   * lowest neighbour. Returns [0, 0] when already there or cut off.
   */
  direction(field: Float32Array, x: number, z: number): [number, number] {
    const i = clamp(Math.round(x / this.step), 0, this.nw - 1);
    const j = clamp(Math.round(z / this.step), 0, this.nh - 1);
    const here = field[j * this.nw + i];
    let best = here;
    let bx = 0;
    let bz = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= this.nw || nj >= this.nh) continue;
        const v = field[nj * this.nw + ni];
        if (v < best) {
          best = v;
          bx = ni * this.step - x;
          bz = nj * this.step - z;
        }
      }
    }
    if (best === here || !isFinite(best)) return [0, 0];
    const l = Math.hypot(bx, bz) || 1;
    return [bx / l, bz / l];
  }

  distance(field: Float32Array, x: number, z: number): number {
    const i = clamp(Math.round(x / this.step), 0, this.nw - 1);
    const j = clamp(Math.round(z / this.step), 0, this.nh - 1);
    return field[j * this.nw + i];
  }
}
