// The online FPS mode's connection: a WebSocket to the server's relay
// (src/server/FpsRooms.ts). The relay forwards every message to the rest of
// the room; the first player in a room is its host and runs the bots.

export type NetMsg = Record<string, unknown>;

export interface FpsNetEvents {
  /** Joined the room (the welcome arrived). */
  onWelcome?: () => void;
  /** A message from another player in the room. */
  onMessage?: (from: number, msg: NetMsg) => void;
  onJoin?: (id: number, name: string) => void;
  onLeave?: (id: number) => void;
  /** The room has a new host (the old one left). */
  onHost?: (id: number) => void;
  /** The connection is gone (or never opened); `full` if the room was. */
  onClose?: (full: boolean) => void;
}

export class FpsNet {
  /** Our id in the room (0 until the welcome). */
  id = 0;
  hostId = 0;
  room = "";
  /** The host's battle settings, if the host has started. */
  cfg: unknown = null;
  readonly peers = new Map<number, string>();
  events: FpsNetEvents = {};
  private ws: WebSocket | null;
  private full = false;
  private closed = false;

  constructor(
    url: string,
    room: string,
    readonly name: string,
  ) {
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(url);
    } catch {
      ws = null;
    }
    this.ws = ws;
    if (!ws) {
      setTimeout(() => this.finish(), 0);
      return;
    }
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ t: "hello", room, name }));
    });
    ws.addEventListener("message", (e) => {
      if (typeof e.data === "string") this.receive(e.data);
    });
    ws.addEventListener("close", () => this.finish());
    ws.addEventListener("error", () => this.finish());
  }

  get isHost(): boolean {
    return this.id !== 0 && this.id === this.hostId;
  }

  get open(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  private receive(data: string): void {
    let msg: NetMsg;
    try {
      msg = JSON.parse(data) as NetMsg;
    } catch {
      return;
    }
    if (typeof msg.f === "number" && typeof msg.m === "object" && msg.m) {
      const inner = msg.m as NetMsg;
      if (inner.t === "cfg") this.cfg = inner.cfg ?? null;
      this.events.onMessage?.(msg.f, inner);
      return;
    }
    switch (msg.t) {
      case "welcome": {
        this.id = Number(msg.id) || 0;
        this.hostId = Number(msg.host) || 0;
        this.room = String(msg.room ?? "");
        this.cfg = msg.cfg ?? null;
        const peers = Array.isArray(msg.peers) ? msg.peers : [];
        for (const p of peers as { id: number; name: string }[]) {
          this.peers.set(Number(p.id), String(p.name));
        }
        this.events.onWelcome?.();
        return;
      }
      case "join":
        this.peers.set(Number(msg.id), String(msg.name));
        this.events.onJoin?.(Number(msg.id), String(msg.name));
        return;
      case "leave":
        this.peers.delete(Number(msg.id));
        this.events.onLeave?.(Number(msg.id));
        return;
      case "host":
        this.hostId = Number(msg.id) || 0;
        this.events.onHost?.(this.hostId);
        return;
      case "full":
        this.full = true;
        return;
      default:
        return;
    }
  }

  send(msg: NetMsg): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.events.onClose?.(this.full);
  }

  close(): void {
    this.events = {};
    this.closed = true;
    try {
      this.ws?.close();
    } catch {
      // Already closing.
    }
    this.ws = null;
  }
}
