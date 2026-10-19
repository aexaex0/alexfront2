import { GAME_ID_REGEX } from "@openfront/engine-api/Schemas";
import { maps } from "@openfront/engine-api/game/GameTypes";
import {
  dailyChallenge,
  dailyResult,
  formatDailyTime,
  recordDailyAttempt,
  recordDailyWin,
} from "../../src/client/DailyChallenge";

describe("daily challenge", () => {
  beforeEach(() => localStorage.clear());

  it("is the same for everyone on the same day", () => {
    const a = dailyChallenge(new Date(2026, 9, 16, 8, 0));
    const b = dailyChallenge(new Date(2026, 9, 16, 23, 30));
    expect(a).toEqual(b);
    expect(a.day).toBe("2026-10-16");
  });

  it("changes from day to day", () => {
    const ids = new Set(
      Array.from(
        { length: 10 },
        (_, i) => dailyChallenge(new Date(2026, 9, 1 + i)).gameID,
      ),
    );
    expect(ids.size).toBe(10);
  });

  it("uses a valid game id and a real map", () => {
    const d = dailyChallenge(new Date(2026, 9, 16));
    expect(d.gameID).toMatch(GAME_ID_REGEX);
    expect(maps.some((m) => m.type === d.map)).toBe(true);
  });

  it("keeps attempts and the best win time for today's game only", () => {
    const today = dailyChallenge();
    recordDailyAttempt(today.day);
    recordDailyAttempt(today.day);
    expect(recordDailyWin("notDaily1", 100)).toBe(false);
    expect(recordDailyWin(today.gameID, 600)).toBe(true);
    expect(recordDailyWin(today.gameID, 900)).toBe(true);
    expect(dailyResult(today.day)).toEqual({ attempts: 2, bestSeconds: 600 });
  });

  it("formats times as m:ss", () => {
    expect(formatDailyTime(605)).toBe("10:05");
  });
});
