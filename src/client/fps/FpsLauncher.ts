// Entry screen of the FPS mode: pick a map, your nation, how many nations
// fight and the difficulty, then play. Everything the launcher needs from
// the rest of the client (translations, map files) is passed in, so this
// folder stays self-contained.

import {
  BASE_SENSITIVITY,
  Difficulty,
  FpsGame,
  FpsNationInput,
} from "./FpsGame";
import { FpsNet } from "./FpsNet";
import { TerrainSource } from "./FpsTerrain";

type T = (key: string, params?: Record<string, string | number>) => string;

export interface FpsMapChoice {
  key: string;
  name: string;
}

export interface FpsLoadedMap {
  /** The map's 4x-downscaled terrain bytes. */
  terrain: TerrainSource;
  /** Size of the full-resolution map (nation coordinates are in it). */
  fullWidth: number;
  fullHeight: number;
  nations: FpsNationInput[];
}

export interface FpsLauncherDeps {
  t: T;
  maps: FpsMapChoice[];
  defaultMap: string;
  loadMap: (key: string) => Promise<FpsLoadedMap>;
  playerName: string;
  onExit?: () => void;
  /** The online relay's WebSocket URL; without one, no online mode. */
  netUrl?: string | null;
}

/** What a room's host shares so everyone builds the same battle. */
export interface FpsRoomConfig {
  v: 1;
  map: string;
  /** The host's nation, as an index into the map's nations. */
  nation: number;
  count: number;
  seed: number;
  difficulty: Difficulty;
}

export function parseRoomConfig(raw: unknown): FpsRoomConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Record<string, unknown>;
  const int = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) ? v : NaN;
  const nation = int(c.nation);
  const count = int(c.count);
  const seed = int(c.seed);
  const d = c.difficulty;
  if (typeof c.map !== "string" || !(nation >= 0)) return null;
  if (!(count >= 2 && count <= 10) || !Number.isFinite(seed)) return null;
  if (d !== "easy" && d !== "normal" && d !== "hard") return null;
  return { v: 1, map: c.map, nation, count, seed, difficulty: d };
}

export interface FpsBattle {
  terrain: TerrainSource;
  fullWidth: number;
  fullHeight: number;
  nations: FpsNationInput[];
  playerNation: number;
  worldSize: number;
}

const SETTINGS_KEY = "alexfront.fps.settings";

interface Settings {
  map: string;
  nation: string;
  count: number;
  difficulty: Difficulty;
  sensitivity: number;
  online: boolean;
  room: string;
}

function loadSettings(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Private mode or blocked storage: settings just aren't remembered.
  }
}

/**
 * Which nations stand on land connected to `from`'s, on the 4x terrain:
 * land tiles and shallow water (rivers, straits a few tiles wide) connect,
 * open sea and impassable tiles don't.
 */
export function reachableLand(
  map: FpsLoadedMap,
  from: FpsNationInput,
): (n: FpsNationInput) => boolean {
  const { bytes, width: w, height: h } = map.terrain;
  const fx = w / map.fullWidth;
  const fy = h / map.fullHeight;
  const ok = (k: number) => {
    const b = bytes[k];
    const mag = b & 0x1f;
    return b & 0x80 ? mag !== 31 : mag <= 3;
  };
  /** The nearest walkable tile to a nation's spot, or -1. */
  const tileOf = (n: FpsNationInput) => {
    const cx = Math.min(w - 1, Math.max(0, Math.round(n.x * fx)));
    const cy = Math.min(h - 1, Math.max(0, Math.round(n.y * fy)));
    for (let r = 0; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          if (ok(y * w + x)) return y * w + x;
        }
      }
    }
    return -1;
  };
  const start = tileOf(from);
  if (start < 0) return () => true;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  seen[start] = 1;
  queue[tail++] = start;
  while (head < tail) {
    const k = queue[head++];
    const x = k % w;
    const y = (k - x) / w;
    if (x > 0 && !seen[k - 1] && ok(k - 1)) {
      seen[k - 1] = 1;
      queue[tail++] = k - 1;
    }
    if (x < w - 1 && !seen[k + 1] && ok(k + 1)) {
      seen[k + 1] = 1;
      queue[tail++] = k + 1;
    }
    if (y > 0 && !seen[k - w] && ok(k - w)) {
      seen[k - w] = 1;
      queue[tail++] = k - w;
    }
    if (y < h - 1 && !seen[k + w] && ok(k + w)) {
      seen[k + w] = 1;
      queue[tail++] = k + w;
    }
  }
  return (n) => {
    const k = tileOf(n);
    return k >= 0 && seen[k] === 1;
  };
}

