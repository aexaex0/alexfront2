// Static scenery of the FPS world (houses around every capture point, trees on
// open land) and the geometry queries the game needs against it.

import { Cell, FpsTerrain } from "./FpsTerrain";
import { BOX_STRIDE } from "./FpsRenderer";
import { Rng, trs } from "./FpsMath";

export interface Box3 {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface PointSite {
  x: number;
  z: number;
  radius: number;
}

export class FpsWorld {
  readonly houses: Box3[] = [];
  /** Instance data for everything static (houses, roofs, trees, poles). */
  staticBoxes = new Float32Array(BOX_STRIDE * 4096);
  staticCount = 0;
  /** Coarse lookup of houses by 16 m cells. */
  private houseGrid = new Map<number, number[]>();

  constructor(
    readonly terrain: FpsTerrain,
    sites: PointSite[],
    seed: number,
  ) {
    const rng = new Rng(seed);
    for (const s of sites) this.placeHouses(s, sites, rng);
    for (const h of this.houses) this.indexHouse(h);
    for (const s of sites) this.addFlagPole(s);
    this.placeTrees(sites, rng);
  }

  private push(
    tx: number,
    ty: number,
    tz: number,
    yaw: number,
    pitch: number,
    roll: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if ((this.staticCount + 1) * BOX_STRIDE > this.staticBoxes.length) {
      const bigger = new Float32Array(this.staticBoxes.length * 2);
      bigger.set(this.staticBoxes);
      this.staticBoxes = bigger;
    }
    const o = this.staticCount * BOX_STRIDE;
    trs(this.staticBoxes, o, tx, ty, tz, yaw, pitch, roll, sx, sy, sz);
    this.staticBoxes[o + 16] = r;
    this.staticBoxes[o + 17] = g;
    this.staticBoxes[o + 18] = b;
    this.staticBoxes[o + 19] = 1;
    this.staticCount++;
  }

