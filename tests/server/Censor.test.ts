import { describe, expect, test } from "vitest";
import { censorPlayer } from "../../src/server/Censor";

describe("censorPlayer (censoring disabled)", () => {
  test("keeps every username unchanged", () => {
    expect(censorPlayer("CoolPlayer", null).username).toBe("CoolPlayer");
    expect(censorPlayer("fuck", null).username).toBe("fuck");
  });

  test("keeps clan tags, upper-cased", () => {
    expect(censorPlayer("Player", "ss").clanTag).toBe("SS");
    expect(censorPlayer("Player", "cool").clanTag).toBe("COOL");
    expect(censorPlayer("Player", null).clanTag).toBeNull();
  });
});
