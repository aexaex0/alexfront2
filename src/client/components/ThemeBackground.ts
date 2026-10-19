import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { currentUiTheme, UI_THEME_CHANGED_EVENT } from "../UiTheme";
import type { UiTheme } from "../UserSettings";

/**
 * The animated, interactive main-menu background of the AlexFront UI styles.
 * One full-screen canvas behind the menu; each style draws its own scene and
 * reacts to the pointer (move) and to clicks. It sleeps while a game is
 * running, while the tab is hidden, and for the Classic style (which keeps
 * the original map backdrop).
 */

type Pointer = { x: number; y: number; active: boolean };

interface Scene {
  resize(w: number, h: number): void;
  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, p: Pointer): void;
  click(x: number, y: number): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

// ─── Chrome & Silver: liquid-metal orbs lit from the pointer ────────────────
class ChromeScene implements Scene {
  private w = 0;
  private h = 0;
  private orbs: { x: number; y: number; r: number; vx: number; vy: number }[] =
    [];
  private ripples: { x: number; y: number; age: number }[] = [];

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = Math.max(8, Math.round((w * h) / 90000));
    this.orbs = Array.from({ length: n }, () => ({
      x: rand(0, w),
      y: rand(0, h),
      r: rand(30, 110),
      vx: rand(-12, 12),
      vy: rand(-12, 12),
    }));
  }

  click(x: number, y: number) {
    this.ripples.push({ x, y, age: 0 });
    for (const o of this.orbs) {
      const dx = o.x - x;
      const dy = o.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 320) {
        o.vx += (dx / d) * (320 - d) * 0.6;
        o.vy += (dy / d) * (320 - d) * 0.6;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, p: Pointer) {
    const { w, h } = this;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#0b0d10");
    bg.addColorStop(0.5, "#1c2026");
    bg.addColorStop(1, "#08090b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // A slow diagonal light sweep across brushed metal.
    const sweep = ((t * 0.06) % 1.6) - 0.3;
    const sg = ctx.createLinearGradient(w * sweep - 200, 0, w * sweep + 200, h);
    sg.addColorStop(0, "rgba(255,255,255,0)");
    sg.addColorStop(0.5, "rgba(255,255,255,0.05)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);

    const lx = p.active ? p.x : w * 0.3;
    const ly = p.active ? p.y : h * 0.2;
    for (const o of this.orbs) {
      // Drift, a gentle pull toward the pointer, damping and soft walls.
      if (p.active) {
        const dx = p.x - o.x;
        const dy = p.y - o.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 400) {
          o.vx += (dx / d) * 8 * dt;
          o.vy += (dy / d) * 8 * dt;
        }
      }
      o.vx *= 1 - 0.4 * dt;
      o.vy *= 1 - 0.4 * dt;
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.x < -o.r) o.x = w + o.r;
      if (o.x > w + o.r) o.x = -o.r;
      if (o.y < -o.r) o.y = h + o.r;
      if (o.y > h + o.r) o.y = -o.r;

      // Specular highlight sits on the side facing the pointer "light".
      const ang = Math.atan2(ly - o.y, lx - o.x);
      const hx = o.x + Math.cos(ang) * o.r * 0.45;
      const hy = o.y + Math.sin(ang) * o.r * 0.45;
      const g = ctx.createRadialGradient(hx, hy, o.r * 0.04, o.x, o.y, o.r);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.18, "rgba(236,239,243,0.95)");
      g.addColorStop(0.55, "rgba(121,131,143,0.9)");
      g.addColorStop(0.85, "rgba(34,38,44,0.95)");
      g.addColorStop(0.97, "rgba(185,192,201,0.9)");
      g.addColorStop(1, "rgba(18,20,24,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const r of this.ripples) {
      r.age += dt;
      const rad = r.age * 520;
      ctx.strokeStyle = `rgba(236,239,243,${Math.max(0, 0.6 - r.age * 0.6)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.ripples = this.ripples.filter((r) => r.age < 1);
  }
}

// ─── Neon Grid: synthwave horizon, scrolling grid and a constellation ───────
class NeonScene implements Scene {
  private w = 0;
  private h = 0;
  private stars: { x: number; y: number; vx: number; vy: number }[] = [];
  private waves: { x: number; y: number; age: number }[] = [];

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = Math.max(40, Math.round((w * h) / 16000));
    this.stars = Array.from({ length: n }, () => ({
      x: rand(0, w),
      y: rand(0, h * 0.6),
      vx: rand(-8, 8),
      vy: rand(-8, 8),
    }));
  }

  click(x: number, y: number) {
    this.waves.push({ x, y, age: 0 });
  }

  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, p: Pointer) {
    const { w, h } = this;
    const horizon = h * 0.62;
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#05041a");
    sky.addColorStop(1, "#2a0b4a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, horizon);
    ctx.fillStyle = "#05041a";
    ctx.fillRect(0, horizon, w, h - horizon);

    // Striped sun on the horizon, nudged by the pointer (parallax).
    const px = p.active ? (p.x / w - 0.5) * 40 : 0;
    const sunR = Math.min(w, h) * 0.18;
    const sx = w / 2 + px;
    const sun = ctx.createLinearGradient(0, horizon - sunR * 2, 0, horizon);
    sun.addColorStop(0, "#fde047");
    sun.addColorStop(1, "#ec4899");
    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, horizon, sunR, Math.PI, 0);
    ctx.clip();
    ctx.fillStyle = sun;
    ctx.fillRect(sx - sunR, horizon - sunR, sunR * 2, sunR);
    ctx.fillStyle = "#2a0b4a";
    for (let i = 0; i < 6; i++) {
      const y = horizon - sunR * 0.12 - i * sunR * 0.13;
      ctx.fillRect(sx - sunR, y, sunR * 2, 2 + i * 0.6);
    }
    ctx.restore();

    // Perspective grid floor scrolling toward the viewer.
    ctx.strokeStyle = "rgba(34,211,238,0.55)";
    ctx.lineWidth = 1;
    const vx = w / 2 + px * 2;
    for (let i = -20; i <= 20; i++) {
      ctx.beginPath();
      ctx.moveTo(vx + i * 4, horizon);
      ctx.lineTo(w / 2 + i * w * 0.12, h);
      ctx.stroke();
    }
    const scroll = (t * 0.35) % 1;
    for (let i = 0; i < 18; i++) {
      const z = (i + scroll) / 18;
      const y = horizon + (h - horizon) * z * z;
      ctx.strokeStyle = `rgba(236,72,153,${0.15 + z * 0.6})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Stars drift; near the pointer they link up into a constellation.
    for (const s of this.stars) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < 0 || s.x > w) s.vx *= -1;
      if (s.y < 0 || s.y > horizon) s.vy *= -1;
      ctx.fillStyle = "rgba(207,250,254,0.9)";
      ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
    }
    if (p.active) {
      const near = this.stars.filter(
        (s) => Math.hypot(s.x - p.x, s.y - p.y) < 180,
      );
      for (let i = 0; i < near.length; i++) {
        const a = near[i];
        ctx.strokeStyle = `rgba(168,85,247,${0.8 - Math.hypot(a.x - p.x, a.y - p.y) / 230})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(a.x, a.y);
        ctx.stroke();
        for (let j = i + 1; j < near.length; j++) {
          const b = near[j];
          if (Math.hypot(a.x - b.x, a.y - b.y) < 90) {
            ctx.strokeStyle = "rgba(34,211,238,0.35)";
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
    }

    for (const wv of this.waves) {
      wv.age += dt;
      const rad = wv.age * 600;
      ctx.lineWidth = 3;
      ctx.strokeStyle = `rgba(34,211,238,${Math.max(0, 0.8 - wv.age * 0.8)})`;
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(236,72,153,${Math.max(0, 0.6 - wv.age * 0.6)})`;
      ctx.beginPath();
      ctx.arc(wv.x, wv.y, rad * 0.7, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.waves = this.waves.filter((wv) => wv.age < 1);
    ctx.lineWidth = 1;
  }
}

// ─── War Ember: war-room map, radar sweep and rising embers ─────────────────
class EmberScene implements Scene {
  private w = 0;
  private h = 0;
  private map: HTMLCanvasElement | null = null;
  private embers: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    size: number;
  }[] = [];

  resize(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.map = this.drawContours(w, h);
    const n = Math.max(60, Math.round((w * h) / 12000));
    this.embers = Array.from({ length: n }, () => this.newEmber(true));
  }

  private newEmber(anywhere: boolean) {
    return {
      x: rand(0, this.w),
      y: anywhere ? rand(0, this.h) : this.h + rand(0, 40),
      vx: rand(-10, 10),
      vy: rand(-70, -25),
      life: rand(0.5, 1),
      size: rand(1, 3),
    };
  }

  // Topographic contour lines, drawn once per resize.
  private drawContours(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.floor(w / 2));
    c.height = Math.max(1, Math.floor(h / 2));
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    const img = ctx.createImageData(c.width, c.height);
    const s1 = rand(0, 100);
    const s2 = rand(0, 100);
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const v =
          Math.sin(x * 0.012 + s1) * Math.cos(y * 0.014 - s2) +
          0.5 * Math.sin((x + y) * 0.008 + s2) +
          0.25 * Math.cos(x * 0.025 - y * 0.02);
        // Distance to the nearest contour level, as a soft thin line.
        const f = v * 3;
        const dist = Math.abs(f - Math.round(f));
        const a = Math.max(0, 1 - dist / 0.035) * 55;
        const i = (y * c.width + x) * 4;
        img.data[i] = 245;
        img.data[i + 1] = 158;
        img.data[i + 2] = 11;
        img.data[i + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  click(x: number, y: number) {
    for (let i = 0; i < 40; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(60, 260);
      this.embers.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 40,
        life: 1,
        size: rand(1.5, 3.5),
      });
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number, dt: number, p: Pointer) {
    const { w, h } = this;
    const bg = ctx.createRadialGradient(
      w / 2,
      h * 0.6,
      0,
      w / 2,
      h * 0.6,
      Math.max(w, h) * 0.8,
    );
    bg.addColorStop(0, "#3b1a0c");
    bg.addColorStop(1, "#0c0502");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (this.map) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.map, 0, 0, w, h);
    }

    // Radar sweep from the pointer (or the screen center).
    const cx = p.active ? p.x : w / 2;
    const cy = p.active ? p.y : h / 2;
    const ang = (t * 1.2) % (Math.PI * 2);
    const R = Math.hypot(w, h);
    const sweep = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.5);
    sweep.addColorStop(0, "rgba(252,211,77,0.18)");
    sweep.addColorStop(1, "rgba(252,211,77,0)");
    ctx.fillStyle = sweep;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, ang - 0.5, ang);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(252,211,77,0.25)";
    for (const r of [80, 160, 240]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Embers rise, flicker, and scatter away from the pointer.
    for (const e of this.embers) {
      if (p.active) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 140) {
          e.vx += (dx / d) * (140 - d) * 3 * dt;
          e.vy += (dy / d) * (140 - d) * 3 * dt;
        }
      }
      e.vx *= 1 - 0.8 * dt;
      e.vy += (-45 - e.vy) * 0.6 * dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.life -= dt * 0.12;
      const flicker = 0.6 + 0.4 * Math.sin(t * 12 + e.x);
      ctx.fillStyle = `rgba(251,146,60,${Math.max(0, e.life) * flicker})`;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
      ctx.fill();
    }
    const target = Math.max(60, Math.round((w * h) / 12000));
    this.embers = this.embers.filter(
      (e) => e.life > 0 && e.y > -20 && e.x > -40 && e.x < w + 40,
    );
    while (this.embers.length < target) this.embers.push(this.newEmber(false));
  }
}

