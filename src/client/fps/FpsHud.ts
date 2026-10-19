// The FPS mode's heads-up display: plain DOM over the WebGL canvas.
// Crosshair, health, ammo, capture points, minimap, kill feed, scoreboard,
// and the intro / pause / end screens.

import { Cell, FpsTerrain } from "./FpsTerrain";

export interface HudTeam {
  name: string;
  css: string;
  color: [number, number, number];
  kills: number;
  eliminated: boolean;
}

export interface HudPoint {
  name: string;
  x: number;
  z: number;
  owner: number;
  capturer: number;
  control: number;
  contested: boolean;
}

export interface HudFeedEntry {
  killer: string;
  kc: string;
  victim: string;
  vc: string;
  head: boolean;
  grenade: boolean;
  at: number;
}

export interface HudState {
  time: number;
  alive: boolean;
  hp: number;
  ammo: number;
  reserve: number;
  grenades: number;
  reloading: boolean;
  team: number;
  x: number;
  z: number;
  yaw: number;
  /** Seconds until respawn; -1 when there is nowhere to respawn. */
  respawnIn: number;
  /** Point index the player picked to respawn at, or -1 (automatic). */
  spawnChoice: number;
  killedBy: string;
  spread: number;
  aiming: boolean;
  hitMarker: number;
  damage: number;
  points: HudPoint[];
  here: Omit<HudPoint, "x" | "z"> | null;
  allies: [number, number][];
  enemiesSeen: [number, number, number][];
  feed: HudFeedEntry[];
  aimed: { name: string; css: string; hp: number } | null;
  soldiers: { alive: number; points: number }[];
  playerKills: number;
  playerDeaths: number;
  /** Seconds left in the match. */
  timeLeft: number;
}

export interface HudCallbacks {
  onPlay: () => void;
  onQuit: () => void;
  onRestart: () => void;
  /** Mouse sensitivity as a multiplier (1 = default). */
  getSensitivity?: () => number;
  setSensitivity?: (v: number) => void;
}

type T = (key: string, params?: Record<string, string | number>) => string;

