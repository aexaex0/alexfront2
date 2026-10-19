// The online FPS relay: rooms, hosts, relaying and limits.

import { FpsConn, FpsRooms, FPS_ROOM_SIZE } from "../src/server/FpsRooms";

class FakeConn implements FpsConn {
  sent: Record<string, unknown>[] = [];
  closed = false;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(): void {
    this.closed = true;
  }
  last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1];
  }
}

function join(rooms: FpsRooms, room = "public", name = "A"): FakeConn {
  const c = new FakeConn();
  rooms.message(c, JSON.stringify({ t: "hello", room, name }));
  return c;
}

describe("FPS rooms", () => {
  test("the first player hosts and later ones get the host's settings", () => {
    const rooms = new FpsRooms();
    const a = join(rooms, "abc", "Alice");
    const welcomeA = a.last();
    expect(welcomeA.t).toBe("welcome");
    expect(welcomeA.room).toBe("ABC");
    expect(welcomeA.host).toBe(welcomeA.id);
    expect(welcomeA.cfg).toBeNull();

    rooms.message(a, JSON.stringify({ t: "cfg", cfg: { map: "Hungary" } }));
    const b = join(rooms, "ABC", "Bob");
    const welcomeB = b.last();
    expect(welcomeB.host).toBe(welcomeA.id);
    expect(welcomeB.cfg).toEqual({ map: "Hungary" });
    expect(welcomeB.peers).toEqual([{ id: welcomeA.id, name: "Alice" }]);
    expect(a.last()).toEqual({ t: "join", id: welcomeB.id, name: "Bob" });
  });

  test("relays state to the rest of the room, or to one member", () => {
    const rooms = new FpsRooms();
    const a = join(rooms);
    const b = join(rooms);
    const c = join(rooms);
    const idA = a.sent[0].id as number;
    const idC = c.sent[0].id as number;
    rooms.message(a, JSON.stringify({ t: "s", x: 1 }));
    expect(b.last()).toEqual({ f: idA, m: { t: "s", x: 1 } });
    expect(c.last()).toEqual({ f: idA, m: { t: "s", x: 1 } });
    const before = b.sent.length;
    rooms.message(a, JSON.stringify({ t: "e", to: idC, k: "hit" }));
    expect(b.sent.length).toBe(before);
    expect(c.last()).toEqual({ f: idA, m: { t: "e", to: idC, k: "hit" } });
  });

  test("only the host sends world snapshots and settings", () => {
    const rooms = new FpsRooms();
    const a = join(rooms);
    const b = join(rooms);
    const before = a.sent.length;
    rooms.message(b, JSON.stringify({ t: "w", bots: [] }));
    rooms.message(b, JSON.stringify({ t: "cfg", cfg: { map: "X" } }));
    expect(a.sent.length).toBe(before);
  });

  test("hands the room to the next player when the host leaves", () => {
    const rooms = new FpsRooms();
    const a = join(rooms);
    const b = join(rooms);
    const c = join(rooms);
    const idB = b.sent[0].id as number;
    rooms.leave(a);
    expect(b.sent.some((m) => m.t === "host" && m.id === idB)).toBe(true);
    expect(c.sent.some((m) => m.t === "leave")).toBe(true);
    rooms.leave(b);
    rooms.leave(c);
    expect(rooms.roomCount).toBe(0);
  });

  test("a host can hand the room on, and only the host", () => {
    const rooms = new FpsRooms();
    const a = join(rooms);
    const b = join(rooms);
    const idA = a.sent[0].id as number;
    const idB = b.sent[0].id as number;
    rooms.message(b, JSON.stringify({ t: "yield" }));
    expect(a.sent.some((m) => m.t === "host")).toBe(false);
    rooms.message(a, JSON.stringify({ t: "yield" }));
    expect(a.last()).toEqual({ t: "host", id: idB });
    rooms.message(b, JSON.stringify({ t: "yield" }));
    expect(b.last()).toEqual({ t: "host", id: idA });
  });

  test("turns away a full room and strangers who skip hello", () => {
    const rooms = new FpsRooms();
    for (let i = 0; i < FPS_ROOM_SIZE; i++) join(rooms, "big");
    const late = join(rooms, "big");
    expect(late.sent[0]).toEqual({ t: "full" });
    expect(late.closed).toBe(true);
    const rude = new FakeConn();
    rooms.message(rude, JSON.stringify({ t: "s" }));
    expect(rude.closed).toBe(true);
  });

  test("drops messages past the rate limit", () => {
    let now = 0;
    const rooms = new FpsRooms(() => now);
    const a = join(rooms);
    const b = join(rooms);
    const start = b.sent.length;
    for (let i = 0; i < 200; i++) rooms.message(a, JSON.stringify({ t: "s" }));
    const relayed = b.sent.length - start;
    expect(relayed).toBeLessThan(200);
    now += 1000;
    rooms.message(a, JSON.stringify({ t: "s" }));
    expect(b.sent.length - start).toBe(relayed + 1);
  });
});
