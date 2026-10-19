import type { TileRef } from "@openfront/engine-api/game/GameMap";
import { GameEvent } from "@openfront/shared/EventBus";

/** The ally-ping hotkey was pressed (the tile under the cursor gets pinged). */
export class AllyPingKeyEvent implements GameEvent {}

/** Send an ally ping for this tile to the server. */
export class SendAllyPingIntentEvent implements GameEvent {
  constructor(public readonly tile: TileRef) {}
}

/** A ping arrived from the simulation; the view decides whether to show it. */
export class AllyPingReceivedEvent implements GameEvent {
  constructor(
    public readonly tile: TileRef,
    public readonly playerSmallID: number,
  ) {}
}

/** Minimum time between two of your own pings. */
export const ALLY_PING_COOLDOWN_MS = 1500;