const NEUTRAL_CSS = "rgb(140,140,148)";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const CSS = `
.fps-hud{position:absolute;inset:0;pointer-events:none;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#fff;user-select:none;overflow:hidden;z-index:2;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.fps-hud *{box-sizing:border-box}
.fps-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,0) 45%,rgba(170,0,0,.85) 100%);opacity:0;transition:opacity .08s}
.fps-cross{position:absolute;left:50%;top:50%;width:0;height:0}
.fps-cross i{position:absolute;background:rgba(255,255,255,.92);box-shadow:0 0 2px rgba(0,0,0,.9)}
.fps-cross .h{height:2px;width:9px;top:-1px}
.fps-cross .v{width:2px;height:9px;left:-1px}
.fps-cross .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
.fps-hit{position:absolute;left:50%;top:50%;width:0;height:0;opacity:0}
.fps-hit i{position:absolute;width:12px;height:2px;background:#fff;left:-6px;top:-1px}
.fps-hit i:nth-child(1){transform:rotate(45deg) translateX(11px)}
.fps-hit i:nth-child(2){transform:rotate(135deg) translateX(11px)}
.fps-hit i:nth-child(3){transform:rotate(225deg) translateX(11px)}
.fps-hit i:nth-child(4){transform:rotate(315deg) translateX(11px)}
.fps-hurt{position:absolute;left:50%;top:50%;width:0;height:0}
.fps-hurt i{position:absolute;left:-60px;top:-150px;width:120px;height:26px;border-top:5px solid rgba(255,40,30,.9);border-radius:50%/100% 100% 0 0;transform-origin:60px 150px;filter:drop-shadow(0 0 6px rgba(255,0,0,.8))}
.fps-panel{position:absolute;background:linear-gradient(180deg,rgba(15,18,24,.62),rgba(15,18,24,.45));border:1px solid rgba(255,255,255,.14);border-radius:10px;backdrop-filter:blur(3px)}
.fps-health{left:20px;bottom:20px;padding:10px 14px;min-width:220px}
.fps-health .lbl{font-size:12px;letter-spacing:.12em;opacity:.75;text-transform:uppercase}
.fps-health .num{font-size:32px;font-weight:800;line-height:1}
.fps-bar{height:8px;border-radius:4px;background:rgba(255,255,255,.15);overflow:hidden;margin-top:6px}
.fps-bar b{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#22c55e);transition:width .15s}
.fps-ammo{right:20px;bottom:20px;padding:10px 16px;text-align:right;min-width:170px}
.fps-ammo .num{font-size:36px;font-weight:800;line-height:1}
.fps-ammo .res{font-size:18px;opacity:.7;font-weight:600}
.fps-ammo .gr{font-size:14px;color:#a3e635;letter-spacing:.2em;min-height:17px;margin-top:2px}
.fps-ammo .rl{font-size:12px;letter-spacing:.14em;color:#fbbf24;text-transform:uppercase;height:15px}
.fps-points{position:absolute;top:14px;left:50%;transform:translateX(-50%);display:flex;gap:6px}
.fps-pt{width:46px;height:46px;border-radius:9px;position:relative;overflow:hidden;border:2px solid rgba(255,255,255,.35);background:rgba(20,20,26,.6);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:19px}
.fps-pt .fill{position:absolute;left:0;right:0;bottom:0;opacity:.85}
.fps-pt span{position:relative}
.fps-pt.here{border-color:#fff;box-shadow:0 0 10px rgba(255,255,255,.7)}
.fps-pt.contested{animation:fpsPulse .5s infinite alternate}
@keyframes fpsPulse{from{border-color:#fff}to{border-color:#ef4444}}
.fps-timer{position:absolute;top:64px;left:50%;transform:translateX(-50%);font-size:14px;font-weight:800;letter-spacing:.08em;opacity:.85}
.fps-timer.low{color:#f87171;opacity:1}
.fps-capture{position:absolute;top:86px;left:50%;transform:translateX(-50%);width:340px;text-align:center;font-weight:700;font-size:15px;letter-spacing:.04em}
.fps-capture .fps-bar{height:10px;margin-top:5px}
.fps-capture .fps-bar b{transition:none}
.fps-minimap{left:16px;top:16px;width:200px;height:200px;padding:4px}
.fps-minimap canvas{width:100%;height:100%;border-radius:7px;display:block}
.fps-feed{position:absolute;right:16px;top:16px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;font-size:14px;font-weight:600}
.fps-feed div{background:rgba(10,12,16,.55);padding:3px 9px;border-radius:6px}
.fps-flash{position:absolute;left:50%;top:30%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:6px}
.fps-flash div{font-size:22px;font-weight:800;letter-spacing:.04em;animation:fpsFlash 2.2s forwards;white-space:nowrap}
@keyframes fpsFlash{0%{opacity:0;transform:scale(1.25)}10%{opacity:1;transform:scale(1)}75%{opacity:1}100%{opacity:0}}
.fps-aimed{position:absolute;left:50%;top:calc(50% + 26px);transform:translateX(-50%);font-size:14px;font-weight:700;white-space:nowrap}
.fps-dead{position:absolute;left:50%;top:58%;transform:translateX(-50%);text-align:center}
.fps-dead .big{font-size:30px;font-weight:800;color:#f87171}
.fps-dead .small{font-size:18px;opacity:.9;margin-top:6px}
.fps-dead .pick{font-size:14px;opacity:.8;margin-top:14px}
.fps-dead .spawns{display:flex;gap:8px;justify-content:center;margin-top:6px}
.fps-dead .spawns span{padding:4px 10px;border:2px solid;border-radius:8px;font-weight:800;font-size:15px;background:rgba(0,0,0,.35)}
.fps-dead .spawns span.on{background:rgba(255,255,255,.25)}
.fps-score{left:50%;top:50%;transform:translate(-50%,-50%);padding:18px 22px;min-width:460px;display:none}
.fps-score h3{margin:0 0 10px;font-size:18px;letter-spacing:.1em;text-transform:uppercase}
.fps-score table{border-collapse:collapse;width:100%;font-size:15px}
.fps-score th{text-align:left;font-size:12px;opacity:.7;text-transform:uppercase;letter-spacing:.08em;padding:4px 8px}
.fps-score td{padding:5px 8px;border-top:1px solid rgba(255,255,255,.08)}
.fps-score tr.me td{background:rgba(255,255,255,.08)}
.fps-score tr.out td{opacity:.4;text-decoration:line-through}
.fps-score .sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;vertical-align:-1px}
.fps-score .mine{margin-top:12px;font-size:14px;opacity:.85}
.fps-overlay{position:absolute;inset:0;pointer-events:auto;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(10,14,22,.55),rgba(5,7,12,.88));z-index:3}
.fps-card{max-width:560px;width:calc(100% - 32px);padding:28px 30px;border-radius:16px;background:linear-gradient(160deg,rgba(30,36,48,.95),rgba(16,19,26,.95));border:1px solid rgba(255,255,255,.16);box-shadow:0 20px 60px rgba(0,0,0,.6);text-align:center}
.fps-card h1{margin:0;font-size:38px;font-weight:900;letter-spacing:.04em}
.fps-card h2{margin:4px 0 14px;font-size:15px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;opacity:.7}
.fps-card p{margin:10px 0;font-size:15px;line-height:1.45;opacity:.9}
.fps-card .team{display:inline-flex;align-items:center;gap:10px;font-size:22px;font-weight:800;margin:6px 0 8px}
.fps-card .team i{width:18px;height:18px;border-radius:4px;display:inline-block}
.fps-card .keys{margin:14px 0 4px;padding:12px 14px;border-radius:10px;background:rgba(255,255,255,.06);font-size:13px;line-height:1.7;text-align:left;opacity:.9}
.fps-card .keys b{display:block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin-bottom:2px}
.fps-card .sens{display:flex;align-items:center;gap:12px;margin:14px 0 0;font-size:14px;text-align:left}
.fps-card .sens span{opacity:.8;white-space:nowrap}
.fps-card .sens input{flex:1;accent-color:#3b82f6}
.fps-card .sens b{min-width:40px;text-align:right}
.fps-btns{display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap}
.fps-btn{pointer-events:auto;cursor:pointer;border:0;border-radius:10px;padding:12px 26px;font-size:16px;font-weight:800;letter-spacing:.06em;color:#fff;background:linear-gradient(180deg,#3b82f6,#2563eb);box-shadow:0 4px 14px rgba(37,99,235,.45);text-transform:uppercase}
.fps-btn:hover{filter:brightness(1.12)}
.fps-btn.alt{background:rgba(255,255,255,.12);box-shadow:none}
.fps-btn.go{background:linear-gradient(180deg,#22c55e,#16a34a);box-shadow:0 4px 14px rgba(22,163,74,.45)}
.fps-note{font-size:13px;opacity:.75;margin-top:10px;min-height:16px}
.fps-legal{position:absolute;right:8px;bottom:4px;font-size:10px;opacity:.45}
@media (max-width:700px){.fps-minimap{width:120px;height:120px}.fps-score{min-width:0;width:calc(100% - 24px)}.fps-pt{width:34px;height:34px;font-size:14px}}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  parent: HTMLElement | null = null,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? "0" : ""}${sec}`;
}

