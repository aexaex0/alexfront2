import { GameUpdateType } from "@openfront/engine-api/game/GameUpdates";
import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { AllyPingExecution } from "@openfront/engine/execution/AllyPingExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let player: Player;

describe("AllyPingExecution", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      new PlayerInfo("pinger", PlayerType.Human, null, "pinger"),
    ]);
    player = game.player("pinger");
    player.conquer(game.ref(5, 5));
    while (game.inSpawnPhase()) game.executeNextTick();
    executeTicks(game, 1);
  });

  test("relays the ping as an AllyPing update and finishes", () => {
    const tile = game.ref(10, 12);
    const exec = new AllyPingExecution(player, tile);
    game.addExecution(exec);
    const updates = game.executeNextTick();
    expect(updates[GameUpdateType.AllyPing]).toEqual([
      {
        type: GameUpdateType.AllyPing,
        playerSmallID: player.smallID(),
        tile,
      },
    ]);
    expect(exec.isActive()).toBe(false);
  });

  test("ignores a tile outside the map", () => {
    const outside = game.width() * game.height() + 5;
    game.addExecution(new AllyPingExecution(player, outside));
    const updates = game.executeNextTick();
    expect(updates[GameUpdateType.AllyPing]).toEqual([]);
  });
});
