import {
  Cell,
  GameType,
  Nation,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { flattenedEmojiTable, GameConfig } from "@openfront/engine-api/Schemas";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { AllianceRequestExecution } from "@openfront/engine/execution/alliance/AllianceRequestExecution";
import { AttackExecution } from "@openfront/engine/execution/AttackExecution";
import { ConstructionExecution } from "@openfront/engine/execution/ConstructionExecution";
import { DonateGoldExecution } from "@openfront/engine/execution/DonateGoldExecution";
import { DonateTroopsExecution } from "@openfront/engine/execution/DonateTroopExecution";
import { EmojiExecution } from "@openfront/engine/execution/EmojiExecution";
import { NationAllianceBehavior } from "@openfront/engine/execution/nation/NationAllianceBehavior";
import {
  NationChatBehavior,
  REQUEST_RELATION_COST,
} from "@openfront/engine/execution/nation/NationChatBehavior";
import { NationEmojiBehavior } from "@openfront/engine/execution/nation/NationEmojiBehavior";
import { NationStructureBehavior } from "@openfront/engine/execution/nation/NationStructureBehavior";
import { NationWarshipBehavior } from "@openfront/engine/execution/nation/NationWarshipBehavior";
import { NationExecution } from "@openfront/engine/execution/NationExecution";
import { QuickChatExecution } from "@openfront/engine/execution/QuickChatExecution";
import { AiAttackBehavior } from "@openfront/engine/execution/utils/AiAttackBehavior";
import { Execution, Game, Player } from "@openfront/engine/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let human: Player;
let nation: Player;
let enemy: Player;
let chat: NationChatBehavior;
let added: Execution[];

async function setupGame(config: Partial<GameConfig> = {}) {
  game = await setup("big_plains", {
    donateGold: true,
    donateTroops: true,
    instantBuild: true,
    ...config,
  });
  human = game.addPlayer(
    new PlayerInfo("human", PlayerType.Human, null, "human"),
  );
  nation = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
  );
  enemy = game.addPlayer(
    new PlayerInfo("enemy", PlayerType.Human, null, "enemy"),
  );
  // Three vertical stripes: human | nation | enemy.
  game.map().forEachTile((tile) => {
    const x = game.x(tile);
    if (x < 70) human.conquer(tile);
    else if (x < 140) nation.conquer(tile);
    else enemy.conquer(tile);
  });

  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, nation);
  const alliance = new NationAllianceBehavior(random, game, nation, emoji);
  const warship = new NationWarshipBehavior(random, game, nation, emoji);
  const attack = new AiAttackBehavior(
    random,
    game,
    nation,
    0.5,
    0.3,
    0.1,
    alliance,
    emoji,
    warship,
  );
  const structure = new NationStructureBehavior(random, game, nation);
  chat = new NationChatBehavior(
    random,
    game,
    nation,
    0.3,
    emoji,
    alliance,
    attack,
    structure,
  );

  added = [];
  const original = game.addExecution.bind(game);
  vi.spyOn(game, "addExecution").mockImplementation((...execs) => {
    added.push(...execs);
    original(...execs);
  });
}

function ally(a: Player, b: Player) {
  a.createAllianceRequest(b)!.accept();
  // AllianceRequestExecution does this when a real request is accepted.
  a.updateRelation(b, 100);
  b.updateRelation(a, 100);
}

// Enough troops to be well above the nation's reserve.
function strongNation() {
  nation.setTroops(game.config().maxTroops(nation) * 0.9);
}

function addedOf<T>(cls: new (...args: never[]) => T): T[] {
  return added.filter((e): e is Execution & T => e instanceof cls);
}

function emojisSent(): string[] {
  return addedOf(EmojiExecution).map(
    (e) => flattenedEmojiTable[(e as any).emoji],
  );
}

describe("Nation chat: alliance requests", () => {
  beforeEach(() => setupGame());

  test("sends an alliance request to a friendly player who asks", () => {
    nation.updateRelation(human, 60);
    chat.respondToQuickChat(human, "help.alliance", null);

    const requests = addedOf(AllianceRequestExecution);
    expect(requests).toHaveLength(1);
    expect((requests[0] as any).requestor).toBe(nation);
    expect((requests[0] as any).recipientID).toBe(human.id());
  });

  test("declines a hostile player with an emoji", () => {
    nation.updateRelation(human, -80);
    chat.respondToQuickChat(human, "help.alliance", null);

    expect(addedOf(AllianceRequestExecution)).toHaveLength(0);
    expect(emojisSent().length).toBeGreaterThan(0);
  });

  test("ignores alliance requests from an existing ally", () => {
    ally(human, nation);
    chat.respondToQuickChat(human, "help.alliance", null);
    expect(addedOf(AllianceRequestExecution)).toHaveLength(0);
  });
});

