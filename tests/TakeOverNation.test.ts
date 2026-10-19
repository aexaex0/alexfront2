import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import { TakeOverNationExecution } from "@openfront/engine/execution/TakeOverNationExecution";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let human: Player;
let nation: Player;

describe("a spectator taking over a nation", () => {
  beforeEach(async () => {
    game = await setup("plains", {}, [
      new PlayerInfo("human", PlayerType.Human, "humanClient", "humanId"),
    ]);
    human = game.player("humanId");
    nation = game.addPlayer(
      new PlayerInfo("Nation", PlayerType.Nation, null, "nationId"),
    );
    nation.conquer(game.ref(5, 5));
    human.conquer(game.ref(40, 40));
    while (game.inSpawnPhase()) game.executeNextTick();
  });

  function takeOver(clientID: string, nationID = nation.id()) {
    game.addExecution(new TakeOverNationExecution(clientID, nationID));
    game.executeNextTick();
  }

  test("turns the nation into the spectator's human player", () => {
    takeOver("spectator1");
    expect(nation.type()).toBe(PlayerType.Human);
    expect(nation.clientID()).toBe("spectator1");
    expect(game.playerByClientID("spectator1")).toBe(nation);
    // Same country: name and territory stay.
    expect(nation.name()).toBe("Nation");
    expect(nation.isAlive()).toBe(true);
  });

  test("only the first spectator gets it", () => {
    takeOver("spectator1");
    takeOver("spectator2");
    expect(nation.clientID()).toBe("spectator1");
    expect(game.playerByClientID("spectator2")).toBeNull();
  });

  test("a client that already plays cannot take a nation", () => {
    takeOver("humanClient");
    expect(nation.type()).toBe(PlayerType.Nation);
    expect(nation.clientID()).toBeNull();
  });

  test("a human player cannot be taken over", () => {
    takeOver("spectator1", human.id());
    expect(human.clientID()).toBe("humanClient");
    expect(game.playerByClientID("spectator1")).toBeNull();
  });
});
