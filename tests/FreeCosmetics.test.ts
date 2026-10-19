import {
  FREE_COSMETICS,
  withFreeFlares,
} from "@openfront/shared/FreeCosmetics";
import { decodePatternData } from "@openfront/shared/PatternDecoder";
import { base64url } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  cosmeticRelationship,
  crownRelationship,
} from "../src/client/Cosmetics";
import rawCatalog from "../resources/cosmetics/cosmetics.json";
import { PrivilegeCheckerImpl } from "../src/server/Privilege";

// tests/setup.ts mocks the free wildcards away for upstream tests.
vi.unmock("@openfront/shared/FreeCosmetics");

describe("free cosmetics catalog", () => {
  it("has patterns, skins and every kind of effect", () => {
    expect(Object.keys(FREE_COSMETICS.patterns).length).toBeGreaterThan(0);
    expect(Object.keys(FREE_COSMETICS.skins ?? {}).length).toBeGreaterThan(0);
    for (const type of [
      "transportShipTrail",
      "nukeTrail",
      "nukeExplosion",
      "structures",
      "warship",
      "train",
      "railroad",
    ] as const) {
      expect(
        Object.keys(FREE_COSMETICS.effects?.[type] ?? {}).length,
        type,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps every effect when parsing (none silently dropped)", () => {
    const raw = rawCatalog.effects as Record<string, Record<string, unknown>>;
    for (const [type, effects] of Object.entries(raw)) {
      expect(
        Object.keys(
          (FREE_COSMETICS.effects as Record<string, object>)[type] ?? {},
        ),
        type,
      ).toEqual(Object.keys(effects));
    }
  });

  it("only contains valid, free patterns", () => {
    for (const p of Object.values(FREE_COSMETICS.patterns)) {
      expect(() =>
        decodePatternData(p.pattern, base64url.decode),
      ).not.toThrow();
      expect(p.priceSoft).toBeUndefined();
      expect(p.priceHard).toBeUndefined();
    }
  });

  it("lets a player with no flares join with any cosmetic", () => {
    const checker = new PrivilegeCheckerImpl(FREE_COSMETICS, base64url.decode);
    const pattern = Object.values(FREE_COSMETICS.patterns)[0];
    const skin = Object.values(FREE_COSMETICS.skins ?? {})[0];
    const trail = Object.values(FREE_COSMETICS.effects?.nukeTrail ?? {})[0];
    const result = checker.isAllowed(withFreeFlares(undefined), {
      patternName: pattern.name,
      patternColorPaletteName: "chrome",
      skinName: skin.name,
      effects: { nukeTrail: trail.name, atom: "chrome_shockwave_atom" },
    });
    expect(result.type).toBe("allowed");
  });
});

describe("store ownership (everything free)", () => {
  for (const type of ["flag", "pattern", "skin", "crown", "effect"]) {
    it(`treats every ${type} as owned, logged in or not`, () => {
      const opts = {
        wildcardFlare: `${type}:*`,
        requiredFlare: `${type}:cool`,
        priceSoft: 500,
        priceHard: undefined,
        affiliateCode: null,
        itemAffiliateCode: "someone_else",
      };
      expect(cosmeticRelationship(opts, false)).toBe("owned");
    });
  }

  it("treats a crown as owned without any flares", () => {
    expect(
      crownRelationship({ name: "gold", url: "/x.png" } as never, false, null),
    ).toBe("owned");
  });
});
