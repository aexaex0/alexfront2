import { TileRef } from "@openfront/engine-api/game/GameMap";
import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { zPlayerRef, zTile } from "@openfront/engine-lib/snapshot/SnapshotType";
import { z } from "zod";
import { Execution, Game, Player } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";

/**
 * A player marks a tile for their allies and teammates ("ping"). The engine
 * only relays it as an AllyPing update; each client decides who sees it.
 * Finishes inside init, so it is never alive at a tick boundary.
 */
export class AllyPingExecution implements Execution {
  private active = true;

  constructor(
    private player: Player,
    private tile: TileRef,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (!this.player.isAlive() || !mg.isValidRef(this.tile)) return;
    mg.addUpdate({
      type: GameUpdateType.AllyPing,
      playerSmallID: this.player.smallID(),
      tile: this.tile,
    });
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(w: SnapshotWriter): ExecRecord {
    return AllyPingExecutionSnapshot.write({
      active: this.active,
      player: w.player(this.player),
      tile: this.tile,
    });
  }

  restoreSnapshot(s: AllyPingState, r: SnapshotReader): void {
    this.active = s.active;
    this.player = r.player(s.player);
    this.tile = s.tile;
  }
}

const AllyPingStateSchema = z.object({
  active: z.boolean(),
  player: zPlayerRef(),
  tile: zTile(),
});
type AllyPingState = z.infer<typeof AllyPingStateSchema>;

export const AllyPingExecutionSnapshot = execSnapshotType({
  name: "AllyPing",
  version: 1,
  schema: AllyPingStateSchema,
  cls: () => AllyPingExecution,
});