/**
 * The battlefield: your nation plus its nearest neighbours, and the part of
 * the map around them (so the points are a walk apart, not a day's march).
 * Your nation comes first in the returned list.
 */
export function prepareBattle(
  map: FpsLoadedMap,
  player: number,
  count: number,
): FpsBattle {
  const me = map.nations[player];
  // Neighbours you can walk to (rivers are fine, seas are not) come first.
  const reach = reachableLand(map, me);
  const others = map.nations
    .map((n, i) => ({
      n,
      i,
      d: Math.hypot(n.x - me.x, n.y - me.y),
      land: reach(n),
    }))
    .filter((o) => o.i !== player)
    .sort((a, b) => Number(b.land) - Number(a.land) || a.d - b.d)
    .slice(0, Math.max(1, count - 1))
    .map((o) => o.n);
  const chosen = [me, ...others];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of chosen) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }
  // Square-ish box around the nations, with room around the outer points.
  const minSpan = Math.min(map.fullWidth, map.fullHeight) * 0.22;
  const span = Math.max(maxX - minX, maxY - minY, minSpan);
  const margin = span * 0.2 + 16;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const halfW = Math.max((maxX - minX) / 2, span * 0.35) + margin;
  const halfH = Math.max((maxY - minY) / 2, span * 0.35) + margin;
  const fx0 = Math.max(0, cx - halfW);
  const fy0 = Math.max(0, cy - halfH);
  const fx1 = Math.min(map.fullWidth, cx + halfW);
  const fy1 = Math.min(map.fullHeight, cy + halfH);

  // Crop the 4x terrain to that box.
  const src = map.terrain;
  const sx = src.width / map.fullWidth;
  const sy = src.height / map.fullHeight;
  const x0 = Math.max(0, Math.floor(fx0 * sx));
  const y0 = Math.max(0, Math.floor(fy0 * sy));
  const x1 = Math.min(src.width, Math.ceil(fx1 * sx));
  const y1 = Math.min(src.height, Math.ceil(fy1 * sy));
  const w = Math.max(8, x1 - x0);
  const h = Math.max(8, y1 - y0);
  const bytes = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const row = (y0 + j) * src.width + x0;
    bytes.set(
      src.bytes.subarray(row, row + Math.min(w, src.width - x0)),
      j * w,
    );
  }
  const ox = x0 / sx;
  const oy = y0 / sy;
  return {
    terrain: { bytes, width: w, height: h },
    fullWidth: w / sx,
    fullHeight: h / sy,
    nations: chosen.map((n) => ({ ...n, x: n.x - ox, y: n.y - oy })),
    playerNation: 0,
    worldSize: 430 + 70 * chosen.length,
  };
}

