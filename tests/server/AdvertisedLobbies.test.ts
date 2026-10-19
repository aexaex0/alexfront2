import { GameType } from "@openfront/engine-api/game/GameTypes";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameManager } from "../../src/server/GameManager";
import {
  mockLogger as harnessLogger,
  startGame,
} from "../util/GameServerHarness";
import { testGameConfig } from "../util/Wire";

const CREATOR = "11111111-1111-4111-8111-111111111111";

describe("GameManager.advertisedLobbies (friends' lobbies on the main menu)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("advertises every private lobby, listed or not, without listing it", () => {
    const gm = new GameManager(harnessLogger());
    const unlisted = gm.createGame("g-unlisted", undefined, CREATOR)!;
    const listed = gm.createGame("g-listed", undefined, CREATOR)!;
    listed.setListed(true);

    expect(
      gm
        .advertisedLobbies()
        .map((g) => g.id)
        .sort(),
    ).toEqual(["g-listed", "g-unlisted"]);
    // Not flagged as listed, so no auto-start deadline applies.
    expect(unlisted.isListed()).toBe(false);
    expect(unlisted.autoStartAt()).toBeUndefined();
  });

  it("leaves out public games and started games", () => {
    const gm = new GameManager(harnessLogger());
    gm.createGame(
      "g-public",
      testGameConfig({ gameType: GameType.Public }),
      undefined,
    );
    const started = gm.createGame("g-started", undefined, CREATOR)!;
    startGame(started);

    expect(gm.advertisedLobbies()).toEqual([]);
  });
});
