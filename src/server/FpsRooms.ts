// Rooms for the online FPS mode (AlexFront 2). The server only relays: the
// first player in a room is its host and runs the bots and the capture
// points; everybody sends their own soldier's state and events, and the
// relay forwards them to the rest of the room (or to one member, `to`).
//
// Kept free of any socket library so it can be tested on its own; the
// worker wires it to `ws` (WorkerLobbyService).

/** One connected client, as the relay sees it. */
export interface FpsConn {
  send(data: string): void;
  close(): void;
}

interface Member {
  id: number;
  conn: FpsConn;
  name: string;
  room: Room;
  windowStart: number;
  windowCount: number;
}

interface Room {
  code: string;
  members: Member[];
  hostId: number;
  /** The host's battle settings, handed to everyone who joins. */
  cfg: unknown;
}

export const FPS_MAX_MESSAGE = 32 * 1024;
export const FPS_ROOM_SIZE = 12;
/** Messages a client may send per second before the extra are dropped. */
const RATE_LIMIT = 90;

function cleanCode(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  const code = s
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return code || "PUBLIC";
}

function cleanName(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  // Printable characters only, trimmed to a sane length.
  const name = s
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, 24);
  return name || "Player";
}

export class FpsRooms {
  private rooms = new Map<string, Room>();
  private members = new Map<FpsConn, Member>();
  private nextId = 1;

  constructor(private now: () => number = () => Date.now()) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  message(conn: FpsConn, raw: string): void {
    if (raw.length > FPS_MAX_MESSAGE) return;
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null || Array.isArray(msg)) return;
    const m = msg as Record<string, unknown>;
    const member = this.members.get(conn);
    if (!member) {
      if (m.t === "hello") this.hello(conn, m);
      else conn.close();
      return;
    }
    const now = this.now();
    if (now - member.windowStart >= 1000) {
      member.windowStart = now;
      member.windowCount = 0;
    }
    if (++member.windowCount > RATE_LIMIT) return;

    const room = member.room;
    switch (m.t) {
      case "cfg":
        if (member.id !== room.hostId) return;
        room.cfg = m.cfg ?? null;
        this.relay(member, raw, null);
        return;
      case "w":
        // World snapshots only come from the host.
        if (member.id !== room.hostId) return;
        this.relay(member, raw, typeof m.to === "number" ? m.to : null);
        return;
      case "s":
      case "e":
        this.relay(member, raw, typeof m.to === "number" ? m.to : null);
        return;
      default:
        return;
    }
  }

  private hello(conn: FpsConn, m: Record<string, unknown>): void {
    const code = cleanCode(m.room);
    let room = this.rooms.get(code);
    if (room && room.members.length >= FPS_ROOM_SIZE) {
      conn.send(JSON.stringify({ t: "full" }));
      conn.close();
      return;
    }
    if (!room) {
      room = { code, members: [], hostId: 0, cfg: null };
      this.rooms.set(code, room);
    }
    const member: Member = {
      id: this.nextId++,
      conn,
      name: cleanName(m.name),
      room,
      windowStart: this.now(),
      windowCount: 0,
    };
    if (room.members.length === 0) {
      room.hostId = member.id;
      room.cfg = null;
    }
    const peers = room.members.map((p) => ({ id: p.id, name: p.name }));
    room.members.push(member);
    this.members.set(conn, member);
    conn.send(
      JSON.stringify({
        t: "welcome",
        id: member.id,
        room: code,
        host: room.hostId,
        cfg: room.cfg,
        peers,
      }),
    );
    this.broadcast(
      room,
      { t: "join", id: member.id, name: member.name },
      member,
    );
  }

  leave(conn: FpsConn): void {
    const member = this.members.get(conn);
    if (!member) return;
    this.members.delete(conn);
    const room = member.room;
    room.members = room.members.filter((p) => p !== member);
    if (room.members.length === 0) {
      this.rooms.delete(room.code);
      return;
    }
    this.broadcast(room, { t: "leave", id: member.id }, null);
    if (room.hostId === member.id) {
      // The longest-connected player takes over the bots.
      room.hostId = room.members[0].id;
      this.broadcast(room, { t: "host", id: room.hostId }, null);
    }
  }

  /** Forwards a member's message as {f: sender, m: message}. */
  private relay(from: Member, raw: string, to: number | null): void {
    const out = `{"f":${from.id},"m":${raw}}`;
    for (const p of from.room.members) {
      if (p === from) continue;
      if (to !== null && p.id !== to) continue;
      p.conn.send(out);
    }
  }

  private broadcast(room: Room, msg: object, except: Member | null): void {
    const data = JSON.stringify(msg);
    for (const p of room.members) if (p !== except) p.conn.send(data);
  }
}