const CSS = `
.fps-root{position:fixed;inset:0;z-index:10000;background:#05070b;color:#fff;font-family:"Segoe UI",system-ui,-apple-system,sans-serif;overflow:hidden}
.fps-setup{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:auto;padding:16px;background:radial-gradient(ellipse at 30% 20%,rgba(59,130,246,.25),transparent 55%),radial-gradient(ellipse at 80% 90%,rgba(239,68,68,.2),transparent 55%),linear-gradient(160deg,#0b1020,#05070b)}
.fps-setup .card{width:100%;max-width:560px;padding:28px 30px;border-radius:18px;background:rgba(18,22,32,.92);border:1px solid rgba(255,255,255,.14);box-shadow:0 24px 70px rgba(0,0,0,.6)}
.fps-setup h1{margin:0;font-size:40px;font-weight:900;letter-spacing:.03em;text-align:center}
.fps-setup h1 span{color:#60a5fa}
.fps-setup h2{margin:2px 0 8px;text-align:center;font-size:14px;letter-spacing:.35em;text-transform:uppercase;opacity:.65;font-weight:700}
.fps-setup p.warn{color:#fbbf24;font-weight:700}
.fps-setup p.desc{margin:0 0 18px;text-align:center;opacity:.85;line-height:1.45;font-size:15px}
.fps-setup label{display:block;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;margin:14px 0 6px;font-weight:700}
.fps-setup select,.fps-setup input[type=range]{width:100%}
.fps-setup select{padding:10px 12px;border-radius:10px;background:#0f1420;color:#fff;border:1px solid rgba(255,255,255,.2);font-size:15px}
.fps-setup input[type=range]{accent-color:#3b82f6}
.fps-seg{display:flex;gap:8px}
.fps-seg button{flex:1;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:#0f1420;color:#fff;font-weight:700;font-size:14px;cursor:pointer}
.fps-seg button.on{background:#2563eb;border-color:#60a5fa}
.fps-setup .row{display:flex;justify-content:space-between;align-items:baseline}
.fps-setup .row span{font-size:14px;font-weight:700}
.fps-setup .status{min-height:20px;margin-top:14px;font-size:14px;text-align:center;opacity:.85}
.fps-setup .status.err{color:#f87171;opacity:1}
.fps-setup .btns{display:flex;gap:10px;margin-top:16px}
.fps-setup .btns button{flex:1;padding:14px;border-radius:12px;border:0;font-size:17px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;color:#fff;cursor:pointer}
.fps-setup .start{background:linear-gradient(180deg,#22c55e,#16a34a);box-shadow:0 6px 18px rgba(22,163,74,.4)}
.fps-setup .start:disabled{filter:grayscale(1) brightness(.6);cursor:default}
.fps-setup .back{background:rgba(255,255,255,.12);flex:.6 !important}
.fps-setup .legal{margin-top:14px;text-align:center;font-size:11px;opacity:.4}
.fps-setup .room input{width:100%;padding:10px 12px;border-radius:10px;background:#0f1420;color:#fff;border:1px solid rgba(255,255,255,.2);font-size:16px;font-weight:800;letter-spacing:.2em}
.fps-setup .room .hint{margin:6px 0 0;font-size:13px;opacity:.7;line-height:1.4}
.fps-setup .fps-seg+.room{margin-top:4px}
.fps-setup .card>.fps-seg:first-of-type{margin-bottom:4px}
.fps-game{position:absolute;inset:0}
`;

export class FpsLauncher {
  readonly root: HTMLDivElement;
  private style: HTMLStyleElement;
  private setupEl: HTMLDivElement | null = null;
  private game: FpsGame | null = null;
  /** The online room we're in (or connecting to), outside of a game. */
  private net: FpsNet | null = null;
  private loaded: FpsLoadedMap | null = null;
  private loadedKey = "";
  private loadToken = 0;
  private settings: Settings;
  private ui: {
    map: HTMLSelectElement;
    nation: HTMLSelectElement;
    count: HTMLInputElement;
    countLabel: HTMLSpanElement;
    sens: HTMLInputElement;
    sensLabel: HTMLSpanElement;
    diff: HTMLButtonElement[];
    status: HTMLDivElement;
    start: HTMLButtonElement;
  } | null = null;

  constructor(private deps: FpsLauncherDeps) {
    const saved = loadSettings();
    const mapOk = deps.maps.some((m) => m.key === saved.map);
    this.settings = {
      map: mapOk && saved.map ? saved.map : deps.defaultMap,
      nation: saved.nation ?? "",
      count: Math.max(2, Math.min(10, saved.count ?? 5)),
      difficulty:
        saved.difficulty === "easy" || saved.difficulty === "hard"
          ? saved.difficulty
          : "normal",
      sensitivity: Math.max(0.3, Math.min(3, saved.sensitivity ?? 1)),
      online: saved.online === true && !!deps.netUrl,
      room:
        typeof saved.room === "string" && saved.room ? saved.room : "PUBLIC",
    };
    this.style = document.createElement("style");
    this.style.textContent = CSS;
    document.head.appendChild(this.style);
    this.root = document.createElement("div");
    this.root.className = "fps-root";
    document.body.appendChild(this.root);
    this.showSetup();
  }