  private buildable(x: number, z: number, w: number, d: number): boolean {
    const t = this.terrain;
    let lo = Infinity;
    let hi = -Infinity;
    for (const [cx, cz] of [
      [x - w / 2, z - d / 2],
      [x + w / 2, z - d / 2],
      [x - w / 2, z + d / 2],
      [x + w / 2, z + d / 2],
      [x, z],
    ]) {
      if (!t.passable(cx, cz) || t.kindAt(cx, cz) !== Cell.Land) return false;
      const h = t.heightAt(cx, cz);
      if (h < 0.8) return false;
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo < 2.2;
  }

  private overlapsHouse(
    x: number,
    z: number,
    w: number,
    d: number,
    margin: number,
  ): boolean {
    for (const h of this.houses) {
      if (
        x + w / 2 + margin > h.minX &&
        x - w / 2 - margin < h.maxX &&
        z + d / 2 + margin > h.minZ &&
        z - d / 2 - margin < h.maxZ
      ) {
        return true;
      }
    }
    return false;
  }

  private placeHouses(site: PointSite, sites: PointSite[], rng: Rng): void {
    const t = this.terrain;
    const want = 5 + rng.int(4);
    let placed = 0;
    for (let attempt = 0; attempt < 60 && placed < want; attempt++) {
      const ang = rng.next() * Math.PI * 2;
      const dist = site.radius + 5 + rng.next() * 24;
      const x = site.x + Math.cos(ang) * dist;
      const z = site.z + Math.sin(ang) * dist;
      const w = 5 + rng.next() * 4;
      const d = 5 + rng.next() * 4;
      if (!this.buildable(x, z, w, d)) continue;
      if (this.overlapsHouse(x, z, w, d, 3)) continue;
      if (
        sites.some(
          (s) =>
            Math.hypot(s.x - x, s.z - z) < s.radius + Math.max(w, d) / 2 + 2,
        )
      ) {
        continue;
      }
      let base = Infinity;
      let top = -Infinity;
      for (const [cx, cz] of [
        [x - w / 2, z - d / 2],
        [x + w / 2, z - d / 2],
        [x - w / 2, z + d / 2],
        [x + w / 2, z + d / 2],
      ]) {
        base = Math.min(base, t.heightAt(cx, cz));
        top = Math.max(top, t.heightAt(cx, cz));
      }
      const wallH = 3.4 + rng.next() * 2.4;
      const y0 = base - 0.6;
      const y1 = top + wallH;
      this.houses.push({
        minX: x - w / 2,
        minY: y0,
        minZ: z - d / 2,
        maxX: x + w / 2,
        maxY: y1,
        maxZ: z + d / 2,
      });
      const tone = 0.78 + rng.next() * 0.16;
      const tint = rng.next();
      this.push(
        x,
        (y0 + y1) / 2,
        z,
        0,
        0,
        0,
        w,
        y1 - y0,
        d,
        tone,
        tone * (0.93 + tint * 0.05),
        tone * (0.82 + tint * 0.1),
      );
      // Gable roof along the longer side.
      const along = w >= d;
      const span = along ? d : w;
      const len = (along ? w : d) + 0.6;
      const slope = 0.62;
      const half = span / 2 / Math.cos(slope) + 0.25;
      const rr = 0.55 + rng.next() * 0.2;
      const rg = 0.18 + rng.next() * 0.12;
      const rb = 0.12 + rng.next() * 0.06;
      const rise = Math.tan(slope) * (span / 4);
      for (const side of [-1, 1]) {
        const off = (span / 4) * side;
        if (along) {
          this.push(
            x,
            y1 + rise,
            z + off,
            0,
            side * slope,
            0,
            len,
            0.22,
            half,
            rr,
            rg,
            rb,
          );
        } else {
          this.push(
            x + off,
            y1 + rise,
            z,
            0,
            0,
            -side * slope,
            half,
            0.22,
            len,
            rr,
            rg,
            rb,
          );
        }
      }
      // Door and a couple of windows on the side facing the point.
      const fx = site.x - x;
      const fz = site.z - z;
      const doorOnX = Math.abs(fx) / w > Math.abs(fz) / d;
      const dy = base + 1.0;
      if (doorOnX) {
        const sx = x + Math.sign(fx) * (w / 2 + 0.02);
        this.push(sx, dy, z, 0, 0, 0, 0.08, 2.0, 1.1, 0.28, 0.18, 0.1);
        for (const o of [-d / 3, d / 3])
          this.push(
            sx,
            base + 2.3,
            z + o,
            0,
            0,
            0,
            0.08,
            0.8,
            0.9,
            0.2,
            0.28,
            0.34,
          );
      } else {
        const sz = z + Math.sign(fz) * (d / 2 + 0.02);
        this.push(x, dy, sz, 0, 0, 0, 1.1, 2.0, 0.08, 0.28, 0.18, 0.1);
        for (const o of [-w / 3, w / 3])
          this.push(
            x + o,
            base + 2.3,
            sz,
            0,
            0,
            0,
            0.9,
            0.8,
            0.08,
            0.2,
            0.28,
            0.34,
          );
      }
      placed++;
    }
  }

  private addFlagPole(s: PointSite): void {
    const y = this.terrain.heightAt(s.x, s.z);
    this.push(s.x, y + 4, s.z, 0, 0, 0, 0.14, 8, 0.14, 0.75, 0.75, 0.78);
    this.push(s.x, y + 0.15, s.z, 0, 0, 0, 1.4, 0.3, 1.4, 0.5, 0.5, 0.52);
  }

  private placeTrees(sites: PointSite[], rng: Rng): void {
    const t = this.terrain;
    const area = t.sizeX * t.sizeZ;
    const tries = Math.min(9000, Math.floor(area / 90));
    for (let n = 0; n < tries; n++) {
      const x = rng.next() * t.sizeX;
      const z = rng.next() * t.sizeZ;
      // Clumps: keep trees where a coarse noise is high.
      const clump =
        Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2) +
        Math.cos(z * 0.025 - x * 0.006);
      if (clump < 0.55 + rng.next() * 0.6) continue;
      if (!t.passable(x, z) || t.kindAt(x, z) !== Cell.Land) continue;
      const y = t.heightAt(x, z);
      if (y < 1.1 || y > 19 || t.slope(x, z) > 0.55) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < s.radius + 5))
        continue;
      if (this.houseAt(x, z, 1.5)) continue;
      const h = 2 + rng.next() * 1.6;
      const s = 1.8 + rng.next() * 1.4;
      this.push(x, y + h / 2, z, 0, 0, 0, 0.32, h, 0.32, 0.35, 0.24, 0.14);
      const g = 0.25 + rng.next() * 0.15;
      const yaw = rng.next() * Math.PI;
      if (rng.next() < 0.5) {
        // Conifer: stacked, narrowing boxes.
        this.push(
          x,
          y + h + s * 0.45,
          z,
          yaw,
          0,
          0,
          s * 1.3,
          s * 0.9,
          s * 1.3,
          0.12,
          g,
          0.12,
        );
        this.push(
          x,
          y + h + s * 1.15,
          z,
          yaw + 0.7,
          0,
          0,
          s * 0.85,
          s * 0.8,
          s * 0.85,
          0.13,
          g + 0.04,
          0.13,
        );
        this.push(
          x,
          y + h + s * 1.7,
          z,
          yaw,
          0,
          0,
          s * 0.4,
          s * 0.6,
          s * 0.4,
          0.14,
          g + 0.06,
          0.14,
        );
      } else {
        // Broadleaf: two offset blobs.
        this.push(
          x,
          y + h + s * 0.6,
          z,
          yaw,
          0,
          0,
          s * 1.6,
          s * 1.2,
          s * 1.6,
          0.2,
          g + 0.1,
          0.12,
        );
        this.push(
          x + 0.3,
          y + h + s * 1.2,
          z - 0.2,
          yaw + 0.8,
          0,
          0,
          s * 1.1,
          s * 0.9,
          s * 1.1,
          0.22,
          g + 0.14,
          0.13,
        );
      }
      if (this.staticCount > 20000) break;
    }
  }

  private cellKey(i: number, j: number): number {
    return j * 4096 + i;
  }

  private indexHouse(h: Box3): void {
    const i0 = Math.floor(h.minX / 16);
    const i1 = Math.floor(h.maxX / 16);
    const j0 = Math.floor(h.minZ / 16);
    const j1 = Math.floor(h.maxZ / 16);
    const idx = this.houses.indexOf(h);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = this.cellKey(i, j);
        const list = this.houseGrid.get(k);
        if (list) list.push(idx);
        else this.houseGrid.set(k, [idx]);
      }
    }
  }

  /** A house whose footprint (grown by `margin`) contains (x, z). */
  houseAt(x: number, z: number, margin = 0): Box3 | null {
    const list = this.houseGrid.get(
      this.cellKey(Math.floor(x / 16), Math.floor(z / 16)),
    );
    if (!list) {
      // Margin can reach into a neighbouring cell.
      if (margin <= 0) return null;
    }
    for (const h of this.housesNear(x, z, margin)) {
      if (
        x > h.minX - margin &&
        x < h.maxX + margin &&
        z > h.minZ - margin &&
        z < h.maxZ + margin
      )
        return h;
    }
    return null;
  }

  housesNear(x: number, z: number, r: number): Box3[] {
    const out: Box3[] = [];
    const seen = new Set<number>();
    for (let j = Math.floor((z - r) / 16); j <= Math.floor((z + r) / 16); j++) {
      for (
        let i = Math.floor((x - r) / 16);
        i <= Math.floor((x + r) / 16);
        i++
      ) {
        const list = this.houseGrid.get(this.cellKey(i, j));
        if (!list) continue;
        for (const idx of list) {
          if (seen.has(idx)) continue;
          seen.add(idx);
          out.push(this.houses[idx]);
        }
      }
    }
    return out;
  }

  /**
   * Pushes a circle (a person, radius r, standing between y and y + 1.8) out
   * of any house it overlaps. Returns the corrected position.
   */
  collide(x: number, y: number, z: number, r: number): [number, number] {
    for (const h of this.housesNear(x, z, r + 1)) {
      if (y > h.maxY || y + 1.8 < h.minY) continue;
      const cx = Math.max(h.minX, Math.min(x, h.maxX));
      const cz = Math.max(h.minZ, Math.min(z, h.maxZ));
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r;
        z = cz + (dz / d) * r;
      } else {
        // Center inside the box: leave by the nearest face.
        const l = x - h.minX;
        const rr = h.maxX - x;
        const u = z - h.minZ;
        const dd = h.maxZ - z;
        const m = Math.min(l, rr, u, dd);
        if (m === l) x = h.minX - r;
        else if (m === rr) x = h.maxX + r;
        else if (m === u) z = h.minZ - r;
        else z = h.maxZ + r;
      }
    }
    return [x, z];
  }

  /** Nearest hit of a segment with any house, as a fraction (or -1). */
  raycastHouses(
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
    let best = -1;
    // Walk the 16 m cells along the segment.
    const steps = Math.max(1, Math.ceil(len / 8));
    const seen = new Set<Box3>();
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      for (const h of this.housesNear(ax + dx * t, az + dz * t, 9)) {
        if (seen.has(h)) continue;
        seen.add(h);
        const hit = segmentBox(ax, ay, az, dx, dy, dz, h);
        if (hit >= 0 && (best < 0 || hit < best)) best = hit;
      }
      if (best >= 0 && best < t) break;
    }
    return best;
  }
}

/** Slab test: fraction along (d) where the segment enters the box, or -1. */
export function segmentBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: Box3,
): number {
  let t0 = 0;
  let t1 = 1;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const lo = [b.minX, b.minY, b.minZ];
  const hi = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < lo[a] || o[a] > hi[a]) return -1;
      continue;
    }
    let ta = (lo[a] - o[a]) / d[a];
    let tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return -1;
  }
  return t0;
}
