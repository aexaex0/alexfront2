// AlexFront FPS: conquer the map on foot. Every nation of the map holds a
// capture point (at its spawn spot on the strategy map) and fields soldiers;
// you fight for one of them in first person. Hold every point to win.

import { FpsAudio } from "./FpsAudio";
import { FpsHud, HudState } from "./FpsHud";
import {
  angleDiff,
  clamp,
  forward,
  fpsView,
  hsl,
  mat4,
  mulInto,
  perspective,
  Rng,
  trs,
} from "./FpsMath";
import {
  BOX_STRIDE,
  FpsRenderer,
  PointVisual,
  SPRITE_STRIDE,
  TRACER_STRIDE,
} from "./FpsRenderer";
import {
  Cell,
  FpsNav,
  FpsTerrain,
  TerrainSource,
  WATER_LEVEL,
} from "./FpsTerrain";
import { FpsNet, NetMsg } from "./FpsNet";
import { FpsWorld, segmentBox } from "./FpsWorld";

export type Difficulty = "easy" | "normal" | "hard";

export interface FpsNationInput {
  name: string;
  /** Spawn coordinates on the full-resolution strategy map. */
  x: number;
  y: number;
  strength: number;
}

export interface FpsOptions {
  mapName: string;
  terrain: TerrainSource;
  fullWidth: number;
  fullHeight: number;
  nations: FpsNationInput[];
  playerNation: number;
  difficulty: Difficulty;
  playerName: string;
  seed: number;
  /** Length of the battlefield's longer side, in meters. */
  worldSize?: number;
  /** Online: the room connection (the host runs the bots and points). */
  net?: FpsNet | null;
}

export interface FpsDeps {
  t: (key: string, params?: Record<string, string | number>) => string;
  onExit: () => void;
  onRestart: () => void;
  /** The player changed the mouse sensitivity (multiplier) in the pause menu. */
  onSensitivity?: (v: number) => void;
}

interface Team {
  name: string;
  color: [number, number, number];
  css: string;
  strength: number;
  kills: number;
  eliminated: boolean;
}

interface Soldier {
  id: number;
  team: number;
  name: string;
  isPlayer: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
  swimming: boolean;
  crouching: boolean;
  /** Online: the peer id of a remote human (0 for us and for bots). */
  peer: number;
  /** Online: a bot mirrored from the host, not simulated here. */
  ghost: boolean;
  /** Shots fired (counted, so others can draw them). */
  shots: number;
  seenShots: number;
  /** Online: where a remote soldier was last reported. */
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  tpitch: number;
  grenades: number;
  grenadeCd: number;
  shieldUntil: number;
  hp: number;
  alive: boolean;
  diedAt: number;
  respawnAt: number;
  ammo: number;
  reserve: number;
  fireCd: number;
  reloadT: number;
  lastHurt: number;
  walk: number;
  kills: number;
  deaths: number;
  // AI
  goal: number;
  enemy: Soldier | null;
  thinkT: number;
  reactT: number;
  strafe: number;
  strafeT: number;
  burst: number;
  burstCd: number;
  wanderX: number;
  wanderZ: number;
  stuckT: number;
  lastX: number;
  lastZ: number;
}

interface Point {
  name: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  owner: number;
  capturer: number;
  control: number;
  contested: boolean;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  r: number;
  g: number;
  b: number;
  a: number;
  add: boolean;
  grav: number;
}

interface Tracer {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  life: number;
  r: number;
  g: number;
  b: number;
}

interface Grenade {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
  spin: number;
  owner: Soldier;
}

interface Hit {
  t: number;
  soldier: Soldier | null;
  head: boolean;
  kind: "none" | "terrain" | "house" | "soldier";
}

const EYE = 1.6;
const CROUCH_EYE = 1.1;
const RADIUS = 0.4;
const GRAVITY = 22;
const POINT_RADIUS = 11;
const RANGE = 280;
const MAG = 30;
const RESERVE = 210;
const FIRE_INTERVAL = 0.1;
const RELOAD_TIME = 1.9;
const DAMAGE = 24;
const HEADSHOT = 2.2;
const PLAYER_RESPAWN = 4;
const BOT_RESPAWN = 7;
const CAPTURE_RATE = 0.22;
const GRENADES = 3;
const GRENADE_FUSE = 2.4;
const GRENADE_RADIUS = 7.5;
const GRENADE_DAMAGE = 140;
/** Seconds of protection right after (re)spawning. */
const SPAWN_SHIELD = 1.5;
/** Mouse look, radians per pixel, at sensitivity 1. */
export const BASE_SENSITIVITY = 0.0022;
/** A match lasts at most this long; then the nation with the most points wins. */
const MATCH_TIME = 15 * 60;
const NEUTRAL: [number, number, number] = [0.55, 0.55, 0.58];
const PALETTE: [number, number, number][] = [
  [0.22, 0.52, 1.0],
  [0.92, 0.2, 0.18],
  [0.98, 0.74, 0.1],
  [0.2, 0.74, 0.3],
  [0.66, 0.32, 0.92],
  [0.96, 0.46, 0.76],
  [0.1, 0.8, 0.82],
  [0.96, 0.5, 0.14],
  [0.62, 0.86, 0.2],
  [0.58, 0.4, 0.26],
  [0.92, 0.92, 0.92],
  [0.36, 0.36, 0.48],
];

interface DifficultyRules {
  /** Aim error of bots, radians. */
  spread: number;
  /** Seconds before a bot opens fire on a new target. */
  react: number;
  /** How fast bots turn, radians per second. */
  turn: number;
  /** Damage bots deal to the player, as a fraction. */
  dmg: number;
  /** How far bots notice enemies, meters. */
  sight: number;
}

const DIFFICULTY: Record<Difficulty, DifficultyRules> = {
  easy: { spread: 0.075, react: 0.95, turn: 3.2, dmg: 0.55, sight: 80 },
  normal: { spread: 0.048, react: 0.6, turn: 4.6, dmg: 0.8, sight: 100 },
  hard: { spread: 0.03, react: 0.36, turn: 6.5, dmg: 1, sight: 120 },
};

export class FpsGame {
  readonly canvas: HTMLCanvasElement;
  private renderer: FpsRenderer;
  private hud: FpsHud;
  private audio = new FpsAudio();
  readonly terrain: FpsTerrain;
  readonly world: FpsWorld;
  private nav: FpsNav;
  private rng: Rng;
  readonly teams: Team[] = [];
  readonly points: Point[] = [];
  readonly soldiers: Soldier[] = [];
  readonly player: Soldier;
  private particles: Particle[] = [];
  private grenadeList: Grenade[] = [];
  /** Camera shake from nearby explosions, 0..1. */
  private shake = 0;
  /** Recent kills by the player, for double/triple kill callouts. */
  private streak: number[] = [];
  private stepPhase = 0;
  private whizCd = 0;
  private tracers: Tracer[] = [];
  private nextId = 1;
  time = 0;
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  state: "intro" | "playing" | "paused" | "ended" = "intro";
  private result: "victory" | "defeat" | null = null;
  private diff: DifficultyRules;

  // Input
  private keys = new Set<string>();
  private mouseDown = false;
  private aiming = false;
  /** The point the player asked to respawn at (number keys), or -1. */
  private preferredSpawn = -1;
  private killer: Soldier | null = null;
  /** Playing without pointer lock (unsupported browser, or tests). */
  private noLock = false;
  /** Smoothed eye height of the player (crouching lowers it). */
  private eyeH = EYE;
  /** 0 (hip) .. 1 (aiming down the sights), smoothed. */
  private adsT = 0;
  /** 0..1 while sprinting, smoothed (widens the view a little). */
  private sprintT = 0;
  private bloom = 0;
  private recoilPitch = 0;
  private kick = 0;
  private fov = 75;
  private hitMarker = 0;
  private damageFlash = 0;
  private killedBy = "";
  private sensitivity = BASE_SENSITIVITY;
  // Online
  private net: FpsNet | null;
  private netT = 0;
  private snapT = 0;
  private snapN = 0;
  private played = false;
  private lastChat = -10;
  private yieldTimer = 0;

  // Frame scratch
  private view = mat4();
  private proj = mat4();
  private proj2 = mat4();
  private boxes = new Float32Array(BOX_STRIDE * 4096);
  private boxCount = 0;
  private decals = new Float32Array(BOX_STRIDE * 512);
  private decalCount = 0;
  private sprites = new Float32Array(SPRITE_STRIDE * 2048);
  private spriteCount = 0;
  private tracerData = new Float32Array(TRACER_STRIDE * 512);
  private tracerCount = 0;
  private viewBoxes = new Float32Array(BOX_STRIDE * 64);
  private viewBoxCount = 0;
  private tmpA = new Float32Array(16);
  private tmpB = new Float32Array(16);
  private tmpC = new Float32Array(16);
  private teamTimer = 0;
  private frameAvg = 16;
  private adaptT = 0;
  private events: { text: string; at: number }[] = [];
  private feed: {
    killer: string;
    kc: string;
    victim: string;
    vc: string;
    head: boolean;
    grenade: boolean;
    at: number;
  }[] = [];