describe("Nation chat: help from an ally", () => {
  beforeEach(async () => {
    await setupGame();
    strongNation();
    nation.addGold(1_000_000n);
  });

  test("an ally gets troops", () => {
    ally(human, nation);
    chat.respondToQuickChat(human, "help.troops", null);

    const donations = addedOf(DonateTroopsExecution);
    expect(donations).toHaveLength(1);
    expect((donations[0] as any).recipientID).toBe(human.id());
    expect((donations[0] as any).troops).toBeGreaterThan(0);
  });

  test("an ally gets gold", () => {
    ally(human, nation);
    chat.respondToQuickChat(human, "help.gold", null);

    const donations = addedOf(DonateGoldExecution);
    expect(donations).toHaveLength(1);
    expect((donations[0] as any).gold).toBe(nation.gold() / 4n);
  });

  test("a non-ally gets nothing", () => {
    chat.respondToQuickChat(human, "help.troops", null);
    chat.respondToQuickChat(human, "help.gold", null);
    expect(addedOf(DonateTroopsExecution)).toHaveLength(0);
    expect(addedOf(DonateGoldExecution)).toHaveLength(0);
  });

  test("repeated requests wear out the relation", () => {
    ally(human, nation);
    const relationBefore = (nation as any).relations.get(human);
    chat.respondToQuickChat(human, "help.troops", null);
    expect((nation as any).relations.get(human)).toBe(
      relationBefore + REQUEST_RELATION_COST,
    );
  });

  test("an ally with a worn-out relation still gets help sometimes", () => {
    ally(human, nation);
    // Allied, but no longer friendly.
    nation.updateRelation(human, -200);
    nation.updateRelation(human, 10);
    for (let i = 0; i < 30; i++) {
      chat.respondToQuickChat(human, "help.gold", null);
    }
    const gifts = addedOf(DonateGoldExecution).length;
    expect(gifts).toBeGreaterThan(0);
    expect(gifts).toBeLessThan(30);
  });

  test("an ally's call to attack an enemy is answered", () => {
    ally(human, nation);
    chat.respondToQuickChat(human, "help.help_defend", enemy);

    const attacks = addedOf(AttackExecution);
    expect(attacks).toHaveLength(1);
    expect(attacks[0].targetID()).toBe(enemy.id());
  });

  test("won't attack itself or its friends", () => {
    ally(human, nation);
    ally(nation, enemy);
    chat.respondToQuickChat(human, "attack.attack", nation);
    chat.respondToQuickChat(human, "attack.attack", enemy);
    expect(addedOf(AttackExecution)).toHaveLength(0);
  });
});

describe("Nation chat: no donations in public games", () => {
  test("an ally gets nothing in a public game", async () => {
    await setupGame({ gameType: GameType.Public });
    strongNation();
    nation.addGold(1_000_000n);
    ally(human, nation);

    chat.respondToQuickChat(human, "help.troops", null);
    chat.respondToQuickChat(human, "help.gold", null);
    expect(addedOf(DonateTroopsExecution)).toHaveLength(0);
    expect(addedOf(DonateGoldExecution)).toHaveLength(0);
  });
});

describe("Nation chat: threats", () => {
  beforeEach(() => setupGame());

  test("a stronger nation attacks the player threatening it", () => {
    strongNation();
    human.setTroops(1_000);
    chat.respondToThreat(human);

    const attacks = addedOf(AttackExecution);
    expect(attacks).toHaveLength(1);
    expect(attacks[0].targetID()).toBe(human.id());
  });

  test("a weaker nation fortifies the border instead", () => {
    nation.setTroops(10_000);
    human.setTroops(100_000);
    nation.addGold(10_000_000n);
    chat.respondToThreat(human);

    expect(addedOf(AttackExecution)).toHaveLength(0);
    const builds = addedOf(ConstructionExecution);
    expect(builds).toHaveLength(1);
    expect((builds[0] as any).constructionType).toBe(UnitType.DefensePost);
  });

  test("threats worsen the relation", () => {
    nation.setTroops(10_000);
    human.setTroops(100_000);
    chat.respondToThreat(human);
    expect((nation as any).relations.get(human)).toBe(-30);
  });

  test("a threat from a friend is not taken seriously", () => {
    strongNation();
    human.setTroops(1_000);
    ally(human, nation);
    chat.respondToThreat(human);
    expect(addedOf(AttackExecution)).toHaveLength(0);
    expect(addedOf(ConstructionExecution)).toHaveLength(0);
  });
});

describe("Nation chat: wired into the chat and emoji executions", () => {
  beforeEach(async () => {
    await setupGame();
    game.addExecution(
      new NationExecution(
        "game",
        new Nation(new Cell(100, 100), nation.info()),
      ),
    );
    // Let the nation initialize its behaviors.
    game.executeNextTick();
    game.executeNextTick();
    added.length = 0;
  });

  test("a quick chat alliance request reaches the nation", () => {
    nation.updateRelation(human, 60);
    game.addExecution(
      new QuickChatExecution(human, nation.id(), "help.alliance", undefined),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect(
      addedOf(AllianceRequestExecution).some(
        (e) => (e as any).requestor === nation,
      ),
    ).toBe(true);
  });

  test("a threatening emoji reaches the nation", () => {
    nation.setTroops(10_000);
    human.setTroops(100_000);
    game.addExecution(
      new EmojiExecution(human, nation.id(), flattenedEmojiTable.indexOf("💀")),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect((nation as any).relations.get(human)).toBeLessThan(0);
  });

  test("a harmless emoji does not count as a threat", () => {
    game.addExecution(
      new EmojiExecution(human, nation.id(), flattenedEmojiTable.indexOf("👋")),
    );
    game.executeNextTick();
    game.executeNextTick();

    expect((nation as any).relations.get(human) ?? 0).toBe(0);
  });
});
