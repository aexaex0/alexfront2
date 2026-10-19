import { PlayerInfo, PlayerType } from "@openfront/engine-api/game/GameTypes";
import {
  LAST_WORDS_ODDS,
  lastWordsRoll,
} from "@openfront/engine/game/GameImpl";
import { Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let human: Player;
let nation: Player;

describe("a conquered nation's last words", () => {
  beforeEach(async () => {
    game = await setup("plains", {});
    human = game.addPlayer(
      new PlayerInfo("human", PlayerType.Human, null, "human"),
    );
    nation = game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    );
  });

  test("are rare: about 1 in LAST_WORDS_ODDS conquests", () => {
    let hits = 0;
    const trials = 100_000;
    for (let t = 0; t < trials; t++) {
      if (lastWordsRoll(t, 1 + (t % 7), 2 + (t % 11))) hits++;
    }
    const expected = trials / LAST_WORDS_ODDS;
    expect(hits).toBeGreaterThan(expected * 0.7);
    expect(hits).toBeLessThan(expected * 1.3);
  });

  test("are said to the human conqueror when the roll hits", () => {
    const spy = vi.spyOn(game, "displayChat");
    // Step to a tick where this pair's roll hits.
    for (let i = 0; i < 5000; i++) {
      if (lastWordsRoll(game.ticks(), human.smallID(), nation.smallID())) break;
      game.executeNextTick();
    }
    game.conquerPlayer(human, nation);
    expect(spy).toHaveBeenCalledWith(
      "last_words",
      "secret",
      human.id(),
      human.id(),
      true,
      nation.id(),
    );
  });

  test("are not said on an ordinary conquest", () => {
    const spy = vi.spyOn(game, "displayChat");
    while (lastWordsRoll(game.ticks(), human.smallID(), nation.smallID())) {
      game.executeNextTick();
    }
    game.conquerPlayer(human, nation);
    expect(spy).not.toHaveBeenCalled();
  });
});