  private t(key: string, params?: Record<string, string | number>): string {
    return this.deps.t(key, params);
  }

  showSetup(): void {
    this.setupEl?.remove();
    const s = document.createElement("div");
    s.className = "fps-setup";
    this.setupEl = s;
    this.root.appendChild(s);
    const card = document.createElement("div");
    card.className = "card";
    s.appendChild(card);
    const add = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      cls = "",
      parent: HTMLElement = card,
    ) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      parent.appendChild(e);
      return e;
    };
    const h1 = add("h1");
    h1.append("AlexFront ");
    add("span", "", h1).textContent = "FPS";
    add("h2").textContent = this.t("fps.subtitle");
    add("p", "desc").textContent = this.t("fps.setup_desc");
    if (this.touchOnly()) {
      add("p", "desc warn").textContent = this.t("fps.desktop_only");
    }

    let roomBox: HTMLDivElement | null = null;
    if (this.deps.netUrl) {
      const modes = add("div", "fps-seg");
      const solo = add("button", this.settings.online ? "" : "on", modes);
      solo.type = "button";
      solo.textContent = this.t("fps.mode_solo");
      const online = add("button", this.settings.online ? "on" : "", modes);
      online.type = "button";
      online.textContent = this.t("fps.mode_online");
      roomBox = add("div", "room");
      add("label", "", roomBox).textContent = this.t("fps.room");
      const room = add("input", "", roomBox);
      room.type = "text";
      room.maxLength = 12;
      room.value = this.settings.room;
      room.addEventListener("input", () => {
        room.value = room.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
        this.settings.room = room.value || "PUBLIC";
      });
      add("p", "hint", roomBox).textContent = this.t("fps.room_hint");
      const sync = () => {
        solo.classList.toggle("on", !this.settings.online);
        online.classList.toggle("on", this.settings.online);
        roomBox!.style.display = this.settings.online ? "block" : "none";
      };
      solo.addEventListener("click", () => {
        this.settings.online = false;
        sync();
      });
      online.addEventListener("click", () => {
        this.settings.online = true;
        sync();
      });
      sync();
    }

    add("label").textContent = this.t("fps.map");
    const map = add("select");
    for (const m of [...this.deps.maps].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const o = add("option", "", map);
      o.value = m.key;
      o.textContent = m.name;
    }
    map.value = this.settings.map;

    add("label").textContent = this.t("fps.your_nation");
    const nation = add("select");

    const countLbl = add("label");
    const countRow = add("div", "row", countLbl);
    countRow.append(this.t("fps.nation_count"));
    const countLabel = add("span", "", countRow);
    const count = add("input");
    count.type = "range";
    count.min = "2";
    count.max = "10";
    count.step = "1";
    count.value = String(this.settings.count);

    add("label").textContent = this.t("fps.difficulty");
    const seg = add("div", "fps-seg");
    const diffs: [Difficulty, string][] = [
      ["easy", this.t("fps.easy")],
      ["normal", this.t("fps.normal")],
      ["hard", this.t("fps.hard")],
    ];
    const diff = diffs.map(([d, label]) => {
      const b = add("button", d === this.settings.difficulty ? "on" : "", seg);
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", () => {
        this.settings.difficulty = d;
        diff.forEach((x) => x.classList.toggle("on", x === b));
      });
      return b;
    });

    const sensLbl = add("label");
    const sensRow = add("div", "row", sensLbl);
    sensRow.append(this.t("fps.sensitivity"));
    const sensLabel = add("span", "", sensRow);
    const sens = add("input");
    sens.type = "range";
    sens.min = "0.3";
    sens.max = "3";
    sens.step = "0.1";
    sens.value = String(this.settings.sensitivity);

    const status = add("div", "status");
    const btns = add("div", "btns");
    const back = add("button", "back", btns);
    back.type = "button";
    back.textContent = this.t("fps.back");
    const start = add("button", "start", btns);
    start.type = "button";
    start.textContent = this.t("fps.start");
    add("div", "legal").textContent =
      "AlexFront · © OpenFront and Contributors · AGPL-3.0";

    this.ui = {
      map,
      nation,
      count,
      countLabel,
      sens,
      sensLabel,
      diff,
      status,
      start,
    };
    const syncLabels = () => {
      countLabel.textContent = count.value;
      sensLabel.textContent = `${Number(sens.value).toFixed(1)}×`;
    };
    syncLabels();
    map.addEventListener("change", () => {
      this.settings.map = map.value;
      void this.loadSelectedMap();
    });
    nation.addEventListener(
      "change",
      () => (this.settings.nation = nation.value),
    );
    count.addEventListener("input", () => {
      this.settings.count = Number(count.value);
      syncLabels();
    });
    sens.addEventListener("input", () => {
      this.settings.sensitivity = Number(sens.value);
      syncLabels();
    });
    back.addEventListener("click", () => this.close());
    start.addEventListener("click", () => this.startGame());
    if (!this.webgl2()) {
      this.setStatus(this.t("fps.no_webgl"), true);
      start.disabled = true;
      return;
    }
    if (this.loaded && this.loadedKey === this.settings.map) this.fillNations();
    else void this.loadSelectedMap();
  }

  /** Phones and tablets: no mouse and keyboard to play with. */
  private touchOnly(): boolean {
    try {
      return (
        matchMedia("(pointer: coarse)").matches &&
        !matchMedia("(pointer: fine)").matches
      );
    } catch {
      return false;
    }
  }

  private webgl2(): boolean {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  private setStatus(text: string, error = false): void {
    if (!this.ui) return;
    this.ui.status.textContent = text;
    this.ui.status.classList.toggle("err", error);
  }

  private async loadSelectedMap(): Promise<void> {
    const ui = this.ui;
    if (!ui) return;
    const key = this.settings.map;
    const token = ++this.loadToken;
    ui.start.disabled = true;
    ui.nation.innerHTML = "";
    this.setStatus(this.t("fps.loading"));
    try {
      const map = await this.deps.loadMap(key);
      if (token !== this.loadToken) return;
      if (map.nations.length < 2) {
        this.setStatus(this.t("fps.too_few_nations"), true);
        return;
      }
      this.loaded = map;
      this.loadedKey = key;
      this.fillNations();
    } catch (e) {
      if (token !== this.loadToken) return;
      console.error("FPS map load failed", e);
      this.setStatus(this.t("fps.load_failed"), true);
    }
  }

  private fillNations(): void {
    const ui = this.ui;
    const map = this.loaded;
    if (!ui || !map) return;
    ui.nation.innerHTML = "";
    const order = map.nations
      .map((n, i) => ({ n, i }))
      .sort((a, b) => a.n.name.localeCompare(b.n.name));
    for (const { n, i } of order) {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = n.name;
      ui.nation.appendChild(o);
    }
    const saved = map.nations.findIndex((n) => n.name === this.settings.nation);
    // Default: the strongest nation (the capital, on most maps).
    let pick = saved;
    if (pick < 0) {
      pick = 0;
      map.nations.forEach((n, i) => {
        if (n.strength > map.nations[pick].strength) pick = i;
      });
    }
    ui.nation.value = String(pick);
    this.settings.nation = map.nations[pick].name;
    const max = Math.min(10, map.nations.length);
    ui.count.max = String(max);
    if (Number(ui.count.value) > max) ui.count.value = String(max);
    this.settings.count = Number(ui.count.value);
    ui.countLabel.textContent = ui.count.value;
    ui.start.disabled = false;
    this.setStatus("");
  }

  private startGame(): void {
    const map = this.loaded;
    const ui = this.ui;
    if (!map || !ui || ui.start.disabled) return;
    const player = Number(ui.nation.value);
    if (!(player >= 0 && player < map.nations.length)) return;
    this.settings.nation = map.nations[player].name;
    saveSettings(this.settings);
    if (this.settings.online && this.deps.netUrl) this.goOnline(player);
    else this.launch(player);
  }

  /**
   * Joins the room: the first one in hosts a battle with these settings,
   * everyone after joins the host's battle and picks a side.
   */
  private goOnline(player: number): void {
    const ui = this.ui;
    if (!ui || !this.deps.netUrl) return;
    ui.start.disabled = true;
    this.setStatus(this.t("fps.connecting"));
    this.net?.close();
    const net = new FpsNet(
      this.deps.netUrl,
      this.settings.room,
      this.deps.playerName || "Player",
    );
    this.net = net;
    net.events.onClose = (full) => {
      if (this.net !== net) return;
      this.net = null;
      if (!this.setupEl) this.showSetup();
      this.setStatus(this.t(full ? "fps.room_full" : "fps.offline"), true);
      if (this.ui) this.ui.start.disabled = false;
    };
    net.events.onWelcome = () => {
      if (net.isHost) {
        const cfg: FpsRoomConfig = {
          v: 1,
          map: this.loadedKey,
          nation: player,
          count: this.settings.count,
          seed: (Date.now() ^ (Math.random() * 0x7fffffff)) & 0x7fffffff,
          difficulty: this.settings.difficulty,
        };
        net.cfg = cfg;
        net.send({ t: "cfg", cfg });
        this.startRoomGame(net, cfg, 0);
      } else if (net.cfg) {
        void this.joinRoom(net, net.cfg);
      } else {
        this.setStatus(this.t("fps.waiting_host"));
        net.events.onMessage = (_from, m) => {
          if (m.t === "cfg" && m.cfg) void this.joinRoom(net, m.cfg);
        };
      }
    };
  }

  /** A room's battle is on: load its map and let the player pick a side. */
  private async joinRoom(net: FpsNet, raw: unknown): Promise<void> {
    net.events.onMessage = undefined;
    const cfg = parseRoomConfig(raw);
    if (!cfg || !this.deps.maps.some((m) => m.key === cfg.map)) {
      net.close();
      this.net = null;
      this.setStatus(this.t("fps.load_failed"), true);
      return;
    }
    this.setStatus(this.t("fps.loading"));
    try {
      if (!this.loaded || this.loadedKey !== cfg.map) {
        this.loaded = await this.deps.loadMap(cfg.map);
        this.loadedKey = cfg.map;
      }
    } catch (e) {
      console.error("FPS map load failed", e);
      net.close();
      this.net = null;
      this.setStatus(this.t("fps.load_failed"), true);
      return;
    }
    if (this.net !== net || cfg.nation >= this.loaded.nations.length) return;
    this.showJoin(net, cfg);
  }

  private showJoin(net: FpsNet, cfg: FpsRoomConfig): void {
    const map = this.loaded;
    if (!map) return;
    // While we sit in this menu we can't run the bots: if hosting falls to
    // us, hand it to whoever is playing.
    net.events.onMessage = (_from, m) => {
      if (m.t === "s" && net.isHost) net.send({ t: "yield" });
    };
    const battle = prepareBattle(map, cfg.nation, cfg.count);
    this.setupEl?.remove();
    this.ui = null;
    const s = document.createElement("div");
    s.className = "fps-setup";
    this.setupEl = s;
    this.root.appendChild(s);
    const card = document.createElement("div");
    card.className = "card";
    s.appendChild(card);
    const add = <K extends keyof HTMLElementTagNameMap>(
      tag: K,
      cls = "",
      parent: HTMLElement = card,
    ) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      parent.appendChild(e);
      return e;
    };
    const h1 = add("h1");
    h1.append("AlexFront ");
    add("span", "", h1).textContent = "FPS";
    add("h2").textContent = this.t("fps.mode_online");
    const mapName =
      this.deps.maps.find((m) => m.key === cfg.map)?.name ?? cfg.map;
    const host = net.peers.get(net.hostId) ?? "?";
    add("p", "desc").textContent = this.t("fps.room_info", {
      room: net.room,
      map: mapName,
      host,
      players: net.peers.size + 1,
    });
    add("label").textContent = this.t("fps.your_side");
    const side = add("select");
    battle.nations.forEach((n, i) => {
      const o = add("option", "", side);
      o.value = String(i);
      o.textContent = n.name;
    });
    // Same side as the host by default: play together against the bots.
    side.value = "0";
    const status = add("div", "status");
    const btns = add("div", "btns");
    const leave = add("button", "back", btns);
    leave.type = "button";
    leave.textContent = this.t("fps.leave");
    const join = add("button", "start", btns);
    join.type = "button";
    join.textContent = this.t("fps.join_battle");
    leave.addEventListener("click", () => {
      net.close();
      this.net = null;
      this.showSetup();
    });
    join.addEventListener("click", () => {
      status.textContent = "";
      this.startRoomGame(net, cfg, Number(side.value));
    });
  }

  /** Starts (host) or joins (everyone else) the room's battle on `side`. */
  private startRoomGame(net: FpsNet, cfg: FpsRoomConfig, side: number): void {
    const map = this.loaded;
    if (!map) return;
    const battle = prepareBattle(map, cfg.nation, cfg.count);
    if (!(side >= 0 && side < battle.nations.length)) side = 0;
    // From here on the game owns the connection.
    this.net = null;
    net.events.onWelcome = undefined;
    this.startBattle(battle, side, cfg.seed, cfg.difficulty, net, () => {
      this.showSetup();
    });
  }

  /** Starts a battle for `player` (an index into the loaded map's nations). */
  launch(player: number): void {
    const map = this.loaded;
    if (!map) return;
    const battle = prepareBattle(map, player, this.settings.count);
    this.startBattle(
      battle,
      battle.playerNation,
      (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0,
      this.settings.difficulty,
      null,
      () => this.launch(player),
    );
  }

  private startBattle(
    battle: FpsBattle,
    side: number,
    seed: number,
    difficulty: Difficulty,
    net: FpsNet | null,
    restart: () => void,
  ): void {
    const mapName =
      this.deps.maps.find((m) => m.key === this.loadedKey)?.name ??
      this.loadedKey;
    const container = document.createElement("div");
    container.className = "fps-game";
    this.root.appendChild(container);
    let game: FpsGame;
    try {
      game = new FpsGame(
        container,
        {
          mapName,
          terrain: battle.terrain,
          fullWidth: battle.fullWidth,
          fullHeight: battle.fullHeight,
          nations: battle.nations,
          playerNation: side,
          difficulty,
          playerName: this.deps.playerName || "Player",
          seed,
          worldSize: battle.worldSize,
          net,
        },
        {
          t: this.deps.t,
          onExit: () => {
            this.game = null;
            container.remove();
            this.showSetup();
          },
          onRestart: () => {
            this.game = null;
            container.remove();
            restart();
          },
          onSensitivity: (v) => {
            this.settings.sensitivity = v;
            saveSettings(this.settings);
          },
        },
      );
    } catch (e) {
      console.error("FPS start failed", e);
      net?.close();
      container.remove();
      if (!this.setupEl) this.showSetup();
      this.setStatus(this.t("fps.start_failed"), true);
      return;
    }
    this.game = game;
    game.setSensitivity(BASE_SENSITIVITY * this.settings.sensitivity);
    this.setupEl?.remove();
    this.setupEl = null;
    this.ui = null;
    game.start();
  }

  /** The running game, if any (used by tests). */
  get current(): FpsGame | null {
    return this.game;
  }

  close(): void {
    this.net?.close();
    this.net = null;
    this.game?.dispose();
    this.game = null;
    this.root.remove();
    this.style.remove();
    this.deps.onExit?.();
  }
}
