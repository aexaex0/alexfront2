// AlexFront: the most recent multiplayer winner on this worker, shown on the
// main menu (map, name, troops and territory skin). In memory only: a restart
// forgets it until the next game ends.

export interface LastWinner {
  gameID: string;
  gameMap: string;
  name: string;
  troops: number | null;
  skinUrl: string | null;
  finishedAt: number;
}

let lastWinner: LastWinner | null = null;

export function setLastWinner(w: LastWinner): void {
  lastWinner = w;
}

export function getLastWinner(): LastWinner | null {
  return lastWinner;
}
