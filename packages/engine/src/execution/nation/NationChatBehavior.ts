import {
  Difficulty,
  GameType,
  PlayerType,
  Relation,
} from "@openfront/engine-api/game/GameTypes";
import { PseudoRandom } from "@openfront/engine-lib/PseudoRandom";
import { Game, Player } from "../../game/Game";
import { AllianceRequestExecution } from "../alliance/AllianceRequestExecution";
import { DonateGoldExecution } from "../DonateGoldExecution";
import { DonateTroopsExecution } from "../DonateTroopExecution";
import { AiAttackBehavior } from "../utils/AiAttackBehavior";
import { NationAllianceBehavior } from "./NationAllianceBehavior";
import {
  EMOJI_ASSIST_ACCEPT,
  EMOJI_ASSIST_RELATION_TOO_LOW,
  EMOJI_ASSIST_TARGET_ALLY,
  EMOJI_ASSIST_TARGET_ME,
  EMOJI_ATTACK,
  EMOJI_CANT_AFFORD,
  EMOJI_CONFUSED,
  EMOJI_DONATION_OK,
  EMOJI_REQUEST_DECLINED,
  EMOJI_SCARED_OF_THREAT,
  NationEmojiBehavior,
} from "./NationEmojiBehavior";
import { NationStructureBehavior } from "./NationStructureBehavior";

// Quick chat keys a nation reacts to. Nations only ever answer with emojis
// and actions, never with chat.
const ALLIANCE_KEYS = ["help.alliance", "greet.trust_me"];
const TROOPS_KEYS = ["help.troops", "help.troops_frontlines"];
const GOLD_KEYS = ["help.gold"];
const ATTACK_TARGET_KEYS = [
  "help.help_defend",
  "defend.defend_from",
  "attack.attack",
  "attack.focus",
  "attack.finish",
];

export const THREAT_EMOJIS = ["😈", "💀", "☢️", "🔥", "💥"];

// Each granted request costs relation, so an ally can't drain a nation.
export const REQUEST_RELATION_COST = -8;
// An ally whose relation has worn thin still gets a smaller gift now and then
// (1 in SOMETIMES_HELP_ODDS) instead of only a yawn.
export const SOMETIMES_HELP_ODDS = 3;
export const SOMETIMES_HELP_SHARE = 0.5;
const THREAT_RELATION_MALUS = -30;
// Share of the troops above the reserve, and of the gold, that is donated.
const TROOP_DONATION_SHARE = 0.5;
const GOLD_DONATION_SHARE = 0.25;
// Attack the threatening player only when clearly stronger.
const THREAT_ATTACK_STRENGTH_RATIO = 1.2;

/**
 * Reacts to quick chat messages and threatening emojis from human players.
 * Holds no state of its own: the nation builds it from its behaviors.
 */
export class NationChatBehavior {
  constructor(
    private random: PseudoRandom,
    private game: Game,
    private player: Player,
    private reserveRatio: number,
    private emojiBehavior: NationEmojiBehavior,
    private allianceBehavior: NationAllianceBehavior,
    private attackBehavior: AiAttackBehavior,
    private structureBehavior: NationStructureBehavior,
  ) {}

  respondToQuickChat(sender: Player, key: string, target: Player | null) {
    if (!this.canRespondTo(sender)) return;

    if (
      ALLIANCE_KEYS.includes(key) ||
      (key === "defend.make_ally" && target === this.player)
    ) {
      this.handleAllianceRequest(sender);
    } else if (TROOPS_KEYS.includes(key)) {
      this.handleTroopsRequest(sender);
    } else if (GOLD_KEYS.includes(key)) {
      this.handleGoldRequest(sender);
    } else if (ATTACK_TARGET_KEYS.includes(key) && target !== null) {
      this.handleAttackRequest(sender, target);
    }
  }

