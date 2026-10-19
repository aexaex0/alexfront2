/**
 * AlexFront: the last winner shown on the main menu. The server keeps the
 * last multiplayer winner; a solo win is kept in this browser. The card shows
 * whichever is newer.
 */
export interface LastWinner {
  gameMap: string;
  name: string;
  troops: number | null;
  skinUrl: string | null;
  finishedAt: number;
}

const LOCAL_KEY = "alexfront.lastSoloWin";

export function recordLocalWin(w: LastWinner): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(w));
  } catch {
    // Storage full (a big custom skin) or unavailable: skip it.
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...w, skinUrl: null }));
    } catch {
      // Still nothing: the card just shows the server's winner.
    }
  }
}

export function localWin(): LastWinner | null {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const w = JSON.parse(raw) as Partial<LastWinner>;
    if (typeof w.name !== "string" || typeof w.gameMap !== "string") {
      return null;
    }
    return {
      gameMap: w.gameMap,
      name: w.name,
      troops: typeof w.troops === "number" ? w.troops : null,
      skinUrl: typeof w.skinUrl === "string" ? w.skinUrl : null,
      finishedAt: typeof w.finishedAt === "number" ? w.finishedAt : 0,
    };
  } catch {
    return null;
  }
}

/** The newer of two winners (either may be missing). */
export function newerWinner(
  a: LastWinner | null,
  b: LastWinner | null,
): LastWinner | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.finishedAt >= b.finishedAt ? a : b;
}