const SCENES: Partial<Record<UiTheme, () => Scene>> = {
  chrome: () => new ChromeScene(),
  neon: () => new NeonScene(),
  ember: () => new EmberScene(),
};

@customElement("theme-background")
export class ThemeBackground extends LitElement {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private scene: Scene | null = null;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private pointer: Pointer = { x: 0, y: 0, active: false };
  private reducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  createRenderRoot() {
    return this;
  }

  render() {
    return html`<canvas
      class="fixed inset-0 w-full h-full -z-40 pointer-events-none"
      aria-hidden="true"
    ></canvas>`;
  }

  firstUpdated() {
    this.canvas = this.querySelector("canvas");
    this.ctx = this.canvas?.getContext("2d") ?? null;
    this.applyTheme();
  }

  connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener(UI_THEME_CHANGED_EVENT, this.applyTheme);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerdown", this.onPointerDown, {
      passive: true,
    });
    document.addEventListener("pointerleave", this.onPointerLeave);
  }

  disconnectedCallback() {
    globalThis.removeEventListener(UI_THEME_CHANGED_EVENT, this.applyTheme);
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    document.removeEventListener("pointerleave", this.onPointerLeave);
    cancelAnimationFrame(this.raf);
    super.disconnectedCallback();
  }

  private applyTheme = () => {
    const make = SCENES[currentUiTheme()];
    this.scene = make ? make() : null;
    if (this.canvas) this.canvas.style.display = this.scene ? "" : "none";
    this.onResize();
    cancelAnimationFrame(this.raf);
    if (this.scene) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  };

  private onResize = () => {
    if (!this.canvas || !this.ctx || !this.scene) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.scene.resize(w, h);
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointer = { x: e.clientX, y: e.clientY, active: true };
  };

  private onPointerLeave = () => {
    this.pointer = { ...this.pointer, active: false };
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.sleeping()) return;
    this.scene?.click(e.clientX, e.clientY);
  };

  private sleeping(): boolean {
    return document.hidden || document.body.classList.contains("in-game");
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    if (!this.scene || !this.ctx || this.sleeping()) {
      this.last = now;
      return;
    }
    // Clamp so a long pause doesn't fling everything across the screen.
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    const t = this.reducedMotion ? 0 : (now - this.start) / 1000;
    this.scene.draw(this.ctx, t, this.reducedMotion ? 0 : dt, this.pointer);
  };
}