  constructor(
    private container: HTMLElement,
    readonly opts: FpsOptions,
    private deps: FpsDeps,
  ) {
    this.rng = new Rng(opts.seed);
    this.diff = DIFFICULTY[opts.difficulty];
    this.net = opts.net ?? null;
    this.terrain = new FpsTerrain(
      opts.terrain,
      opts.fullWidth,
      opts.fullHeight,
      360,
      opts.worldSize ?? 900,
    );
    const t = this.terrain;

    // Teams and their points.
    opts.nations.forEach((n, i) => {
      // Alone, your nation is always blue; online every player sees the
      // same colours, in the battle's order.
      const slot = this.net
        ? i
        : i === opts.playerNation
          ? 0
          : i < opts.playerNation
            ? i + 1
            : i;
      const c =
        slot < PALETTE.length
          ? PALETTE[slot]
          : hsl((slot * 0.61803) % 1, 0.75, 0.5);
      this.teams.push({
        name: n.name,
        color: c,
        css: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`,
        strength: clamp(n.strength || 1, 1, 3),
        kills: 0,
        eliminated: false,
      });
      const [mx, mz] = t.mapToWorld(n.x, n.y);
      const [x, z] = this.findPointSpot(mx, mz);
      this.points.push({
        name: n.name,
        x,
        y: t.heightAt(x, z),
        z,
        radius: POINT_RADIUS,
        owner: i,
        capturer: i,
        control: 1,
        contested: false,
      });
    });

    this.world = new FpsWorld(
      t,
      this.points.map((p) => ({ x: p.x, z: p.z, radius: p.radius })),
      opts.seed,
    );
    this.nav = new FpsNav(t, (x, z) => this.world.houseAt(x, z, 0.6) !== null);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "fps-canvas";
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;cursor:crosshair";
    container.appendChild(this.canvas);
    this.renderer = new FpsRenderer(this.canvas);
    this.renderer.setTerrain(t);
    this.renderer.setStatic(this.world.staticBoxes, this.world.staticCount);

    this.hud = new FpsHud(container, deps.t, this.teams, t, {
      onPlay: () => this.requestPlay(),
      onQuit: () => this.quit(),
      onRestart: () => {
        this.dispose();
        deps.onRestart();
      },
      getSensitivity: () => this.sensitivity / BASE_SENSITIVITY,
      setSensitivity: (v) => {
        this.sensitivity = BASE_SENSITIVITY * v;
        deps.onSensitivity?.(v);
      },
    });

    // Soldiers: the player, then each team's squad (online, only the host
    // runs bots; the others mirror them).
    this.player = this.makeSoldier(opts.playerNation, opts.playerName, true);
    this.soldiers.push(this.player);
    if (!this.net || this.net.isHost) {
      this.teams.forEach((team, ti) => {
        const squad = this.squadSize(ti);
        for (let k = 0; k < squad; k++) {
          const s = this.makeSoldier(ti, `${team.name} ${k + 1}`, false);
          this.soldiers.push(s);
        }
      });
    }
    for (const s of this.soldiers) this.spawn(s, true);
    if (this.net) {
      // Nobody can hurt you before you start playing.
      this.player.shieldUntil = Infinity;
      const net = this.net;
      net.events.onMessage = (from, msg) => this.onNet(from, msg);
      net.events.onLeave = (id) => this.removePeer(id);
      net.events.onHost = (id) => {
        if (id === net.id) this.becomeHost();
        else this.becomeGuest();
      };
      net.events.onClose = () => {
        this.hud.flash(deps.t("fps.connection_lost"));
        for (const s of this.soldiers) if (s.peer) this.removePeer(s.peer);
        this.becomeHost();
        this.net = null;
      };
    }
    this.hud.showIntro(opts.mapName, this.teams[opts.playerNation]);
    this.bindInput();
  }

  /**
   * Where a capture point goes: the nation's spot on the map, or the nearest
   * place with dry, walkable ground all around and room from other points.
   */
  private findPointSpot(x0: number, z0: number): [number, number] {
    const t = this.terrain;
    const clear = POINT_RADIUS * 0.8;
    const ok = (x: number, z: number) => {
      for (const p of this.points) {
        if (Math.hypot(p.x - x, p.z - z) < POINT_RADIUS * 3) return false;
      }
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const r = k === 8 ? 0 : clear;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (!t.passable(px, pz) || t.kindAt(px, pz) !== Cell.Land) return false;
        const h = t.heightAt(px, pz);
        if (h < 0.5 || h > 19) return false;
      }
      return true;
    };
    if (ok(x0, z0)) return [x0, z0];
    for (let r = 3; r < 400; r += 3) {
      const n = Math.max(8, Math.round(r * 0.7));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = x0 + Math.cos(a) * r;
        const z = z0 + Math.sin(a) * r;
        if (ok(x, z)) return [x, z];
      }
    }
    return t.nearestLand(x0, z0);
  }

  /** Solid, dry ground a soldier can appear on. */
  private standable(x: number, z: number): boolean {
    const t = this.terrain;
    return (
      t.passable(x, z) &&
      t.kindAt(x, z) === Cell.Land &&
      t.heightAt(x, z) > 0.4 &&
      !this.world.houseAt(x, z, RADIUS)
    );
  }

  private squadSize(team: number): number {
    const owned = this.points.filter((p) => p.owner === team).length;
    const base = 2 + this.teams[team].strength;
    const humans = this.soldiers.filter(
      (s) => (s.isPlayer || s.peer) && s.team === team,
    ).length;
    const isPlayers = -Math.min(
      2,
      humans || (team === this.opts.playerNation ? 1 : 0),
    );
    return clamp(base + Math.max(0, owned - 1) + isPlayers, 0, 8);
  }

  private makeSoldier(team: number, name: string, isPlayer: boolean): Soldier {
    return {
      id: this.nextId++,
      team,
      name,
      isPlayer,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      onGround: true,
      swimming: false,
      crouching: false,
      peer: 0,
      ghost: false,
      shots: 0,
      seenShots: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      tyaw: 0,
      tpitch: 0,
      grenades: 0,
      grenadeCd: 0,
      shieldUntil: 0,
      hp: 100,
      alive: false,
      diedAt: -100,
      respawnAt: 0,
      ammo: MAG,
      reserve: RESERVE,
      fireCd: 0,
      reloadT: 0,
      lastHurt: -100,
      walk: 0,
      kills: 0,
      deaths: 0,
      goal: -1,
      enemy: null,
      thinkT: this.rng.next() * 0.3,
      reactT: 0,
      strafe: 1,
      strafeT: 0,
      burst: 0,
      burstCd: 0,
      wanderX: 0,
      wanderZ: 0,
      stuckT: 0,
      lastX: 0,
      lastZ: 0,
    };
  }

  /** Which of its team's points a soldier comes back at, or null. */
  private spawnPoint(s: Soldier, initial: boolean): Point | null {
    if (initial) return this.points[s.team] ?? null;
    const owned = this.points.filter((p) => p.owner === s.team);
    if (owned.length === 0) return null;
    if (s.isPlayer && this.preferredSpawn >= 0) {
      const want = this.points[this.preferredSpawn];
      if (want && want.owner === s.team) return want;
    }
    // Not into a point that is being taken, unless there is no other.
    const safe = owned.filter((p) => !p.contested && p.capturer === s.team);
    const pool = safe.length > 0 ? safe : owned;
    // Close to the front: the point nearest to one we don't hold.
    const others = this.points.filter((p) => p.owner !== s.team);
    let best = pool[this.rng.int(pool.length)];
    if (others.length > 0 && this.rng.next() < (s.isPlayer ? 0.85 : 0.6)) {
      let bestD = Infinity;
      for (const p of pool) {
        for (const o of others) {
          const d = Math.hypot(p.x - o.x, p.z - o.z);
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
    }
    return best;
  }

  /** Puts a soldier (back) on the map at one of its team's points. */
  private spawn(s: Soldier, initial: boolean): boolean {
    const p = this.spawnPoint(s, initial);
    if (!p) return false;
    s.x = p.x + (this.rng.next() - 0.5) * 2;
    s.z = p.z + (this.rng.next() - 0.5) * 2;
    for (let tries = 0; tries < 24; tries++) {
      const a = this.rng.next() * Math.PI * 2;
      // Around the point rather than on it, so a point can be taken.
      const r = p.radius * 0.6 + this.rng.next() * 12;
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      if (!this.standable(x, z)) continue;
      s.x = x;
      s.z = z;
      break;
    }
    s.y = this.terrain.heightAt(s.x, s.z);
    s.vx = s.vy = s.vz = 0;
    s.hp = 100;
    s.alive = true;
    s.ammo = MAG;
    s.reserve = RESERVE;
    s.reloadT = 0;
    s.fireCd = s.isPlayer ? 0 : -10;
    s.crouching = false;
    s.grenades = s.isPlayer ? GRENADES : 1;
    s.grenadeCd = s.isPlayer ? 0 : 3;
    s.shieldUntil = this.time + SPAWN_SHIELD;
    s.enemy = null;
    s.goal = -1;
    // Face the map's middle.
    s.yaw = Math.atan2(
      -(this.terrain.sizeX / 2 - s.x),
      -(this.terrain.sizeZ / 2 - s.z),
    );
    s.pitch = 0;
    s.lastX = s.x;
    s.lastZ = s.z;
    return true;
  }

  // ------------------------------------------------------------------ input

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.state === "ended") return;
    // Typing a chat message: the keys are for the text box.
    if (this.hud.chatting) return;
    if (e.code === "Enter" && this.net && this.state === "playing") {
      e.preventDefault();
      this.keys.clear();
      this.mouseDown = false;
      this.hud.openChat((text) => this.sendChat(text));
      return;
    }
    // Without pointer lock, Esc has to pause by hand.
    if (e.code === "Escape" && this.state === "playing" && this.noLock) {
      this.pause();
      return;
    }
    if (this.state !== "playing") return;
    this.keys.add(e.code);
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit && !this.player.alive) {
      const i = Number(digit[1]) - 1;
      if (i < this.points.length && this.points[i].owner === this.player.team) {
        this.preferredSpawn = i;
      }
    }
    if (e.code === "KeyR") this.reload(this.player);
    if (e.code === "KeyG" && !e.repeat) this.throwGrenade(this.player);
    if (e.code === "KeyM" && !e.repeat) {
      this.audio.muted = !this.audio.muted;
      this.hud.flash(
        this.deps.t(this.audio.muted ? "fps.sound_off" : "fps.sound_on"),
      );
    }
    if (e.code === "KeyC" && !e.repeat) {
      this.player.crouching = !this.player.crouching;
    }
    if (e.code === "Tab" && !e.repeat) this.hud.setScoreboard(true);
    if (["Space", "Tab", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
      e.preventDefault();
    }
    e.stopPropagation();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === "Tab") this.hud.setScoreboard(false);
    if (this.state === "playing") e.stopPropagation();
  };

  private onMouseMove = (e: MouseEvent) => {
    if (this.state !== "playing") return;
    if (!this.noLock && document.pointerLockElement !== this.canvas) return;
    const sens = this.sensitivity * (this.aiming ? 0.55 : 1);
    this.player.yaw -= e.movementX * sens;
    this.player.pitch = clamp(
      this.player.pitch - e.movementY * sens,
      -1.45,
      1.45,
    );
  };

  private onMouseDown = (e: MouseEvent) => {
    if (this.state !== "playing") return;
    if (!this.noLock && document.pointerLockElement !== this.canvas) {
      this.requestPlay();
      return;
    }
    this.audio.unlock();
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.aiming = true;
  };

  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.aiming = false;
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  private onPointerLockChange = () => {
    if (document.pointerLockElement === this.canvas) {
      if (this.state !== "ended") {
        this.state = "playing";
        this.hud.hideOverlay();
        this.firstPlay();
      }
    } else if (this.state === "playing" && !this.noLock) {
      this.pause();
    }
  };

  private onPointerLockError = () => this.hud.lockRefused();

  private onBlur = () => {
    this.keys.clear();
    this.mouseDown = false;
    this.aiming = false;
  };

  private pause(): void {
    this.state = "paused";
    this.mouseDown = false;
    this.aiming = false;
    this.keys.clear();
    this.hud.setScoreboard(false);
    this.hud.showPause();
  }

  private bindInput(): void {
    window.addEventListener("keydown", this.onKeyDown, true);
    window.addEventListener("keyup", this.onKeyUp, true);
    window.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    document.addEventListener("pointerlockerror", this.onPointerLockError);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private unbindInput(): void {
    window.removeEventListener("keydown", this.onKeyDown, true);
    window.removeEventListener("keyup", this.onKeyUp, true);
    window.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    document.removeEventListener("pointerlockerror", this.onPointerLockError);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibility);
    clearTimeout(this.yieldTimer);
  }

  /** Locks the mouse to the game (from a click); the lock starts play. */
  requestPlay(): void {
    this.audio.unlock();
    if (this.state === "ended") return;
    if (typeof this.canvas.requestPointerLock !== "function") {
      this.playWithoutLock();
      return;
    }
    try {
      const r = this.canvas.requestPointerLock() as unknown;
      if (r instanceof Promise) r.catch(() => this.hud.lockRefused());
    } catch {
      this.hud.lockRefused();
    }
  }

  /** Browsers without pointer lock (and tests) still get a running game. */
  playWithoutLock(): void {
    if (this.state === "ended") return;
    this.noLock = true;
    this.state = "playing";
    this.hud.hideOverlay();
    this.firstPlay();
  }

  /** Online, the spawn protection holds until you actually start. */
  private firstPlay(): void {
    if (this.played) return;
    this.played = true;
    // A joiner's home point may have fallen since: start at one we hold.
    if (this.net && !this.authority) this.spawn(this.player, false);
    if (this.player.shieldUntil === Infinity) {
      this.player.shieldUntil = this.time + SPAWN_SHIELD;
    }
  }

  setSensitivity(v: number): void {
    this.sensitivity = v;
  }

  // ------------------------------------------------------------------- loop

  start(): void {
    this.lastFrame = performance.now();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.adaptResolution(dt);
      // Online the battle goes on while you're in a menu.
      if (
        this.state === "playing" ||
        (this.net !== null && this.state !== "ended")
      ) {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= 1 / 60 && steps < 6) {
          this.update(1 / 60);
          this.acc -= 1 / 60;
          steps++;
        }
      }
      this.draw();
    };
    this.raf = requestAnimationFrame(frame);
  }

  /**
   * Keeps the frame rate up on slow machines: renders fewer pixels when
   * frames take too long, and more again when there is room.
   */
  private adaptResolution(dt: number): void {
    if (this.state !== "playing" || dt <= 0) return;
    this.frameAvg = this.frameAvg * 0.95 + dt * 1000 * 0.05;
    this.adaptT += dt;
    if (this.adaptT < 2.5) return;
    this.adaptT = 0;
    const r = this.renderer;
    if (this.frameAvg > 24 && r.scale > 0.5) {
      r.scale = Math.max(0.5, r.scale - 0.15);
    } else if (this.frameAvg < 17.5 && r.scale < 1) {
      r.scale = Math.min(1, r.scale + 0.1);
    }
  }

  /** Advances the simulation (also used by tests). */
  step(seconds: number): void {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) this.update(1 / 60);
  }

  /** Alone, or the online room's host: runs the bots and the points. */
  private get authority(): boolean {
    return this.net === null || this.net.isHost;
  }

  private update(dt: number): void {
    this.time += dt;
    this.updatePlayer(dt);
    for (const s of this.soldiers) {
      if (s.isPlayer) continue;
      if (s.peer || s.ghost) {
        this.follow(s, dt);
        continue;
      }
      if (s.alive) this.updateBot(s, dt);
      else if (this.time >= s.respawnAt && s.respawnAt > 0) {
        if (!this.spawn(s, false)) s.respawnAt = this.time + 3;
      }
    }
    this.separate();
    if (this.authority) {
      this.updatePoints(dt);
      this.teamTimer -= dt;
      if (this.teamTimer <= 0) {
        this.teamTimer = 1;
        this.refreshTeams();
      }
    }
    this.updateGrenades(dt);
    this.updateEffects(dt);
    if (this.net) this.netTick(dt);
    this.checkEnd();
  }

  // ----------------------------------------------------------------- player

  private updatePlayer(dt: number): void {
    const p = this.player;
    this.hitMarker = Math.max(0, this.hitMarker - dt * 4);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.5);
    this.bloom = Math.max(0, this.bloom - dt * 0.12);
    this.kick = Math.max(0, this.kick - dt * 9);
    const adsTarget = this.aiming && p.alive && p.reloadT <= 0 ? 1 : 0;
    this.adsT += (adsTarget - this.adsT) * Math.min(1, dt * 14);
    const sprinting =
      p.alive && p.onGround && Math.hypot(p.vx, p.vz) > 6.5 && this.adsT < 0.1;
    this.sprintT += ((sprinting ? 1 : 0) - this.sprintT) * Math.min(1, dt * 6);
    this.fov = 75 - 23 * this.adsT + 6 * this.sprintT;
    // Recoil recovers over time.
    const rec = Math.min(this.recoilPitch, dt * 0.6);
    this.recoilPitch -= rec;
    p.pitch -= rec * 0.5;

    const targetEye = p.crouching ? CROUCH_EYE : EYE;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 12);
    if (!p.alive) {
      // The camera turns to whoever got you.
      const k = this.killer;
      if (k && k.alive) {
        const want = Math.atan2(-(k.x - p.x), -(k.z - p.z));
        p.yaw += angleDiff(p.yaw, want) * Math.min(1, dt * 3);
      }
      if (this.time >= p.respawnAt && p.respawnAt > 0) {
        if (this.spawn(p, false)) {
          this.hud.flash(this.deps.t("fps.respawned"));
          this.killer = null;
        } else {
          // Nowhere to come back yet: try again once a point is ours.
          p.respawnAt = this.time + 1;
        }
      }
      return;
    }

    // Movement input.
    let fx = 0;
    let fz = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) fz -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) fz += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) fx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) fx += 1;
    const len = Math.hypot(fx, fz);
    const sprint =
      (this.keys.has("ShiftLeft") || this.keys.has("ShiftRight")) &&
      fz < 0 &&
      !this.aiming;
    if (sprint) p.crouching = false;
    let speed = sprint ? 8.2 : 5.2;
    if (p.crouching) speed = 2.6;
    if (this.aiming) speed = Math.min(speed, 3.2);
    if (p.swimming) speed = 2.6;
    let wx = 0;
    let wz = 0;
    if (len > 0) {
      fx /= len;
      fz /= len;
      // Rotate by yaw: forward is -Z at yaw 0.
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      wx = fx * c + fz * s;
      wz = -fx * s + fz * c;
    }
    const accel = p.onGround || p.swimming ? 14 : 3;
    p.vx += (wx * speed - p.vx) * Math.min(1, accel * dt);
    p.vz += (wz * speed - p.vz) * Math.min(1, accel * dt);
    if (this.keys.has("Space") && p.onGround && !p.swimming) {
      p.vy = 7;
      p.onGround = false;
    }
    this.moveBody(p, dt);
    if (len > 0 && p.onGround) p.walk += dt * (sprint ? 11 : 8);

    // Shooting.
    p.fireCd -= dt;
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) this.finishReload(p);
    }
    if (this.mouseDown && p.fireCd <= 0 && p.reloadT <= 0 && !sprint) {
      if (p.ammo > 0) this.playerFire();
      else this.reload(p);
    }
    // Health comes back after a few quiet seconds.
    if (this.time - p.lastHurt > 5 && p.hp < 100)
      p.hp = Math.min(100, p.hp + dt * 14);
    // Standing in a point you hold refills ammo.
    const here = this.points.find(
      (pt) =>
        pt.owner === p.team && Math.hypot(pt.x - p.x, pt.z - p.z) < pt.radius,
    );
    if (here && p.reserve < RESERVE)
      p.reserve = Math.min(RESERVE, p.reserve + dt * 40);
    p.grenadeCd -= dt;
    if (here && p.grenades < GRENADES && p.grenadeCd <= -6) {
      p.grenades++;
      p.grenadeCd = 0;
    }
    // Footsteps.
    if (p.onGround && len > 0) {
      const phase = Math.floor(p.walk / Math.PI);
      if (phase !== this.stepPhase) {
        this.stepPhase = phase;
        this.audio.step(sprint ? 0.5 : p.crouching ? 0.15 : 0.3);
      }
    }
  }

  private playerFire(): void {
    const p = this.player;
    p.fireCd = FIRE_INTERVAL;
    p.ammo--;
    p.shots++;
    const moving = Math.hypot(p.vx, p.vz) / 5.2;
    const spread =
      (this.aiming ? 0.0025 : 0.011) +
      moving * (this.aiming ? 0.006 : 0.022) +
      this.bloom +
      (p.onGround ? 0 : 0.04);
    const steady = p.crouching && p.onGround ? 0.7 : 1;
    this.bloom = Math.min(0.035, this.bloom + (this.aiming ? 0.0016 : 0.0035));
    const [dx, dy, dz] = this.spreadDir(p.yaw, p.pitch, spread * steady);
    const eye = this.eyeY(p);
    const hit = this.trace(p, p.x, eye, p.z, dx, dy, dz);
    const hx = p.x + dx * hit.t;
    const hy = eye + dy * hit.t;
    const hz = p.z + dz * hit.t;
    // The tracer starts at the muzzle, a little right of and below the eye.
    const [fx, fy, fz] = forward(p.yaw, p.pitch);
    const rx = Math.cos(p.yaw);
    const rz = -Math.sin(p.yaw);
    const mx = p.x + fx * 0.9 + rx * 0.22;
    const my = eye + fy * 0.9 - 0.16;
    const mz = p.z + fz * 0.9 + rz * 0.22;
    this.addTracer(mx, my, mz, hx, hy, hz, 1, 0.9, 0.55);
    this.impact(hit, hx, hy, hz);
    if (hit.soldier) this.damage(hit.soldier, p, hit.head);
    // Recoil.
    const kickUp = this.aiming ? 0.008 : 0.014;
    p.pitch = Math.min(1.45, p.pitch + kickUp);
    this.recoilPitch += kickUp * 0.8;
    p.yaw += (this.rng.next() - 0.5) * (this.aiming ? 0.006 : 0.012);
    this.kick = 1;
    this.audio.shot(1, 0, false);
    // Muzzle light for nearby smoke.
    this.addParticle(
      mx,
      my,
      mz,
      0,
      0.5,
      0,
      0.5,
      0.35,
      0.6,
      0.6,
      0.6,
      0.12,
      false,
      -0.4,
    );
  }

  private eyeY(s: Soldier): number {
    if (s.isPlayer) return s.y + this.eyeH;
    return s.y + (s.crouching ? CROUCH_EYE : EYE);
  }

  /** Height of a soldier's chest, where bots aim. */
  private chestY(s: Soldier): number {
    return s.y + (s.crouching ? 0.85 : 1.25);
  }

  /** Direction from yaw/pitch, randomly deflected inside a cone. */
  private spreadDir(
    yaw: number,
    pitch: number,
    spread: number,
  ): [number, number, number] {
    const a = this.rng.next() * Math.PI * 2;
    const r = Math.sqrt(this.rng.next()) * spread;
    return forward(yaw + Math.cos(a) * r, pitch + Math.sin(a) * r);
  }

  private reload(s: Soldier): void {
    if (s.reloadT > 0 || s.ammo >= MAG || s.reserve <= 0) return;
    s.reloadT = s.isPlayer ? RELOAD_TIME : RELOAD_TIME + 0.4;
    if (s.isPlayer) this.audio.reload();
  }

  private finishReload(s: Soldier): void {
    const need = MAG - s.ammo;
    const take = s.isPlayer ? Math.min(need, Math.floor(s.reserve)) : need;
    s.ammo += take;
    if (s.isPlayer) s.reserve -= take;
    s.reloadT = 0;
  }

  // -------------------------------------------------------------- movement

  /** Integrates velocity with terrain, water, walls and houses. */
  private moveBody(s: Soldier, dt: number): void {
    const t = this.terrain;
    let nx = s.x + s.vx * dt;
    let nz = s.z + s.vz * dt;
    if (!t.passable(nx, s.z)) {
      nx = s.x;
      s.vx = 0;
    }
    if (!t.passable(nx, nz)) {
      nz = s.z;
      s.vz = 0;
    }
    [nx, nz] = this.world.collide(nx, s.y, nz, RADIUS);
    if (!t.passable(nx, nz)) {
      nx = s.x;
      nz = s.z;
    }
    s.x = nx;
    s.z = nz;
    const ground = t.heightAt(s.x, s.z);
    const swimY = WATER_LEVEL - 1.25;
    if (ground < swimY) {
      // Deep water: float with the head out.
      s.swimming = true;
      s.y += (swimY - s.y) * Math.min(1, dt * 6);
      s.vy = 0;
      s.onGround = false;
      return;
    }
    s.swimming = false;
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= ground) {
      s.y = ground;
      s.vy = 0;
      s.onGround = true;
    } else if (s.y - ground < 0.25 && s.vy <= 0) {
      // Stick to the ground walking downhill.
      s.y = ground;
      s.vy = 0;
      s.onGround = true;
    } else {
      s.onGround = false;
    }
  }

  /** Keeps soldiers from standing inside each other (bots give way). */
  private separate(): void {
    const alive = this.soldiers.filter((s) => s.alive);
    const min = RADIUS * 2;
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min || d2 < 1e-6 || Math.abs(a.y - b.y) > 1.6) continue;
        const d = Math.sqrt(d2);
        const push = min - d;
        const ux = dx / d;
        const uz = dz / d;
        const wa = a.isPlayer ? 0 : b.isPlayer ? 1 : 0.5;
        const wb = 1 - wa;
        this.nudge(a, -ux * push * wa, -uz * push * wa);
        this.nudge(b, ux * push * wb, uz * push * wb);
      }
    }
  }

  private nudge(s: Soldier, dx: number, dz: number): void {
    if (dx === 0 && dz === 0) return;
    const x = s.x + dx;
    const z = s.z + dz;
    if (!this.terrain.passable(x, z) || this.world.houseAt(x, z, RADIUS * 0.5))
      return;
    s.x = x;
    s.z = z;
  }

  // --------------------------------------------------------------------- AI

  private updateBot(s: Soldier, dt: number): void {
    s.thinkT -= dt;
    if (s.thinkT <= 0) {
      s.thinkT = 0.22 + this.rng.next() * 0.18;
      this.think(s);
    }
    const enemy = s.enemy && s.enemy.alive ? s.enemy : null;
    if (!enemy) s.enemy = null;

    // Toward the objective.
    let gx = 0;
    let gz = 0;
    let goalDist = Infinity;
    let onGoal = false;
    if (s.goal >= 0) {
      const g = this.points[s.goal];
      goalDist = Math.hypot(g.x - s.x, g.z - s.z);
      if (goalDist < g.radius * 0.6) {
        // On the point: mill about inside the circle.
        onGoal = true;
        if (
          Math.hypot(s.wanderX - s.x, s.wanderZ - s.z) < 1.2 ||
          this.rng.next() < dt * 0.4
        ) {
          const a = this.rng.next() * Math.PI * 2;
          const r = this.rng.next() * g.radius * 0.6;
          s.wanderX = g.x + Math.cos(a) * r;
          s.wanderZ = g.z + Math.sin(a) * r;
        }
        const wx = s.wanderX - s.x;
        const wz = s.wanderZ - s.z;
        const wl = Math.hypot(wx, wz) || 1;
        gx = wx / wl;
        gz = wz / wl;
      } else if (goalDist < 30) {
        gx = (g.x - s.x) / goalDist;
        gz = (g.z - s.z) / goalDist;
      } else {
        const field = this.nav.field(s.goal, g.x, g.z);
        [gx, gz] = this.nav.direction(field, s.x, s.z);
        if (gx === 0 && gz === 0) {
          gx = (g.x - s.x) / goalDist;
          gz = (g.z - s.z) / goalDist;
        }
      }
    }

    let mx = gx;
    let mz = gz;
    let speed = onGoal ? 2 : goalDist < 30 ? 4.6 : 5.4;
    if (enemy) {
      const dx = enemy.x - s.x;
      const dz = enemy.z - s.z;
      const d = Math.hypot(dx, dz) || 1;
      s.strafeT -= dt;
      if (s.strafeT <= 0) {
        s.strafe = this.rng.next() < 0.5 ? -1 : 1;
        s.strafeT = 0.6 + this.rng.next() * 1.4;
      }
      const sx = (-dz / d) * s.strafe;
      const sz = (dx / d) * s.strafe;
      if (onGoal) {
        // Hold the point: dodge about without leaving it.
        mx = sx * 0.8 + gx * 0.4;
        mz = sz * 0.8 + gz * 0.4;
        speed = 3;
      } else if (s.goal >= 0 && d > 22) {
        // Keep advancing on the objective, firing on the move.
        mx = gx * 0.85 + sx * 0.4;
        mz = gz * 0.85 + sz * 0.4;
        speed = 3.9;
      } else {
        // Close fight: sideways, closing in or backing off.
        const approach = d > 16 ? 0.5 : d < 8 ? -0.6 : 0.1;
        mx = sx + (dx / d) * approach;
        mz = sz + (dz / d) * approach;
        speed = 3.6;
      }
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml;
      mz /= ml;
    }
    // Unstick: if barely moving while trying to, sidestep for a moment.
    s.stuckT += dt;
    if (s.stuckT > 1.2) {
      const moved = Math.hypot(s.x - s.lastX, s.z - s.lastZ);
      if (moved < 0.6 && (mx || mz)) {
        const a = this.rng.next() * Math.PI * 2;
        s.vx = Math.cos(a) * 4;
        s.vz = Math.sin(a) * 4;
      }
      s.stuckT = 0;
      s.lastX = s.x;
      s.lastZ = s.z;
    }
    if (s.swimming) speed = 2.4;
    s.vx += (mx * speed - s.vx) * Math.min(1, dt * 8);
    s.vz += (mz * speed - s.vz) * Math.min(1, dt * 8);
    this.moveBody(s, dt);
    if (Math.hypot(s.vx, s.vz) > 0.5)
      s.walk += dt * Math.hypot(s.vx, s.vz) * 1.6;

    // Aim.
    let wantYaw = s.yaw;
    let wantPitch = 0;
    if (enemy) {
      const dx = enemy.x - s.x;
      const dz = enemy.z - s.z;
      const dy = this.chestY(enemy) - this.eyeY(s);
      wantYaw = Math.atan2(-dx, -dz);
      wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    } else if (Math.hypot(s.vx, s.vz) > 0.8) {
      wantYaw = Math.atan2(-s.vx, -s.vz);
    }
    const turn = this.diff.turn * dt;
    const dyaw = angleDiff(s.yaw, wantYaw);
    s.yaw += clamp(dyaw, -turn, turn);
    s.pitch += clamp(wantPitch - s.pitch, -turn, turn);

    // Fire.
    s.fireCd -= dt;
    s.burstCd -= dt;
    s.reactT -= dt;
    if (s.reloadT > 0) {
      s.reloadT -= dt;
      if (s.reloadT <= 0) this.finishReload(s);
    } else if (
      enemy &&
      s.reactT <= 0 &&
      Math.abs(dyaw) < 0.12 &&
      s.fireCd <= 0 &&
      s.burstCd <= 0
    ) {
      if (s.ammo <= 0) this.reload(s);
      else {
        this.botFire(s, enemy);
        s.burst--;
        if (s.burst <= 0) {
          s.burst = 3 + this.rng.int(5);
          s.burstCd = 0.25 + this.rng.next() * 0.6;
        }
      }
    } else if (!enemy && s.ammo < MAG / 2 && s.reloadT <= 0) {
      this.reload(s);
    }
    s.grenadeCd -= dt;
    if (enemy && s.grenades > 0 && s.grenadeCd <= 0 && s.reactT <= 0) {
      const d = Math.hypot(enemy.x - s.x, enemy.z - s.z);
      if (d > 10 && d < 32 && this.rng.next() < dt * 0.25) {
        this.botGrenade(s, enemy, d);
      }
    }
  }

  private think(s: Soldier): void {
    // Closest visible enemy.
    let best: Soldier | null = null;
    let bestD = this.diff.sight;
    const candidates: [Soldier, number][] = [];
    for (const o of this.soldiers) {
      if (!o.alive || o.team === s.team) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bestD + 40) candidates.push([o, d]);
    }
    candidates.sort((a, b) => a[1] - b[1]);
    let checks = 0;
    for (const [o, d] of candidates) {
      if (d > bestD || checks >= 3) break;
      checks++;
      // Mostly looking forward: far enemies behind are noticed less.
      const ang = Math.abs(
        angleDiff(s.yaw, Math.atan2(-(o.x - s.x), -(o.z - s.z))),
      );
      if (ang > 1.9 && d > 18 && o !== s.enemy) continue;
      if (this.canSee(s, o)) {
        best = o;
        bestD = d;
      }
    }
    if (best && best !== s.enemy) {
      s.reactT = this.diff.react * (0.7 + this.rng.next() * 0.6);
      s.burst = 3 + this.rng.int(5);
    }
    s.enemy = best;

    // Objective.
    const goal = s.goal >= 0 ? this.points[s.goal] : null;
    const goalDone =
      goal &&
      goal.owner === s.team &&
      goal.capturer === s.team &&
      !goal.contested;
    if (s.goal < 0 || goalDone || this.rng.next() < 0.02) {
      s.goal = this.pickGoal(s);
    }
  }

  private pickGoal(s: Soldier): number {
    // Defend a point of ours that is being taken, sometimes.
    const threatened = this.points
      .map((p, i) => [p, i] as const)
      .filter(
        ([p]) =>
          p.owner === s.team &&
          (p.contested || p.capturer !== s.team || p.control < 1),
      );
    const near = threatened.filter(
      ([p]) => Math.hypot(p.x - s.x, p.z - s.z) < 160,
    );
    if (near.length > 0 && this.rng.next() < 0.35) {
      return near[this.rng.int(near.length)][1];
    }
    let best = -1;
    let bestScore = Infinity;
    this.points.forEach((p, i) => {
      if (p.owner === s.team && p.capturer === s.team) return;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      const score =
        d * (0.75 + this.rng.next() * 0.5) + (p.owner >= 0 ? 0 : -40);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) {
      // Everything is ours: guard a random point.
      best = this.rng.int(this.points.length);
    }
    return best;
  }

  private canSee(a: Soldier, b: Soldier): boolean {
    const ay = this.eyeY(a);
    const by = this.chestY(b) + 0.05;
    if (this.terrain.raycast(a.x, ay, a.z, b.x, by, b.z) >= 0) return false;
    return this.world.raycastHouses(a.x, ay, a.z, b.x, by, b.z) < 0;
  }

  private botFire(s: Soldier, target: Soldier): void {
    s.fireCd = FIRE_INTERVAL * 1.35;
    s.ammo--;
    s.shots++;
    const d = Math.hypot(target.x - s.x, target.z - s.z);
    const moving = Math.hypot(target.vx, target.vz) > 3 ? 0.012 : 0;
    const spread = this.diff.spread + moving + (d > 80 ? 0.01 : 0);
    const [dx, dy, dz] = this.spreadDir(s.yaw, s.pitch, spread);
    const eye = this.eyeY(s);
    const hit = this.trace(s, s.x, eye, s.z, dx, dy, dz);
    const hx = s.x + dx * hit.t;
    const hy = eye + dy * hit.t;
    const hz = s.z + dz * hit.t;
    const [fx, fy, fz] = forward(s.yaw, s.pitch);
    const mx = s.x + fx * 0.85 + Math.cos(s.yaw) * 0.18;
    const my = eye - 0.25 + fy * 0.85;
    const mz = s.z + fz * 0.85 - Math.sin(s.yaw) * 0.18;
    this.addTracer(mx, my, mz, hx, hy, hz, 1, 0.75, 0.4);
    this.addParticle(
      mx,
      my,
      mz,
      0,
      0,
      0,
      0.05,
      -0.32,
      1,
      0.8,
      0.4,
      0.9,
      true,
      0,
    );
    this.impact(hit, hx, hy, hz);
    if (hit.soldier) this.damage(hit.soldier, s, hit.head);
    // A near miss on the player cracks past their ear.
    const pl = this.player;
    if (pl.alive && hit.soldier !== pl && this.whizCd <= 0) {
      const ex = pl.x - s.x;
      const ey = this.eyeY(pl) - eye;
      const ez = pl.z - s.z;
      const along = ex * dx + ey * dy + ez * dz;
      if (along > 3 && along < hit.t) {
        const miss = Math.hypot(
          ex - dx * along,
          ey - dy * along,
          ez - dz * along,
        );
        if (miss < 1.6) {
          this.whizCd = 0.25;
          const ang = angleDiff(
            pl.yaw,
            Math.atan2(-(s.x - pl.x), -(s.z - pl.z)),
          );
          this.audio.whiz(clamp(-Math.sin(ang), -1, 1));
        }
      }
    }
    // Sound, quieter and panned by where it came from.
    const p = this.player;
    const pd = Math.hypot(s.x - p.x, s.z - p.z);
    if (pd < 220) {
      const ang = angleDiff(p.yaw, Math.atan2(-(s.x - p.x), -(s.z - p.z)));
      this.audio.shot(
        clamp(1 - pd / 220, 0, 1) * 0.55,
        clamp(-Math.sin(ang), -1, 1),
        true,
      );
    }
  }

  // ----------------------------------------------------------------- combat

  /**
   * Hitscan from (ox, oy, oz) along a unit direction: the first thing hit
   * among the ground, houses and soldiers (not the shooter's teammates,
   * unless `allies`).
   */
  private trace(
    shooter: Soldier,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    allies = false,
  ): Hit {
    let best: Hit = { t: RANGE, soldier: null, head: false, kind: "none" };
    const ex = ox + dx * RANGE;
    const ey = oy + dy * RANGE;
    const ez = oz + dz * RANGE;
    const tt = this.terrain.raycast(ox, oy, oz, ex, ey, ez);
    if (tt >= 0)
      best = { t: tt * RANGE, soldier: null, head: false, kind: "terrain" };
    const th = this.world.raycastHouses(ox, oy, oz, ex, ey, ez);
    if (th >= 0 && th * RANGE < best.t) {
      best = { t: th * RANGE, soldier: null, head: false, kind: "house" };
    }
    for (const s of this.soldiers) {
      if (!s.alive || s === shooter || (!allies && s.team === shooter.team))
        continue;
      const cx = s.x - ox;
      const cz = s.z - oz;
      // Quick reject: behind, or farther than what is already hit.
      const along = cx * dx + cz * dz;
      if (along < -1 || along > best.t + 1) continue;
      const top = s.crouching ? 1.0 : 1.45;
      const headY = s.y + (s.crouching ? 1.15 : 1.62);
      const headT = raySphere(ox, oy, oz, dx, dy, dz, s.x, headY, s.z, 0.24);
      if (headT >= 0 && headT < best.t) {
        best = { t: headT, soldier: s, head: true, kind: "soldier" };
        continue;
      }
      // Body: an upright capped cylinder.
      const a = dx * dx + dz * dz;
      let tIn = 0;
      let tOut = Infinity;
      if (a > 1e-9) {
        const b = -2 * (dx * cx + dz * cz);
        const c = cx * cx + cz * cz - 0.36 * 0.36;
        const disc = b * b - 4 * a * c;
        if (disc < 0) continue;
        const sq = Math.sqrt(disc);
        tIn = (-b - sq) / (2 * a);
        tOut = (-b + sq) / (2 * a);
      } else if (cx * cx + cz * cz > 0.36 * 0.36) {
        continue;
      }
      if (Math.abs(dy) > 1e-9) {
        let y0 = (s.y - oy) / dy;
        let y1 = (s.y + top - oy) / dy;
        if (y0 > y1) [y0, y1] = [y1, y0];
        tIn = Math.max(tIn, y0);
        tOut = Math.min(tOut, y1);
      } else if (oy < s.y || oy > s.y + top) {
        continue;
      }
      if (tIn > tOut || tOut < 0) continue;
      const tHit = Math.max(0, tIn);
      if (tHit >= best.t) continue;
      best = { t: tHit, soldier: s, head: false, kind: "soldier" };
    }
    return best;
  }

  private damage(
    victim: Soldier,
    attacker: Soldier,
    head: boolean,
    amount = DAMAGE * (head ? HEADSHOT : 1),
    grenade = false,
  ): void {
    if (this.time < victim.shieldUntil) return;
    // Online, a soldier simulated elsewhere takes the hit there: a remote
    // player on their own machine, a bot on the host's.
    if (this.net && (victim.peer || victim.ghost)) {
      if (!victim.alive) return;
      this.net.send({
        t: "e",
        k: "hit",
        to: victim.peer || this.net.hostId,
        v: this.refOf(victim),
        a: this.refOf(attacker),
        d: Math.round(amount * 10) / 10,
        h: head ? 1 : 0,
        g: grenade ? 1 : 0,
      });
      if (attacker.isPlayer) {
        this.hitMarker = 1;
        this.audio.hit(head);
      }
      return;
    }
    let dmg = amount;
    // Bots go easier on you by difficulty; players don't.
    const fromBot = !attacker.isPlayer && !attacker.peer;
    if (victim.isPlayer && fromBot) dmg *= this.diff.dmg;
    victim.hp -= dmg;
    victim.lastHurt = this.time;
    if (attacker.isPlayer) {
      this.hitMarker = 1;
      this.audio.hit(head);
    }
    if (victim.isPlayer) {
      this.damageFlash = Math.min(1, this.damageFlash + 0.45);
      this.audio.hurt();
      this.hud.hurtFrom(
        angleDiff(
          victim.yaw,
          Math.atan2(-(attacker.x - victim.x), -(attacker.z - victim.z)),
        ),
      );
    }
    // Bots turn toward whoever shoots them.
    if (!victim.isPlayer && victim.enemy === null && victim.alive) {
      victim.enemy = attacker;
      victim.reactT = this.diff.react * 0.8;
    }
    if (victim.hp <= 0 && victim.alive) {
      this.kill(victim, attacker, head, grenade);
    }
  }

  private kill(
    victim: Soldier,
    killer: Soldier,
    head: boolean,
    grenade = false,
  ): void {
    victim.alive = false;
    victim.hp = 0;
    victim.diedAt = this.time;
    victim.deaths++;
    killer.kills++;
    this.teams[killer.team].kills++;
    victim.respawnAt =
      this.time + (victim.isPlayer ? PLAYER_RESPAWN : BOT_RESPAWN);
    // Online: tell the room (we only ever kill soldiers we simulate).
    this.net?.send({
      t: "e",
      k: "kill",
      a: this.refOf(killer),
      v: this.refOf(victim),
      h: head ? 1 : 0,
      g: grenade ? 1 : 0,
    });
    this.feed.push({
      killer: this.nameOf(killer),
      kc: this.teams[killer.team].css,
      victim: this.nameOf(victim),
      vc: this.teams[victim.team].css,
      head,
      grenade,
      at: this.time,
    });
    if (this.feed.length > 6) this.feed.shift();
    for (let i = 0; i < 14; i++) {
      this.addParticle(
        victim.x,
        victim.y + 1 + this.rng.next(),
        victim.z,
        (this.rng.next() - 0.5) * 3,
        this.rng.next() * 3,
        (this.rng.next() - 0.5) * 3,
        0.6 + this.rng.next() * 0.4,
        0.18,
        0.6,
        0.05,
        0.05,
        0.9,
        false,
        9,
      );
    }
    if (killer.isPlayer) this.creditKill(this.nameOf(victim), head);
    if (victim.isPlayer) {
      this.killedBy = killer.name;
      this.killer = killer;
      this.mouseDown = false;
    }
  }

  // --------------------------------------------------------------- grenades

  private throwGrenade(s: Soldier): void {
    if (!s.alive || s.grenades <= 0 || (s.isPlayer && s.grenadeCd > 0)) return;
    if (this.state !== "playing") return;
    s.grenades--;
    s.grenadeCd = 1;
    const [fx, fy, fz] = forward(s.yaw, s.pitch + 0.12);
    const speed = 17;
    this.launchGrenade(
      s,
      fx * speed + s.vx,
      fy * speed + s.vy * 0.5,
      fz * speed + s.vz,
    );
    if (s.isPlayer) this.audio.throwSound();
  }

  /** A bot lobs a grenade in an arc to land near its target. */
  private botGrenade(s: Soldier, target: Soldier, d: number): void {
    s.grenades--;
    s.grenadeCd = 6;
    const angle = 0.6;
    const v =
      Math.sqrt((d * GRAVITY) / Math.sin(2 * angle)) *
      (0.9 + this.rng.next() * 0.2);
    const dx = (target.x - s.x) / d;
    const dz = (target.z - s.z) / d;
    const h = Math.cos(angle) * v;
    this.launchGrenade(s, dx * h, Math.sin(angle) * v, dz * h);
  }

  private launchGrenade(s: Soldier, vx: number, vy: number, vz: number): void {
    const [fx, , fz] = forward(s.yaw, 0);
    const g: Grenade = {
      x: s.x + fx * 0.5,
      y: this.eyeY(s) - 0.1,
      z: s.z + fz * 0.5,
      vx,
      vy,
      vz,
      fuse: GRENADE_FUSE,
      spin: 0,
      owner: s,
    };
    this.grenadeList.push(g);
    this.net?.send({
      t: "e",
      k: "nade",
      o: this.refOf(s),
      p: [g.x, g.y, g.z].map(round2),
      v: [vx, vy, vz].map(round2),
    });
  }

  private updateGrenades(dt: number): void {
    const t = this.terrain;
    for (const g of this.grenadeList) {
      g.fuse -= dt;
      g.spin += dt * 9;
      g.vy -= GRAVITY * dt;
      let nx = g.x + g.vx * dt;
      let nz = g.z + g.vz * dt;
      const ny = g.y + g.vy * dt;
      // Bounce off houses and cliffs sideways.
      const house = this.world.houseAt(nx, nz, 0.1);
      if ((house && ny < house.maxY) || !t.passable(nx, nz)) {
        nx = g.x;
        nz = g.z;
        g.vx *= -0.4;
        g.vz *= -0.4;
      }
      g.x = nx;
      g.z = nz;
      g.y = ny;
      const ground = t.heightAt(g.x, g.z);
      if (g.y < ground + 0.06) {
        g.y = ground + 0.06;
        if (g.vy < -1.5) this.audio.bounce();
        g.vy = Math.abs(g.vy) * 0.3;
        g.vx *= 0.55;
        g.vz *= 0.55;
      }
      if (g.y < WATER_LEVEL) {
        g.vx *= 0.9;
        g.vz *= 0.9;
        g.vy *= 0.9;
      }
      if (g.fuse <= 0) this.explode(g);
    }
    this.grenadeList = this.grenadeList.filter((g) => g.fuse > 0);
  }

  private explode(g: Grenade): void {
    const underwater = g.y < WATER_LEVEL - 0.3;
    // Fireball, smoke and dirt.
    for (let i = 0; i < (underwater ? 0 : 26); i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * 4;
      this.addParticle(
        g.x,
        g.y + 0.4,
        g.z,
        Math.cos(a) * r,
        1 + this.rng.next() * 4,
        Math.sin(a) * r,
        0.35 + this.rng.next() * 0.3,
        -(0.9 + this.rng.next() * 1.2),
        1,
        0.55 + this.rng.next() * 0.3,
        0.15,
        1,
        true,
        -1,
      );
    }
    for (let i = 0; i < 22; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.next() * 2.5;
      const c = underwater ? 0.85 : 0.25 + this.rng.next() * 0.2;
      this.addParticle(
        g.x,
        g.y + 0.6,
        g.z,
        Math.cos(a) * r,
        1.5 + this.rng.next() * (underwater ? 7 : 2.5),
        Math.sin(a) * r,
        1.4 + this.rng.next() * 1.4,
        1.1 + this.rng.next() * 0.9,
        c,
        c,
        underwater ? 0.95 : c,
        0.75,
        false,
        underwater ? 8 : -0.6,
      );
    }
    for (let i = 0; i < 14; i++) {
      this.addParticle(
        g.x,
        g.y + 0.2,
        g.z,
        (this.rng.next() - 0.5) * 9,
        3 + this.rng.next() * 6,
        (this.rng.next() - 0.5) * 9,
        0.8 + this.rng.next() * 0.5,
        0.09,
        0.32,
        0.25,
        0.16,
        1,
        false,
        16,
      );
    }
    // Damage everyone around (but not teammates), unless sheltered. Online,
    // each machine hurts only what it simulates: you, and the host its bots.
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      if (this.net && (s.peer || s.ghost)) continue;
      if (s.team === g.owner.team && s !== g.owner) continue;
      const cy = this.chestY(s);
      const d = Math.hypot(s.x - g.x, cy - g.y, s.z - g.z);
      if (d >= GRENADE_RADIUS) continue;
      if (this.world.raycastHouses(g.x, g.y + 0.3, g.z, s.x, cy, s.z) >= 0)
        continue;
      if (this.terrain.raycast(g.x, g.y + 0.3, g.z, s.x, cy, s.z) >= 0)
        continue;
      const k = 1 - d / GRENADE_RADIUS;
      this.damage(s, g.owner, false, 30 + (GRENADE_DAMAGE - 30) * k, true);
    }
    // Sound and a shake for the player, by distance.
    const p = this.player;
    const pd = Math.hypot(p.x - g.x, p.z - g.z);
    if (pd < 260) {
      const ang = angleDiff(p.yaw, Math.atan2(-(g.x - p.x), -(g.z - p.z)));
      this.audio.boom(clamp(1 - pd / 260, 0, 1), clamp(-Math.sin(ang), -1, 1));
    }
    this.shake = Math.max(this.shake, clamp(1 - pd / 30, 0, 1));
  }

  /** You got a kill: sound, callout and streaks. */
  private creditKill(victim: string, head: boolean): void {
    this.audio.kill();
    this.hud.flash(
      this.deps.t(head ? "fps.headshot_kill" : "fps.kill", { name: victim }),
    );
    // Several kills in quick succession get a callout.
    this.streak = this.streak.filter((t) => this.time - t < 4);
    this.streak.push(this.time);
    if (this.streak.length === 2)
      this.hud.flash(this.deps.t("fps.double_kill"));
    if (this.streak.length === 3)
      this.hud.flash(this.deps.t("fps.triple_kill"));
    if (this.streak.length >= 4) this.hud.flash(this.deps.t("fps.multi_kill"));
  }

  private impact(hit: Hit, x: number, y: number, z: number): void {
    if (hit.kind === "none") return;
    const n = hit.kind === "soldier" ? 6 : 5;
    for (let i = 0; i < n; i++) {
      const vx = (this.rng.next() - 0.5) * 3;
      const vy = this.rng.next() * 3;
      const vz = (this.rng.next() - 0.5) * 3;
      if (hit.kind === "soldier") {
        this.addParticle(
          x,
          y,
          z,
          vx,
          vy,
          vz,
          0.35,
          0.09,
          0.7,
          0.04,
          0.04,
          0.95,
          false,
          10,
        );
      } else if (hit.kind === "house") {
        this.addParticle(
          x,
          y,
          z,
          vx,
          vy,
          vz,
          0.18,
          -0.06,
          1,
          0.85,
          0.5,
          1,
          true,
          12,
        );
        this.addParticle(
          x,
          y,
          z,
          vx * 0.2,
          0.4,
          vz * 0.2,
          0.6,
          0.22,
          0.8,
          0.78,
          0.72,
          0.5,
          false,
          -0.3,
        );
      } else {
        this.addParticle(
          x,
          y,
          z,
          vx * 0.6,
          vy,
          vz * 0.6,
          0.55,
          0.2,
          0.45,
          0.38,
          0.28,
          0.75,
          false,
          6,
        );
      }
    }
  }

  // ----------------------------------------------------------------- points

  /**
   * Capture rules: the team with the most soldiers in a point's circle makes
   * progress (faster with a bigger lead); a tie holds it still. An enemy
   * point is first neutralized, then captured.
   */
  private updatePoints(dt: number): void {
    const counts = new Map<number, number>();
    for (const p of this.points) {
      counts.clear();
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        if (
          Math.hypot(s.x - p.x, s.z - p.z) <= p.radius &&
          Math.abs(s.y - p.y) < 6
        ) {
          counts.set(s.team, (counts.get(s.team) ?? 0) + 1);
        }
      }
      p.contested = counts.size > 1;
      let team = -1;
      let best = 0;
      let second = 0;
      for (const [tm, n] of counts) {
        if (n > best) {
          second = best;
          best = n;
          team = tm;
        } else if (n > second) {
          second = n;
        }
      }
      const lead = best - second;
      if (team < 0 || lead <= 0) continue;
      const rate = CAPTURE_RATE * Math.min(3, lead) * dt;
      if (p.owner === team && p.capturer === team) {
        p.control = Math.min(1, p.control + rate);
        continue;
      }
      if (p.capturer !== team) {
        p.control -= rate;
        if (p.control <= 0) {
          const lost = p.owner;
          p.control = 0;
          p.capturer = team;
          if (lost >= 0) {
            p.owner = -1;
            if (lost === this.player.team) {
              this.hud.flash(this.deps.t("fps.point_lost", { name: p.name }));
            }
          }
        }
      } else {
        p.control += rate;
        if (p.control >= 1) {
          p.control = 1;
          p.owner = team;
          if (team === this.player.team) {
            this.hud.flash(this.deps.t("fps.point_captured", { name: p.name }));
            this.audio.capture();
          }
          this.refreshTeams();
        }
      }
    }
  }

  private refreshTeams(): void {
    this.teams.forEach((team, ti) => {
      const owns = this.points.some((p) => p.owner === ti);
      const alive = this.soldiers.some((s) => s.team === ti && s.alive);
      if (!owns && !alive && !team.eliminated) {
        team.eliminated = true;
        this.hud.flash(this.deps.t("fps.nation_fallen", { name: team.name }));
      }
    });
    // Bigger nations field more soldiers: top up squads.
    this.teams.forEach((team, ti) => {
      if (team.eliminated) return;
      const have = this.soldiers.filter(
        (s) => s.team === ti && !s.isPlayer,
      ).length;
      const want = this.squadSize(ti);
      for (let k = have; k < want; k++) {
        const s = this.makeSoldier(ti, `${team.name} ${k + 1}`, false);
        s.respawnAt = this.time + BOT_RESPAWN;
        this.soldiers.push(s);
      }
    });
  }

  private checkEnd(): void {
    if (this.state === "ended") return;
    const mine = this.player.team;
    if (this.points.every((p) => p.owner === mine)) {
      this.end("victory", false);
      return;
    }
    const ownsAny = this.points.some(
      (p) => p.owner === mine || p.capturer === mine,
    );
    if (!this.player.alive && !ownsAny) {
      this.end("defeat", false);
      return;
    }
    if (this.time >= MATCH_TIME) {
      // Time's up: you win only if no other nation holds as many points.
      const held = this.teams.map(
        (_, ti) => this.points.filter((p) => p.owner === ti).length,
      );
      const best = Math.max(...held.filter((_, ti) => ti !== mine));
      this.end(held[mine] > best ? "victory" : "defeat", true);
    }
  }

  private end(result: "victory" | "defeat", timeUp: boolean): void {
    this.state = "ended";
    this.result = result;
    this.mouseDown = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.hud.showEnd(result, timeUp, {
      kills: this.player.kills,
      deaths: this.player.deaths,
      time: this.time,
    });
    if (result === "victory") this.audio.capture();
  }

  // --------------------------------------------------------------- effects

  private addParticle(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    r: number,
    g: number,
    b: number,
    a: number,
    add: boolean,
    grav: number,
  ): void {
    if (this.particles.length > 1500) this.particles.shift();
    this.particles.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      life,
      max: life,
      size: Math.abs(size),
      r,
      g,
      b,
      a,
      add: add || size < 0,
      grav,
    });
  }

  private addTracer(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    g: number,
    b: number,
  ): void {
    if (this.tracers.length > 300) this.tracers.shift();
    this.tracers.push({ ax, ay, az, bx, by, bz, life: 0.07, r, g, b });
  }

  private updateEffects(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.whizCd -= dt;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.grav < 0) p.size += dt * 0.6;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);
  }

  // ---------------------------------------------------------------- drawing

  private box(
    out: "world" | "decal" | "view",
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
    a = 1,
    parent: Float32Array | null = null,
  ): void {
    let arr: Float32Array;
    let count: number;
    if (out === "world") {
      if ((this.boxCount + 1) * BOX_STRIDE > this.boxes.length) return;
      arr = this.boxes;
      count = this.boxCount++;
    } else if (out === "decal") {
      if ((this.decalCount + 1) * BOX_STRIDE > this.decals.length) return;
      arr = this.decals;
      count = this.decalCount++;
    } else {
      if ((this.viewBoxCount + 1) * BOX_STRIDE > this.viewBoxes.length) return;
      arr = this.viewBoxes;
      count = this.viewBoxCount++;
    }
    const o = count * BOX_STRIDE;
    if (parent) {
      trs(this.tmpA, 0, tx, ty, tz, yaw, pitch, roll, sx, sy, sz);
      mulInto(arr, o, parent, this.tmpA);
    } else {
      trs(arr, o, tx, ty, tz, yaw, pitch, roll, sx, sy, sz);
    }
    arr[o + 16] = r;
    arr[o + 17] = g;
    arr[o + 18] = b;
    arr[o + 19] = a;
  }

  private sprite(
    x: number,
    y: number,
    z: number,
    size: number,
    r: number,
    g: number,
    b: number,
    a: number,
    additive: boolean,
  ): void {
    if (this.spriteCount >= 2048) return;
    const o = this.spriteCount * SPRITE_STRIDE;
    this.sprites[o] = x;
    this.sprites[o + 1] = y;
    this.sprites[o + 2] = z;
    this.sprites[o + 3] = additive ? -size : size;
    this.sprites[o + 4] = r;
    this.sprites[o + 5] = g;
    this.sprites[o + 6] = b;
    this.sprites[o + 7] = a;
    this.spriteCount++;
  }

  private drawSoldier(s: Soldier): void {
    const team = this.teams[s.team];
    const [tr, tg, tb] = team.color;
    const dead = !s.alive;
    if (dead && this.time - s.diedAt > 5) return;
    // Body frame: position + yaw (dead soldiers fall over backwards).
    const fall = dead
      ? Math.min(1, (this.time - s.diedAt) * 3) * (Math.PI / 2)
      : 0;
    trs(this.tmpB, 0, s.x, s.y, s.z, s.yaw, fall, 0, 1, 1, 1);
    const P = this.tmpB;
    const swing = dead
      ? 0
      : Math.sin(s.walk) * 0.55 * Math.min(1, Math.hypot(s.vx, s.vz) / 3);
    const dark = 0.55;
    // Legs (pivot at the hip).
    for (const side of [-1, 1]) {
      const sw = swing * side;
      trs(this.tmpA, 0, side * 0.13, 0.86, 0, 0, sw, 0, 1, 1, 1);
      mulInto(this.tmpC, 0, P, this.tmpA);
      this.box(
        "world",
        0,
        -0.43,
        0,
        0,
        0,
        0,
        0.2,
        0.86,
        0.24,
        0.24,
        0.27,
        0.2,
        1,
        this.tmpC,
      );
    }
    // Backpack, belt and boots.
    this.box(
      "world",
      0,
      1.2,
      0.22,
      0,
      0,
      0,
      0.4,
      0.46,
      0.16,
      tr * 0.35,
      tg * 0.35,
      tb * 0.35,
      1,
      P,
    );
    this.box(
      "world",
      0,
      0.88,
      0,
      0,
      0,
      0,
      0.58,
      0.07,
      0.34,
      0.16,
      0.13,
      0.1,
      1,
      P,
    );
    if (!dead) {
      for (const side of [-1, 1]) {
        const sw = swing * side;
        const bz = Math.sin(sw) * 0.86;
        const by = 0.86 - Math.cos(sw) * 0.86;
        this.box(
          "world",
          side * 0.13,
          by + 0.06,
          bz - 0.03,
          0,
          0,
          0,
          0.22,
          0.12,
          0.3,
          0.1,
          0.09,
          0.08,
          1,
          P,
        );
      }
    }
    // Torso, head, helmet.
    this.box(
      "world",
      0,
      1.17,
      0,
      0,
      0,
      0,
      0.56,
      0.66,
      0.32,
      tr * dark,
      tg * dark,
      tb * dark,
      1,
      P,
    );
    this.box(
      "world",
      0,
      1.17,
      -0.17,
      0,
      0,
      0,
      0.46,
      0.5,
      0.04,
      tr,
      tg,
      tb,
      1,
      P,
    );
    this.box(
      "world",
      0,
      1.64,
      0,
      0,
      0,
      0,
      0.28,
      0.3,
      0.28,
      0.86,
      0.68,
      0.55,
      1,
      P,
    );
    this.box("world", 0, 1.81, 0, 0, 0, 0, 0.34, 0.12, 0.36, tr, tg, tb, 1, P);
    // Arms and rifle follow the aim.
    const aim = dead ? 0 : s.pitch;
    trs(this.tmpA, 0, 0, 1.38, 0, 0, aim, 0, 1, 1, 1);
    const shoulders = this.tmpC;
    mulInto(shoulders, 0, P, this.tmpA);
    this.box(
      "world",
      0.3,
      -0.06,
      -0.24,
      0,
      0,
      0,
      0.13,
      0.13,
      0.5,
      tr * dark,
      tg * dark,
      tb * dark,
      1,
      shoulders,
    );
    this.box(
      "world",
      -0.22,
      -0.08,
      -0.3,
      0.35,
      0,
      0,
      0.13,
      0.13,
      0.5,
      tr * dark,
      tg * dark,
      tb * dark,
      1,
      shoulders,
    );
    this.box(
      "world",
      0.08,
      -0.1,
      -0.55,
      0,
      0,
      0,
      0.08,
      0.12,
      0.86,
      0.12,
      0.12,
      0.13,
      1,
      shoulders,
    );
    // Blob shadow.
    if (!dead) {
      this.box(
        "decal",
        s.x,
        this.terrain.heightAt(s.x, s.z) + 0.04,
        s.z,
        0,
        0,
        0,
        0.9,
        0.02,
        0.9,
        0,
        0,
        0,
        0.32,
      );
    }
  }

  private drawViewModel(): void {
    const p = this.player;
    if (!p.alive) return;
    const [tr, tg, tb] = this.teams[p.team].color;
    const speed = Math.min(1, Math.hypot(p.vx, p.vz) / 5);
    const ads = this.adsT;
    const sway = 1 - ads * 0.85;
    const bobX = Math.sin(p.walk) * 0.011 * speed * sway;
    const bobY = Math.abs(Math.cos(p.walk)) * 0.011 * speed * sway;
    const reload =
      p.reloadT > 0 ? Math.sin((1 - p.reloadT / RELOAD_TIME) * Math.PI) : 0;
    const k = this.kick;
    const S = 0.7;
    // Hip position to sights-on-the-crosshair position.
    const gx = 0.13 * (1 - ads) + bobX;
    const gy = -0.13 + (0.13 - S * 0.075) * ads - bobY - reload * 0.14;
    const gz = -0.36 - 0.08 * ads + k * 0.04;
    const pitch = k * 0.05 - reload * 0.35;
    const roll = reload * 0.55;
    trs(this.tmpB, 0, gx, gy, gz, 0.04 * (1 - ads), pitch, roll, S, S, S);
    const G = this.tmpB;
    const v = (
      x: number,
      y: number,
      z: number,
      yaw: number,
      pit: number,
      rol: number,
      sx: number,
      sy: number,
      sz: number,
      r: number,
      g: number,
      b: number,
      a = 1,
    ) => this.box("view", x, y, z, yaw, pit, rol, sx, sy, sz, r, g, b, a, G);
    // Rifle.
    v(0, 0, 0, 0, 0, 0, 0.06, 0.08, 0.36, 0.2, 0.21, 0.22);
    v(0, 0.047, -0.02, 0, 0, 0, 0.04, 0.016, 0.3, 0.1, 0.1, 0.11);
    v(0, 0, -0.27, 0, 0, 0, 0.066, 0.07, 0.2, 0.27, 0.24, 0.2);
    v(0, 0.012, -0.47, 0, 0, 0, 0.024, 0.024, 0.22, 0.07, 0.07, 0.08);
    v(0, 0.012, -0.585, 0, 0, 0, 0.034, 0.034, 0.04, 0.12, 0.12, 0.13);
    v(0, -0.09, -0.06, 0, 0.25, 0, 0.045, 0.13, 0.065, 0.14, 0.14, 0.15);
    v(0, -0.08, 0.1, 0, -0.35, 0, 0.045, 0.1, 0.05, 0.12, 0.12, 0.12);
    // The stock sits against the shoulder, out of view when aiming.
    const hip = ads < 0.55;
    if (hip) v(0, -0.015, 0.27, 0, 0, 0, 0.05, 0.08, 0.18, 0.42, 0.29, 0.17);
    // Sights: a notch (two posts) and a front post; their tops line up on
    // the crosshair when aiming.
    v(-0.013, 0.062, 0.06, 0, 0, 0, 0.01, 0.026, 0.02, 0.05, 0.05, 0.05);
    v(0.013, 0.062, 0.06, 0, 0, 0, 0.01, 0.026, 0.02, 0.05, 0.05, 0.05);
    v(0, 0.052, 0.06, 0, 0, 0, 0.036, 0.006, 0.02, 0.05, 0.05, 0.05);
    v(0, 0.055, -0.36, 0, 0, 0, 0.008, 0.04, 0.008, 0.05, 0.05, 0.05);
    // Hands on the grip and the handguard; forearms run down out of view.
    v(0, -0.085, 0.1, 0, -0.35, 0, 0.062, 0.07, 0.09, 0.86, 0.68, 0.55);
    if (hip)
      v(
        0.02,
        -0.17,
        0.2,
        -0.15,
        0.75,
        0,
        0.08,
        0.08,
        0.26,
        tr * 0.6,
        tg * 0.6,
        tb * 0.6,
      );
    v(-0.005, -0.045, -0.27, 0, 0, 0, 0.075, 0.05, 0.1, 0.86, 0.68, 0.55);
    v(
      -0.1,
      -0.12,
      -0.16,
      0.7,
      0.55,
      0,
      0.08,
      0.08,
      0.28,
      tr * 0.6,
      tg * 0.6,
      tb * 0.6,
    );
    if (k > 0.75) {
      // Muzzle flash: two crossed glowing slabs past the barrel.
      v(0, 0.012, -0.64, 0, 0, 0.785, 0.1, 0.1, 0.06, 1, 0.85, 0.45, 2.9);
      v(0, 0.012, -0.64, 0, 0, 0, 0.15, 0.035, 0.06, 1, 0.95, 0.6, 2.8);
    }
  }

  private draw(): void {
    const p = this.player;
    this.boxCount = 0;
    this.decalCount = 0;
    this.spriteCount = 0;
    this.tracerCount = 0;
    this.viewBoxCount = 0;

    // Camera: the player's eye, or sinking to the ground while dead.
    let camY = this.eyeY(p);
    let camPitch = p.pitch;
    if (!p.alive) {
      const k = Math.min(1, (this.time - p.diedAt) * 1.5);
      camY = p.y + EYE - k * 1.2;
      camPitch = p.pitch * (1 - k) - 0.25 * k;
    }
    const bob =
      p.alive && p.onGround
        ? Math.abs(Math.sin(p.walk)) *
          0.035 *
          Math.min(1, Math.hypot(p.vx, p.vz) / 5)
        : 0;
    // Explosions nearby shake the view.
    const sh = this.shake * this.shake * 0.05;
    const shY = sh ? (this.rng.next() - 0.5) * sh : 0;
    const shYaw = sh ? (this.rng.next() - 0.5) * sh : 0;
    fpsView(
      this.view,
      p.x,
      camY + bob + shY,
      p.z,
      p.yaw + shYaw,
      camPitch + shY,
    );
    const aspect =
      this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    perspective(this.proj, (this.fov * Math.PI) / 180, aspect, 0.1, 1400);
    perspective(this.proj2, (62 * Math.PI) / 180, aspect, 0.01, 10);

    for (const s of this.soldiers) if (!s.isPlayer) this.drawSoldier(s);

    // Flags on the points: height shows control, color the owner.
    for (const pt of this.points) {
      const owner = pt.owner >= 0 ? this.teams[pt.owner].color : NEUTRAL;
      const lift = 1.4 + 6 * pt.control;
      const wave = Math.sin(this.time * 4 + pt.x) * 0.15;
      const color =
        pt.capturer !== pt.owner && pt.capturer >= 0
          ? this.teams[pt.capturer].color
          : owner;
      this.box(
        "world",
        pt.x + 1.15,
        pt.y + lift,
        pt.z,
        wave,
        0,
        0,
        2.2,
        1.3,
        0.06,
        color[0],
        color[1],
        color[2],
      );
    }

    // Markers: a beacon over every point (owner's colour) and a small
    // diamond over each teammate, so friend and foe are easy to tell apart.
    for (const pt of this.points) {
      const c = pt.owner >= 0 ? this.teams[pt.owner].color : NEUTRAL;
      this.sprite(pt.x, pt.y + 10.5, pt.z, 0.75, c[0], c[1], c[2], 0.95, false);
    }
    const mine = this.teams[p.team].color;
    for (const s of this.soldiers) {
      if (!s.alive || s.isPlayer || s.team !== p.team) continue;
      if (Math.hypot(s.x - p.x, s.z - p.z) > (s.peer ? 400 : 140)) continue;
      this.sprite(
        s.x,
        s.y + 2.25,
        s.z,
        0.13,
        mine[0],
        mine[1],
        mine[2],
        0.9,
        true,
      );
    }

    for (const q of this.particles) {
      if (this.spriteCount >= 2048) break;
      const o = this.spriteCount * SPRITE_STRIDE;
      const fade = q.life / q.max;
      this.sprites[o] = q.x;
      this.sprites[o + 1] = q.y;
      this.sprites[o + 2] = q.z;
      this.sprites[o + 3] = q.add ? -q.size : q.size;
      this.sprites[o + 4] = q.r;
      this.sprites[o + 5] = q.g;
      this.sprites[o + 6] = q.b;
      this.sprites[o + 7] = q.a * fade;
      this.spriteCount++;
    }
    for (const t of this.tracers) {
      if (this.tracerCount >= 512) break;
      const o = this.tracerCount * TRACER_STRIDE;
      this.tracerData.set(
        [
          t.ax,
          t.ay,
          t.az,
          t.bx,
          t.by,
          t.bz,
          0.035,
          t.r,
          t.g,
          t.b,
          Math.min(1, t.life / 0.07),
        ],
        o,
      );
      this.tracerCount++;
    }
    for (const g of this.grenadeList) {
      this.box(
        "world",
        g.x,
        g.y,
        g.z,
        g.spin,
        g.spin * 0.7,
        0,
        0.13,
        0.17,
        0.13,
        0.2,
        0.26,
        0.14,
      );
    }
    this.drawViewModel();

    const pts: PointVisual[] = this.points.map((pt) => ({
      x: pt.x,
      z: pt.z,
      radius: pt.radius,
      color: pt.owner >= 0 ? this.teams[pt.owner].color : NEUTRAL,
    }));
    this.renderer.render({
      view: this.view,
      proj: this.proj,
      cam: [p.x, camY, p.z],
      time: this.time,
      points: pts,
      boxes: this.boxes,
      boxCount: this.boxCount,
      decals: this.decals,
      decalCount: this.decalCount,
      sprites: this.sprites,
      spriteCount: this.spriteCount,
      tracers: this.tracerData,
      tracerCount: this.tracerCount,
      viewProj2: this.proj2,
      viewBoxes: this.viewBoxes,
      viewBoxCount: this.viewBoxCount,
    });
    this.hud.update(this.hudState());
  }

  private hudState(): HudState {
    const p = this.player;
    const here = this.points.find(
      (pt) => Math.hypot(pt.x - p.x, pt.z - p.z) <= pt.radius,
    );
    // Who is under the crosshair.
    let aimed: { name: string; css: string; hp: number } | null = null;
    if (p.alive && this.state === "playing") {
      const [dx, dy, dz] = forward(p.yaw, p.pitch);
      const hit = this.traceAny(p.x, this.eyeY(p), p.z, dx, dy, dz);
      if (hit)
        aimed = {
          name: hit.name,
          css: this.teams[hit.team].css,
          hp: Math.max(0, Math.round(hit.hp)),
        };
    }
    const moving = Math.hypot(p.vx, p.vz) / 5.2;
    return {
      time: this.time,
      alive: p.alive,
      hp: Math.max(0, Math.round(p.hp)),
      ammo: p.ammo,
      reserve: Math.floor(p.reserve),
      grenades: p.grenades,
      reloading: p.reloadT > 0,
      team: p.team,
      x: p.x,
      z: p.z,
      yaw: p.yaw,
      respawnIn: p.alive
        ? 0
        : this.points.some((pt) => pt.owner === p.team)
          ? Math.max(0, p.respawnAt - this.time)
          : -1,
      spawnChoice:
        this.preferredSpawn >= 0 &&
        this.points[this.preferredSpawn]?.owner === p.team
          ? this.preferredSpawn
          : -1,
      killedBy: this.killedBy,
      spread: (this.aiming ? 0.2 : 1) * (1 + moving * 1.6) + this.bloom * 30,
      aiming: this.aiming,
      hitMarker: this.hitMarker,
      damage: Math.max(this.damageFlash, p.alive ? (100 - p.hp) / 160 : 0.6),
      points: this.points.map((pt) => ({
        name: pt.name,
        x: pt.x,
        z: pt.z,
        owner: pt.owner,
        capturer: pt.capturer,
        control: pt.control,
        contested: pt.contested,
      })),
      here: here
        ? {
            name: here.name,
            owner: here.owner,
            capturer: here.capturer,
            control: here.control,
            contested: here.contested,
          }
        : null,
      allies: this.soldiers
        .filter((s) => s.alive && !s.isPlayer && s.team === p.team)
        .map((s) => [s.x, s.z] as [number, number]),
      enemiesSeen: this.soldiers
        .filter((s) => s.alive && s.team !== p.team && s.fireCd > -0.5)
        .map((s) => [s.x, s.z, s.team] as [number, number, number]),
      feed: this.feed.filter((f) => this.time - f.at < 6),
      aimed,
      soldiers: this.teams.map((_, ti) => ({
        alive: this.soldiers.filter((s) => s.team === ti && s.alive).length,
        points: this.points.filter((pt) => pt.owner === ti).length,
      })),
      playerKills: p.kills,
      playerDeaths: p.deaths,
      timeLeft: Math.max(0, MATCH_TIME - this.time),
      online: this.net
        ? { room: this.net.room, players: this.net.peers.size + 1 }
        : null,
      humans: this.soldiers
        .filter((s) => s.isPlayer || s.peer)
        .map((s) => ({
          name: this.nameOf(s),
          css: this.teams[s.team].css,
          kills: s.kills,
          deaths: s.deaths,
          me: s.isPlayer,
        })),
    };
  }

  /** Soldier under the crosshair (any team), unobstructed. */
  private traceAny(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
  ): Soldier | null {
    return this.trace(this.player, ox, oy, oz, dx, dy, dz, true).soldier;
  }

  // ----------------------------------------------------------------- online

  /** How a soldier is named on the wire: bots by id, players by -peer. */
  private refOf(s: Soldier): number {
    if (s.isPlayer) return -(this.net?.id ?? 0);
    if (s.peer) return -s.peer;
    return s.id;
  }

  private byRef(ref: number): Soldier | null {
    if (!Number.isFinite(ref) || ref === 0) return null;
    if (ref < 0) {
      if (this.net && -ref === this.net.id) return this.player;
      return this.soldiers.find((s) => s.peer === -ref) ?? null;
    }
    return (
      this.soldiers.find((s) => s.id === ref && !s.isPlayer && !s.peer) ?? null
    );
  }

  private nameOf(s: Soldier): string {
    return s.isPlayer ? this.opts.playerName : s.name;
  }

  private netTick(dt: number): void {
    const net = this.net;
    if (!net || !net.open) return;
    this.netT -= dt;
    if (this.netT <= 0) {
      this.netT = 0.05;
      const p = this.player;
      net.send({
        t: "s",
        n: this.opts.playerName,
        tm: p.team,
        x: round2(p.x),
        y: round2(p.y),
        z: round2(p.z),
        yw: round3(p.yaw),
        pt: round3(p.pitch),
        a: p.alive ? 1 : 0,
        hp: Math.round(p.hp),
        c: p.crouching ? 1 : 0,
        sh: p.shots,
        k: p.kills,
        d: p.deaths,
      });
    }
    if (!net.isHost) return;
    this.snapT -= dt;
    if (this.snapT > 0) return;
    this.snapT = 1 / 12;
    // Bot names go out every two seconds, for players who just joined.
    const named = this.snapN++ % 24 === 0;
    const bots: (number | string)[][] = [];
    for (const b of this.soldiers) {
      if (b.isPlayer || b.peer) continue;
      const e: (number | string)[] = [
        b.id,
        b.team,
        round2(b.x),
        round2(b.y),
        round2(b.z),
        round3(b.yaw),
        round3(b.pitch),
        b.alive ? 1 : 0,
        Math.round(b.hp),
        b.shots,
      ];
      if (named) e.push(b.name);
      bots.push(e);
    }
    net.send({
      t: "w",
      tm: round2(this.time),
      p: this.points.map((pt) => [
        pt.owner,
        pt.capturer,
        Math.round(pt.control * 1000),
        pt.contested ? 1 : 0,
      ]),
      tk: this.teams.map((tm) => tm.kills),
      el: this.teams.map((tm) => (tm.eliminated ? 1 : 0)),
      b: bots,
    });
  }

  private onNet(from: number, m: NetMsg): void {
    if (m.t === "s") this.applyState(from, m);
    else if (m.t === "w") this.applySnapshot(m);
    else if (m.t === "e") this.applyEvent(m, from);
  }

  /** Another player's soldier, as they report it. */
  private applyState(from: number, m: NetMsg): void {
    const team = num(m.tm, -1);
    if (!(team >= 0 && team < this.teams.length)) return;
    const name = String(m.n ?? "").slice(0, 24) || "Player";
    let s = this.soldiers.find((x) => x.peer === from);
    const x = num(m.x, 0);
    const y = num(m.y, 0);
    const z = num(m.z, 0);
    if (!s) {
      s = this.makeSoldier(team, name, false);
      s.peer = from;
      s.fireCd = -10;
      s.x = s.tx = x;
      s.y = s.ty = y;
      s.z = s.tz = z;
      s.seenShots = num(m.sh, 0);
      this.soldiers.push(s);
    }
    s.team = team;
    s.name = name;
    s.tx = x;
    s.ty = y;
    s.tz = z;
    s.tyaw = num(m.yw, s.tyaw);
    s.tpitch = num(m.pt, s.tpitch);
    const alive = m.a === 1;
    if (s.alive && !alive) {
      s.alive = false;
      s.diedAt = this.time;
    } else if (!s.alive && alive) {
      s.alive = true;
      s.x = x;
      s.y = y;
      s.z = z;
    }
    s.hp = num(m.hp, 100);
    s.crouching = m.c === 1;
    s.shots = num(m.sh, s.shots);
    s.kills = num(m.k, 0);
    s.deaths = num(m.d, 0);
  }

  /** The host's view of the battle: points, nations and bots. */
  private applySnapshot(m: NetMsg): void {
    if (this.authority) return;
    const time = num(m.tm, NaN);
    if (Number.isFinite(time)) this.time = time;
    const me = this.player.team;
    if (Array.isArray(m.p)) {
      (m.p as number[][]).forEach((e, i) => {
        const pt = this.points[i];
        if (!pt || !Array.isArray(e)) return;
        const owner = num(e[0], pt.owner);
        if (owner !== pt.owner) {
          if (owner === me) {
            this.hud.flash(
              this.deps.t("fps.point_captured", { name: pt.name }),
            );
            this.audio.capture();
          } else if (pt.owner === me) {
            this.hud.flash(this.deps.t("fps.point_lost", { name: pt.name }));
          }
        }
        pt.owner = owner;
        pt.capturer = num(e[1], pt.capturer);
        pt.control = clamp(num(e[2], 1000) / 1000, 0, 1);
        pt.contested = e[3] === 1;
      });
    }
    if (Array.isArray(m.tk)) {
      (m.tk as number[]).forEach((k, i) => {
        if (this.teams[i]) this.teams[i].kills = num(k, 0);
      });
    }
    if (Array.isArray(m.el)) {
      (m.el as number[]).forEach((e, i) => {
        const team = this.teams[i];
        if (!team) return;
        if (e === 1 && !team.eliminated) {
          this.hud.flash(this.deps.t("fps.nation_fallen", { name: team.name }));
        }
        team.eliminated = e === 1;
      });
    }
    if (!Array.isArray(m.b)) return;
    const seen = new Set<number>();
    for (const e of m.b as (number | string)[][]) {
      if (!Array.isArray(e) || e.length < 10) continue;
      const id = num(e[0], 0);
      const team = num(e[1], -1);
      if (id <= 0 || !(team >= 0 && team < this.teams.length)) continue;
      seen.add(id);
      let b = this.byRef(id);
      const x = num(e[2], 0);
      const y = num(e[3], 0);
      const z = num(e[4], 0);
      const alive = e[7] === 1;
      if (!b) {
        b = this.makeSoldier(team, `${this.teams[team].name}`, false);
        b.id = id;
        b.ghost = true;
        b.fireCd = -10;
        b.x = b.tx = x;
        b.y = b.ty = y;
        b.z = b.tz = z;
        b.alive = alive;
        b.seenShots = num(e[9], 0);
        this.soldiers.push(b);
      }
      b.team = team;
      b.tx = x;
      b.ty = y;
      b.tz = z;
      b.tyaw = num(e[5], b.tyaw);
      b.tpitch = num(e[6], b.tpitch);
      if (b.alive && !alive) {
        b.alive = false;
        b.diedAt = this.time;
      } else if (!b.alive && alive) {
        b.alive = true;
        b.x = x;
        b.y = y;
        b.z = z;
      }
      b.hp = num(e[8], 100);
      b.shots = num(e[9], b.shots);
      if (typeof e[10] === "string") b.name = e[10].slice(0, 40);
    }
    // Bots the host no longer has.
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const b = this.soldiers[i];
      if (b.ghost && !seen.has(b.id)) this.soldiers.splice(i, 1);
    }
  }

  private sendChat(raw: string): void {
    const text = raw.trim().slice(0, 120);
    if (!text || !this.net) return;
    if (this.time - this.lastChat < 0.8) return;
    this.lastChat = this.time;
    this.net.send({ t: "e", k: "chat", m: text });
    const team = this.teams[this.player.team];
    this.hud.addChat(this.opts.playerName, team.css, text, this.time);
  }

  private applyEvent(m: NetMsg, from: number): void {
    switch (m.k) {
      case "chat": {
        if (typeof m.m !== "string") return;
        const who = this.soldiers.find((s) => s.peer === from);
        const name = who?.name ?? this.net?.peers.get(from) ?? "?";
        const css = who ? this.teams[who.team].css : "#ddd";
        this.hud.addChat(name, css, m.m.slice(0, 120), this.time);
        return;
      }
      case "hit": {
        const victim = this.byRef(num(m.v, 0));
        const attacker = this.byRef(num(m.a, 0));
        if (!victim || !attacker) return;
        const ours =
          victim === this.player ||
          (this.authority && !victim.isPlayer && !victim.peer && !victim.ghost);
        if (!ours) return;
        const amount = clamp(num(m.d, 0), 0, 200);
        this.damage(victim, attacker, m.h === 1, amount, m.g === 1);
        return;
      }
      case "kill": {
        const killer = this.byRef(num(m.a, 0));
        const victim = this.byRef(num(m.v, 0));
        if (!killer || !victim) return;
        const head = m.h === 1;
        if ((victim.peer || victim.ghost) && victim.alive) {
          victim.alive = false;
          victim.diedAt = this.time;
        }
        // The host keeps the nations' kill counts for the room.
        if (this.authority) this.teams[killer.team].kills++;
        this.feed.push({
          killer: this.nameOf(killer),
          kc: this.teams[killer.team].css,
          victim: this.nameOf(victim),
          vc: this.teams[victim.team].css,
          head,
          grenade: m.g === 1,
          at: this.time,
        });
        if (this.feed.length > 6) this.feed.shift();
        if (killer === this.player) {
          this.player.kills++;
          this.creditKill(this.nameOf(victim), head);
        }
        return;
      }
      case "nade": {
        const owner = this.byRef(num(m.o, 0));
        const pos = vec3(m.p);
        const vel = vec3(m.v);
        if (!owner || !pos || !vel) return;
        this.grenadeList.push({
          x: pos[0],
          y: pos[1],
          z: pos[2],
          vx: vel[0],
          vy: vel[1],
          vz: vel[2],
          fuse: GRENADE_FUSE,
          spin: 0,
          owner,
        });
        return;
      }
      default:
        return;
    }
  }

  /** Moves a soldier simulated elsewhere toward where it was reported. */
  private follow(s: Soldier, dt: number): void {
    const px = s.x;
    const pz = s.z;
    if (Math.hypot(s.tx - s.x, s.tz - s.z) > 8) {
      s.x = s.tx;
      s.y = s.ty;
      s.z = s.tz;
    } else {
      const k = Math.min(1, dt * 12);
      s.x += (s.tx - s.x) * k;
      s.y += (s.ty - s.y) * k;
      s.z += (s.tz - s.z) * k;
    }
    const k = Math.min(1, dt * 14);
    s.yaw += angleDiff(s.yaw, s.tyaw) * k;
    s.pitch += (s.tpitch - s.pitch) * k;
    s.vx = (s.x - px) / dt;
    s.vz = (s.z - pz) / dt;
    const speed = Math.hypot(s.vx, s.vz);
    if (speed > 0.5) s.walk += dt * speed * 1.6;
    // fireCd counts the time since the last shot (it shows them on the map).
    s.fireCd -= dt;
    if (s.shots > s.seenShots) {
      const n = Math.min(3, s.shots - s.seenShots);
      s.seenShots = s.shots;
      if (s.alive) {
        s.fireCd = 0;
        for (let i = 0; i < n; i++) this.remoteShot(s);
      }
    }
  }

  /** Draws (and sounds) a shot fired by a soldier simulated elsewhere. */
  private remoteShot(s: Soldier): void {
    const eye = this.eyeY(s);
    const [dx, dy, dz] = this.spreadDir(s.yaw, s.pitch, 0.02);
    const hit = this.trace(s, s.x, eye, s.z, dx, dy, dz);
    const [fx, fy, fz] = forward(s.yaw, s.pitch);
    const mx = s.x + fx * 0.85 + Math.cos(s.yaw) * 0.18;
    const my = eye - 0.25 + fy * 0.85;
    const mz = s.z + fz * 0.85 - Math.sin(s.yaw) * 0.18;
    const hx = s.x + dx * hit.t;
    const hy = eye + dy * hit.t;
    const hz = s.z + dz * hit.t;
    this.addTracer(mx, my, mz, hx, hy, hz, 1, 0.75, 0.4);
    this.addParticle(
      mx,
      my,
      mz,
      0,
      0,
      0,
      0.05,
      -0.32,
      1,
      0.8,
      0.4,
      0.9,
      true,
      0,
    );
    if (hit.kind !== "soldier") this.impact(hit, hx, hy, hz);
    const p = this.player;
    const pd = Math.hypot(s.x - p.x, s.z - p.z);
    if (pd < 220) {
      const ang = angleDiff(p.yaw, Math.atan2(-(s.x - p.x), -(s.z - p.z)));
      this.audio.shot(
        clamp(1 - pd / 220, 0, 1) * 0.55,
        clamp(-Math.sin(ang), -1, 1),
        true,
      );
    }
  }

  private removePeer(id: number): void {
    const i = this.soldiers.findIndex((s) => s.peer === id);
    if (i < 0) return;
    const gone = this.soldiers[i];
    this.soldiers.splice(i, 1);
    for (const s of this.soldiers) if (s.enemy === gone) s.enemy = null;
    if (this.killer === gone) this.killer = null;
  }

  /** Someone else runs the bots now: ours become mirrors of theirs. */
  private becomeGuest(): void {
    for (const s of this.soldiers) {
      if (s.isPlayer || s.peer || s.ghost) continue;
      s.ghost = true;
      s.tx = s.x;
      s.ty = s.y;
      s.tz = s.z;
      s.tyaw = s.yaw;
      s.tpitch = s.pitch;
      s.seenShots = s.shots;
    }
  }

  /**
   * A host whose tab goes to the background stops simulating (browsers
   * pause hidden pages), so after a moment it hands the bots to the next
   * player in the room.
   */
  private onVisibility = () => {
    clearTimeout(this.yieldTimer);
    if (!document.hidden) return;
    this.yieldTimer = window.setTimeout(() => {
      const net = this.net;
      if (document.hidden && net && net.isHost && net.peers.size > 0) {
        net.send({ t: "yield" });
      }
    }, 2000);
  };

  /** The host left (or the connection dropped): we run the bots now. */
  private becomeHost(): void {
    let maxId = 0;
    for (const s of this.soldiers) {
      maxId = Math.max(maxId, s.id);
      if (!s.ghost) continue;
      s.ghost = false;
      s.x = s.tx;
      s.y = s.ty;
      s.z = s.tz;
      s.yaw = s.tyaw;
      s.pitch = s.tpitch;
      s.vx = s.vy = s.vz = 0;
      s.onGround = true;
      s.goal = -1;
      s.enemy = null;
      s.thinkT = 0;
      s.ammo = MAG;
      s.reloadT = 0;
      s.fireCd = -10;
      s.grenades = 1;
      s.grenadeCd = 3;
      if (!s.alive) s.respawnAt = this.time + BOT_RESPAWN;
    }
    this.nextId = Math.max(this.nextId, maxId + 1);
    this.snapN = 0;
    this.snapT = 0;
  }

  quit(): void {
    this.dispose();
    this.deps.onExit();
  }

  dispose(): void {
    this.net?.close();
    this.net = null;
    cancelAnimationFrame(this.raf);
    this.unbindInput();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.audio.dispose();
    this.renderer.dispose();
    this.hud.dispose();
    this.canvas.remove();
  }

  // ------------------------------------------------------------ test hooks

  /** For tests: aim the player at a soldier and pull the trigger once. */
  debugShootAt(target: { x: number; y: number; z: number }): void {
    const p = this.player;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const dy = target.y + 1.2 - this.eyeY(p);
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.fireCd = 0;
    p.reloadT = 0;
    if (p.ammo <= 0) p.ammo = MAG;
    this.playerFire();
  }

  /** For tests: hold or release the aim button. */
  debugAim(on: boolean): void {
    this.aiming = on;
  }

  debugInfo(): Record<string, unknown> {
    return {
      state: this.state,
      result: this.result,
      time: this.time,
      soldiers: this.soldiers.filter((s) => s.alive).length,
      points: this.points.map((p) => [
        p.name,
        p.owner,
        p.capturer,
        Number(p.control.toFixed(2)),
      ]),
      player: {
        x: this.player.x,
        y: this.player.y,
        z: this.player.z,
        hp: this.player.hp,
        kills: this.player.kills,
      },
      kills: this.teams.map((t) => t.kills),
    };
  }
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** A finite number from the wire, or the fallback. */
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function vec3(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map((x) => num(x, NaN));
  return out.every(Number.isFinite) ? [out[0], out[1], out[2]] : null;
}

/** Ray (unit d) vs sphere: distance to the first hit, or -1. */
function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  return tca - Math.sqrt(r * r - d2);
}

// Re-exported so the world's box test is reachable from tests via the game.
export { segmentBox };