export class FpsHud {
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;
  private vignette: HTMLDivElement;
  private cross: HTMLDivElement;
  private crossBars: HTMLElement[] = [];
  private crossDot: HTMLElement;
  private hit: HTMLDivElement;
  private hurt: HTMLDivElement;
  private hurtMarks: { el: HTMLElement; at: number; angle: number }[] = [];
  private hpNum: HTMLDivElement;
  private hpBar: HTMLElement;
  private ammoNum: HTMLSpanElement;
  private ammoRes: HTMLSpanElement;
  private ammoReload: HTMLDivElement;
  private grenadeEl: HTMLDivElement;
  private pointsBox: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private lastTimer = "";
  private pointEls: { box: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private capture: HTMLDivElement;
  private captureText: HTMLDivElement;
  private captureBar: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D | null;
  private miniBg: HTMLCanvasElement;
  private feedBox: HTMLDivElement;
  private flashBox: HTMLDivElement;
  private aimedEl: HTMLDivElement;
  private deadEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private overlay: HTMLDivElement | null = null;
  private lastFeedKey = "";
  private lastHp = -1;
  private lastAmmo = "";
  private scoreVisible = false;
  private now = 0;
  private lastState: HudState | null = null;
  private frame = 0;

  constructor(
    container: HTMLElement,
    private t: T,
    private teams: HudTeam[],
    private terrain: FpsTerrain,
    private cb: HudCallbacks,
  ) {
    this.style = el("style");
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    const root = el("div", "fps-hud", container);
    this.root = root;
    this.vignette = el("div", "fps-vignette", root);
    this.hurt = el("div", "fps-hurt", root);

    this.cross = el("div", "fps-cross", root);
    for (const c of ["h", "h", "v", "v"])
      this.crossBars.push(el("i", c, this.cross));
    this.crossDot = el("i", "dot", this.cross);
    this.hit = el("div", "fps-hit", root);
    for (let i = 0; i < 4; i++) el("i", "", this.hit);

    const health = el("div", "fps-panel fps-health", root);
    const hpLbl = el("div", "lbl", health);
    hpLbl.textContent = this.t("fps.health");
    this.hpNum = el("div", "num", health);
    const bar = el("div", "fps-bar", health);
    this.hpBar = el("b", "", bar);

    const ammo = el("div", "fps-panel fps-ammo", root);
    this.ammoReload = el("div", "rl", ammo);
    const line = el("div", "", ammo);
    this.ammoNum = el("span", "num", line);
    this.ammoRes = el("span", "res", line);
    this.grenadeEl = el("div", "gr", ammo);

    this.pointsBox = el("div", "fps-points", root);
    this.timerEl = el("div", "fps-timer", root);
    this.capture = el("div", "fps-capture", root);
    this.captureText = el("div", "", this.capture);
    const cbar = el("div", "fps-bar", this.capture);
    this.captureBar = el("b", "", cbar);

    const mm = el("div", "fps-panel fps-minimap", root);
    this.mini = el("canvas", "", mm);
    this.mini.width = 384;
    this.mini.height = 384;
    this.miniCtx = this.mini.getContext("2d");
    this.miniBg = this.renderMinimapBackground();

    this.feedBox = el("div", "fps-feed", root);
    this.flashBox = el("div", "fps-flash", root);
    this.aimedEl = el("div", "fps-aimed", root);
    this.deadEl = el("div", "fps-dead", root);
    this.scoreEl = el("div", "fps-panel fps-score", root);
    const legal = el("div", "fps-legal", root);
    legal.textContent = "AlexFront · © OpenFront and Contributors";
  }

  // ------------------------------------------------------------- overlays

  private openOverlay(): HTMLDivElement {
    this.hideOverlay();
    const o = el("div", "fps-overlay", this.root);
    // Clicks on the overlay must not reach the game canvas underneath.
    o.addEventListener("mousedown", (e) => e.stopPropagation());
    this.overlay = o;
    return el("div", "fps-card", o);
  }

  private button(
    parent: HTMLElement,
    label: string,
    cls: string,
    fn: () => void,
  ): HTMLButtonElement {
    const b = el("button", `fps-btn ${cls}`, parent);
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      fn();
    });
    return b;
  }

  private controls(card: HTMLElement): void {
    const keys = el("div", "keys", card);
    const title = el("b", "", keys);
    title.textContent = this.t("fps.controls_title");
    for (const k of [
      "fps.controls_move",
      "fps.controls_shoot",
      "fps.controls_misc",
    ]) {
      const line = el("div", "", keys);
      line.textContent = this.t(k);
    }
  }

  showIntro(mapName: string, team: HudTeam): void {
    const card = this.openOverlay();
    el("h1", "", card).textContent = this.t("fps.title");
    el("h2", "", card).textContent = this.t("fps.subtitle");
    el("p", "", card).textContent = this.t("fps.you_fight_for");
    const tm = el("div", "team", card);
    const sw = el("i", "", tm);
    sw.style.background = team.css;
    const name = el("span", "", tm);
    name.textContent = team.name;
    el("p", "", card).textContent = this.t("fps.intro_goal", { map: mapName });
    this.controls(card);
    const btns = el("div", "fps-btns", card);
    this.button(btns, this.t("fps.play"), "go", () => this.cb.onPlay());
    this.button(btns, this.t("fps.quit"), "alt", () => this.cb.onQuit());
    el("div", "fps-note", card).textContent = this.t("fps.click_hint");
  }

  showPause(): void {
    const card = this.openOverlay();
    el("h1", "", card).textContent = this.t("fps.paused");
    this.controls(card);
    if (this.cb.getSensitivity && this.cb.setSensitivity) {
      const row = el("label", "sens", card);
      const name = el("span", "", row);
      name.textContent = this.t("fps.sensitivity");
      const input = el("input", "", row);
      input.type = "range";
      input.min = "0.3";
      input.max = "3";
      input.step = "0.1";
      input.value = String(this.cb.getSensitivity());
      const val = el("b", "", row);
      val.textContent = `${Number(input.value).toFixed(1)}×`;
      input.addEventListener("input", () => {
        val.textContent = `${Number(input.value).toFixed(1)}×`;
        this.cb.setSensitivity?.(Number(input.value));
      });
    }
    const btns = el("div", "fps-btns", card);
    this.button(btns, this.t("fps.resume"), "go", () => this.cb.onPlay());
    this.button(btns, this.t("fps.quit"), "alt", () => this.cb.onQuit());
  }

  /** Shown when the browser refused to lock the mouse; another click works. */
  lockRefused(): void {
    const note = this.overlay?.querySelector(".fps-note");
    if (note) note.textContent = this.t("fps.click_again");
  }

  showEnd(
    result: "victory" | "defeat",
    timeUp: boolean,
    stats: { kills: number; deaths: number; time: number },
  ): void {
    this.setScoreboard(false);
    const card = this.openOverlay();
    const h = el("h1", "", card);
    h.textContent = this.t(result === "victory" ? "fps.victory" : "fps.defeat");
    h.style.color = result === "victory" ? "#4ade80" : "#f87171";
    let desc: string;
    if (timeUp) {
      desc = this.t(
        result === "victory" ? "fps.time_up_victory" : "fps.time_up_defeat",
      );
    } else {
      desc = this.t(
        result === "victory" ? "fps.victory_desc" : "fps.defeat_desc",
      );
    }
    el("p", "", card).textContent = desc;
    el("p", "", card).textContent = this.t("fps.stats", {
      kills: stats.kills,
      deaths: stats.deaths,
      time: formatTime(stats.time),
    });
    const btns = el("div", "fps-btns", card);
    this.button(btns, this.t("fps.play_again"), "go", () =>
      this.cb.onRestart(),
    );
    this.button(btns, this.t("fps.quit"), "alt", () => this.cb.onQuit());
  }

  hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  get overlayVisible(): boolean {
    return this.overlay !== null;
  }

  // ------------------------------------------------------------- events

  flash(text: string): void {
    const d = el("div", "", this.flashBox);
    d.textContent = text;
    setTimeout(() => d.remove(), 2300);
    while (this.flashBox.childElementCount > 3)
      this.flashBox.firstElementChild?.remove();
  }

  /** Attacker direction relative to where the player looks (radians, + = left). */
  hurtFrom(angle: number): void {
    const i = el("i", "", this.hurt);
    i.style.transform = `rotate(${-angle}rad)`;
    this.hurtMarks.push({ el: i, at: this.now, angle });
    if (this.hurtMarks.length > 6) this.hurtMarks.shift()?.el.remove();
  }

  setScoreboard(on: boolean): void {
    this.scoreVisible = on;
    this.scoreEl.style.display = on ? "block" : "none";
    if (on && this.lastState) this.renderScoreboard(this.lastState);
  }

  // ------------------------------------------------------------- per frame

  update(s: HudState): void {
    this.now = s.time;
    this.lastState = s;
    const playing = this.overlay === null;
    this.root.classList.toggle("fps-idle", !playing);

    // Crosshair.
    const gap = 5 + s.spread * 9;
    const [l, r, u, d] = this.crossBars;
    l.style.left = `${-gap - 9}px`;
    r.style.left = `${gap}px`;
    u.style.top = `${-gap - 9}px`;
    d.style.top = `${gap}px`;
    const showCross = s.alive && !s.aiming;
    for (const b of this.crossBars)
      b.style.display = showCross ? "block" : "none";
    this.crossDot.style.display = s.alive ? "block" : "none";
    this.hit.style.opacity = String(s.hitMarker);
    this.vignette.style.opacity = String(Math.min(0.85, s.damage));

    // Hurt direction marks fade out.
    this.hurtMarks = this.hurtMarks.filter((m) => {
      const age = s.time - m.at;
      if (age > 1.2 || age < 0) {
        m.el.remove();
        return false;
      }
      m.el.style.opacity = String(1 - age / 1.2);
      return true;
    });

    if (s.hp !== this.lastHp) {
      this.lastHp = s.hp;
      this.hpNum.textContent = String(s.hp);
      this.hpBar.style.width = `${s.hp}%`;
      this.hpBar.style.background =
        s.hp > 60
          ? "linear-gradient(90deg,#4ade80,#22c55e)"
          : s.hp > 30
            ? "linear-gradient(90deg,#fde047,#f59e0b)"
            : "linear-gradient(90deg,#f87171,#dc2626)";
    }
    const ammoKey = `${s.ammo}/${s.reserve}/${s.reloading}/${s.grenades}`;
    if (ammoKey !== this.lastAmmo) {
      this.lastAmmo = ammoKey;
      this.ammoNum.textContent = String(s.ammo);
      this.ammoNum.style.color = s.ammo <= 5 ? "#f87171" : "#fff";
      this.ammoRes.textContent = ` / ${s.reserve}`;
      this.grenadeEl.textContent = "● ".repeat(s.grenades).trim();
      this.ammoReload.textContent = s.reloading
        ? this.t("fps.reloading")
        : s.ammo === 0 && s.reserve === 0
          ? this.t("fps.no_ammo")
          : s.ammo <= 5
            ? this.t("fps.press_reload")
            : "";
    }

    this.updatePoints(s);
    const timer = formatTime(Math.ceil(s.timeLeft));
    if (timer !== this.lastTimer) {
      this.lastTimer = timer;
      this.timerEl.textContent = timer;
      this.timerEl.classList.toggle("low", s.timeLeft < 60);
    }
    this.updateCapture(s);
    // The minimap needn't redraw every frame.
    if (this.frame++ % 3 === 0) this.drawMinimap(s);
    this.updateFeed(s);

    // Name of whoever is under the crosshair.
    if (s.aimed && s.alive) {
      this.aimedEl.style.display = "block";
      this.aimedEl.style.color = s.aimed.css;
      this.aimedEl.textContent = `${s.aimed.name} · ${s.aimed.hp}`;
    } else {
      this.aimedEl.style.display = "none";
    }

    // Death screen.
    if (!s.alive && playing) {
      this.deadEl.style.display = "block";
      const big = s.killedBy
        ? this.t("fps.killed_by", { name: s.killedBy })
        : "";
      const small =
        s.respawnIn < 0
          ? this.t("fps.no_spawn")
          : this.t("fps.respawn_in", { seconds: Math.ceil(s.respawnIn) });
      this.deadEl.innerHTML = "";
      el("div", "big", this.deadEl).textContent = big;
      el("div", "small", this.deadEl).textContent = small;
      const owned = s.points
        .map((p, i) => (p.owner === s.team ? i : -1))
        .filter((i) => i >= 0);
      if (s.respawnIn >= 0 && owned.length > 1) {
        const pick = el("div", "pick", this.deadEl);
        pick.textContent = this.t("fps.choose_spawn", {
          keys: owned.map((i) => i + 1).join(" / "),
        });
        const row = el("div", "spawns", this.deadEl);
        for (const i of owned) {
          const b = el("span", s.spawnChoice === i ? "on" : "", row);
          b.textContent = `${i + 1} · ${LETTERS[i % LETTERS.length]}`;
          b.style.borderColor = this.teamCss(s.team);
        }
      }
    } else {
      this.deadEl.style.display = "none";
    }

    if (
      this.scoreVisible &&
      Math.floor(s.time * 4) !== Math.floor((s.time - 1 / 60) * 4)
    ) {
      this.renderScoreboard(s);
    }
  }

  private teamCss(i: number): string {
    return i >= 0 && this.teams[i] ? this.teams[i].css : NEUTRAL_CSS;
  }

  private updatePoints(s: HudState): void {
    while (this.pointEls.length < s.points.length) {
      const i = this.pointEls.length;
      const box = el("div", "fps-pt", this.pointsBox);
      const fill = el("div", "fill", box);
      const label = el("span", "", box);
      label.textContent = LETTERS[i % LETTERS.length];
      box.title = s.points[i].name;
      this.pointEls.push({ box, fill });
    }
    s.points.forEach((p, i) => {
      const { box, fill } = this.pointEls[i];
      const shown = p.capturer !== p.owner ? p.capturer : p.owner;
      box.style.background =
        p.owner >= 0
          ? this.withAlpha(this.teamCss(p.owner), 0.35)
          : "rgba(20,20,26,.6)";
      fill.style.background = this.teamCss(shown);
      fill.style.height = `${Math.round(p.control * 100)}%`;
      box.style.borderColor =
        p.owner === s.team ? "#fff" : "rgba(255,255,255,.35)";
      box.classList.toggle("contested", p.contested);
      box.classList.toggle("here", s.here !== null && s.here.name === p.name);
    });
  }

  private withAlpha(css: string, a: number): string {
    return css.replace("rgb(", "rgba(").replace(")", `,${a})`);
  }

  private updateCapture(s: HudState): void {
    const h = s.here;
    if (!h || !s.alive) {
      this.capture.style.display = "none";
      return;
    }
    this.capture.style.display = "block";
    let text: string;
    let color = this.teamCss(h.capturer);
    if (h.contested) {
      text = this.t("fps.contested");
      color = "#f87171";
    } else if (h.owner === s.team && h.capturer === s.team && h.control >= 1) {
      text = this.t("fps.secured", { name: h.name });
    } else if (h.capturer !== s.team && h.owner >= 0) {
      text =
        h.owner === s.team
          ? this.t("fps.defending", { name: h.name })
          : this.t("fps.neutralizing", { name: h.name });
    } else {
      text = this.t("fps.capturing", { name: h.name });
    }
    this.captureText.textContent = `${text}  ${Math.round(h.control * 100)}%`;
    this.captureText.style.color = color;
    this.captureBar.style.width = `${h.control * 100}%`;
    this.captureBar.style.background = this.teamCss(h.capturer);
  }

  private updateFeed(s: HudState): void {
    const key = s.feed.map((f) => `${f.at}`).join(",");
    if (key === this.lastFeedKey) return;
    this.lastFeedKey = key;
    this.feedBox.innerHTML = "";
    for (const f of s.feed.slice(-5)) {
      const row = el("div", "", this.feedBox);
      const k = el("span", "", row);
      k.textContent = f.killer;
      k.style.color = f.kc;
      const mid = el("span", "", row);
      mid.textContent = f.grenade ? "  ✹  " : f.head ? "  ⌖  " : "  ➜  ";
      mid.style.opacity = "0.8";
      const v = el("span", "", row);
      v.textContent = f.victim;
      v.style.color = f.vc;
    }
  }

  private renderScoreboard(s: HudState): void {
    this.scoreEl.innerHTML = "";
    el("h3", "", this.scoreEl).textContent = this.t("fps.scoreboard");
    const table = el("table", "", this.scoreEl);
    const head = el("tr", "", table);
    for (const k of ["fps.nation", "fps.points", "fps.soldiers", "fps.kills"]) {
      el("th", "", head).textContent = this.t(k);
    }
    const order = this.teams
      .map((team, i) => ({ team, i, ...s.soldiers[i] }))
      .sort((a, b) => b.points - a.points || b.team.kills - a.team.kills);
    for (const row of order) {
      const tr = el(
        "tr",
        row.i === s.team ? "me" : row.team.eliminated ? "out" : "",
        table,
      );
      const name = el("td", "", tr);
      const sw = el("span", "sw", name);
      sw.style.background = row.team.css;
      name.appendChild(
        document.createTextNode(
          row.i === s.team
            ? `${row.team.name} (${this.t("fps.you")})`
            : row.team.name,
        ),
      );
      el("td", "", tr).textContent = String(row.points);
      el("td", "", tr).textContent = String(row.alive);
      el("td", "", tr).textContent = String(row.team.kills);
    }
    el("div", "mine", this.scoreEl).textContent = this.t("fps.your_stats", {
      kills: s.playerKills,
      deaths: s.playerDeaths,
    });
  }

  // ------------------------------------------------------------- minimap

  private renderMinimapBackground(): HTMLCanvasElement {
    const t = this.terrain;
    const c = document.createElement("canvas");
    c.width = t.gw;
    c.height = t.gh;
    const ctx = c.getContext("2d");
    if (!ctx) return c;
    const img = ctx.createImageData(t.gw, t.gh);
    for (let j = 0; j < t.gh; j++) {
      for (let i = 0; i < t.gw; i++) {
        const k = j * t.gw + i;
        const h = t.heights[k];
        const o = k * 4;
        let r: number;
        let g: number;
        let b: number;
        if (t.kinds[k] === Cell.Wall) {
          r = g = b = 52;
        } else if (h < 0) {
          const d = Math.min(1, -h / 6);
          r = 40 - d * 20;
          g = 95 - d * 35;
          b = 140 - d * 30;
        } else {
          const e = Math.min(1, h / 22);
          r = 70 + e * 90;
          g = 110 + e * 50;
          b = 52 + e * 60;
        }
        img.data[o] = r;
        img.data[o + 1] = g;
        img.data[o + 2] = b;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private drawMinimap(s: HudState): void {
    const ctx = this.miniCtx;
    if (!ctx) return;
    const W = this.mini.width;
    const H = this.mini.height;
    const t = this.terrain;
    // Fit the whole map, keeping its aspect.
    const scale = Math.min(W / t.sizeX, H / t.sizeZ);
    const ox = (W - t.sizeX * scale) / 2;
    const oz = (H - t.sizeZ * scale) / 2;
    const X = (x: number) => ox + x * scale;
    const Z = (z: number) => oz + z * scale;
    ctx.fillStyle = "#16191f";
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.miniBg, ox, oz, t.sizeX * scale, t.sizeZ * scale);
    // Points.
    s.points.forEach((p, i) => {
      const col = this.teamCss(p.owner);
      ctx.beginPath();
      ctx.arc(X(p.x), Z(p.z), Math.max(7, 11 * scale), 0, Math.PI * 2);
      ctx.fillStyle = this.withAlpha(
        col === NEUTRAL_CSS ? "rgb(140,140,148)" : col,
        0.75,
      );
      ctx.fill();
      ctx.lineWidth = p.contested ? 3 : 1.5;
      ctx.strokeStyle = p.contested ? "#ef4444" : "rgba(255,255,255,.9)";
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(LETTERS[i % LETTERS.length], X(p.x), Z(p.z) + 1);
    });
    // Allies, then enemies that just gave away their position by firing.
    ctx.fillStyle = "#93c5fd";
    for (const [x, z] of s.allies) {
      ctx.beginPath();
      ctx.arc(X(x), Z(z), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const [x, z, team] of s.enemiesSeen) {
      ctx.beginPath();
      ctx.arc(X(x), Z(z), 3.5, 0, Math.PI * 2);
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.teamCss(team);
      ctx.stroke();
    }
    // The player: an arrow pointing where they look.
    const px = X(s.x);
    const pz = Z(s.z);
    const fx = -Math.sin(s.yaw);
    const fz = -Math.cos(s.yaw);
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(Math.atan2(fz, fx) + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = s.alive ? "#facc15" : "#9ca3af";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#000";
    ctx.stroke();
    ctx.restore();
  }

  dispose(): void {
    this.root.remove();
    this.style.remove();
  }
}
