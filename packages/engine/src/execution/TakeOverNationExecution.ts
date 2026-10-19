import { PlayerID, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { ClientID } from "@openfront/engine-api/Schemas";
import { z } from "zod";
import { Execution, Game } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type { ExecRecord } from "../snapshot/SnapshotContext";

/**
 * A spectator (a client with no player of its own) takes control of a living
 * nation and plays on as it. The nation's AI stops (NationExecution sees the
 * player is no longer a Nation) and the client's intents drive it from now
 * on. Finishes inside init, so it is never alive at a tick boundary.
 */
export class TakeOverNationExecution implements Execution {
  private active = true;

  constructor(
    private clientID: ClientID,
    private nationID: PlayerID,
  ) {}

  init(mg: Game, ticks: number): void {
    this.active = false;
    if (mg.inSpawnPhase()) return;
    // Already playing (or already took a nation over).
    if (mg.playerByClientID(this.clientID) !== null) return;
    if (!mg.hasPlayer(this.nationID)) return;
    const nation = mg.player(this.nationID);
    if (nation.type() !== PlayerType.Nation || !nation.isAlive()) return;
    nation.assumeControl(this.clientID);
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  snapshot(): ExecRecord {
    return TakeOverNationExecutionSnapshot.write({
      active: this.active,
      clientID: this.clientID,
      nationID: this.nationID,
    });
  }

  restoreSnapshot(s: TakeOverNationState): void {
    this.active = s.active;
    this.clientID = s.clientID;
    this.nationID = s.nationID;
  }
}

const TakeOverNationStateSchema = z.object({
  active: z.boolean(),
  clientID: z.string(),
  nationID: z.string(),
});
type TakeOverNationState = z.infer<typeof TakeOverNationStateSchema>;

export const TakeOverNationExecutionSnapshot = execSnapshotType({
  name: "TakeOverNation",
  version: 1,
  schema: TakeOverNationStateSchema,
  cls: () => TakeOverNationExecution,
});