  respondToThreat(sender: Player) {
    if (!this.canRespondTo(sender)) return;

    // A friend making threats is probably joking.
    if (this.player.isFriendly(sender)) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_CONFUSED);
      return;
    }

    this.player.updateRelation(sender, THREAT_RELATION_MALUS);

    if (
      this.player.troops() > sender.troops() * THREAT_ATTACK_STRENGTH_RATIO &&
      this.attackBehavior.sendAttack(sender, true)
    ) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_ATTACK);
      return;
    }

    this.structureBehavior.buildDefensePostFacing(sender);
    this.emojiBehavior.sendEmoji(sender, EMOJI_SCARED_OF_THREAT);
  }

  private canRespondTo(sender: Player): boolean {
    return (
      sender !== this.player &&
      sender.type() === PlayerType.Human &&
      this.player.isAlive() &&
      sender.isAlive()
    );
  }

  private handleAllianceRequest(sender: Player) {
    if (this.game.config().disableAlliances()) return;
    if (this.player.isAlliedWith(sender)) return;
    if (!this.player.canSendAllianceRequest(sender)) return;

    if (!this.allianceBehavior.getAllianceDecision(sender, true)) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_REQUEST_DECLINED);
      return;
    }
    this.game.addExecution(
      new AllianceRequestExecution(this.player, sender.id()),
    );
  }

  private handleTroopsRequest(sender: Player) {
    const share = this.helpShare(sender);
    if (share === 0) return;
    if (!this.player.canDonateTroops(sender)) return;

    const reserve =
      this.game.config().maxTroops(this.player) * this.reserveRatio;
    const troops = Math.floor(
      (this.player.troops() - reserve) * TROOP_DONATION_SHARE * share,
    );
    if (troops < 1) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_CANT_AFFORD);
      return;
    }
    this.game.addExecution(
      new DonateTroopsExecution(this.player, sender.id(), troops),
    );
    if (share === 1) this.player.updateRelation(sender, REQUEST_RELATION_COST);
    this.emojiBehavior.sendEmoji(sender, EMOJI_DONATION_OK);
  }

  private handleGoldRequest(sender: Player) {
    const share = this.helpShare(sender);
    if (share === 0) return;
    if (!this.player.canDonateGold(sender)) return;

    const gold = Math.floor(
      Number(this.player.gold()) * GOLD_DONATION_SHARE * share,
    );
    if (gold < 1) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_CANT_AFFORD);
      return;
    }
    this.game.addExecution(
      new DonateGoldExecution(this.player, sender.id(), gold),
    );
    if (share === 1) this.player.updateRelation(sender, REQUEST_RELATION_COST);
    this.emojiBehavior.sendEmoji(sender, EMOJI_DONATION_OK);
  }

  private handleAttackRequest(sender: Player, target: Player) {
    if (!this.player.isFriendly(sender)) return;
    if (target === this.player) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_ASSIST_TARGET_ME);
      return;
    }
    if (this.player.isFriendly(target)) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_ASSIST_TARGET_ALLY);
      return;
    }
    if (this.relationTooLow(sender)) return;
    if (!target.isAlive() || !this.attackBehavior.sendAttack(target)) return;
    this.player.updateRelation(sender, REQUEST_RELATION_COST);
    this.emojiBehavior.sendEmoji(sender, EMOJI_ASSIST_ACCEPT);
  }

  /**
   * How much of the usual gift a request gets: 1 (full), SOMETIMES_HELP_SHARE
   * (a smaller gift to a friend whose relation has worn thin, now and then)
   * or 0. Troops and gold go only to friendly players, and never in public
   * games (to keep Humans vs Nations balanced).
   */
  private helpShare(sender: Player): number {
    if (!this.player.isFriendly(sender)) return 0;
    if (this.game.config().gameConfig().gameType === GameType.Public) {
      return 0;
    }
    // Easy (dumb) nations don't always get the message.
    if (
      this.game.config().gameConfig().difficulty === Difficulty.Easy &&
      this.random.chance(2)
    ) {
      return 0;
    }
    if (!this.relationTooLow(sender, false)) return 1;
    if (this.random.chance(SOMETIMES_HELP_ODDS)) return SOMETIMES_HELP_SHARE;
    this.emojiBehavior.sendEmoji(sender, EMOJI_ASSIST_RELATION_TOO_LOW);
    return 0;
  }

  /** Allies need a friendly relation, teammates a neutral one. */
  private relationTooLow(sender: Player, complain = true): boolean {
    const required = this.player.isOnSameTeam(sender)
      ? Relation.Neutral
      : Relation.Friendly;
    if (this.player.relation(sender) >= required) return false;
    if (complain) {
      this.emojiBehavior.sendEmoji(sender, EMOJI_ASSIST_RELATION_TOO_LOW);
    }
    return true;
  }
}
