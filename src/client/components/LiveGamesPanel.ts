import { maps } from "@openfront/engine-api/game/GameTypes";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import type { JoinLobbyModal } from "../JoinLobbyModal";
import { whenModalLoaded } from "../LazyModals";
import { translateText } from "../Utils";

/** One running game, as the worker's /api/live_games reports it. */
export interface LiveGame {
  gameID: string;
  gameMap: string;
  players: number;
  spectators: number;
  startedAt: number;
}

const POLL_MS = 5000;

/**
 * AlexFront: the games running right now, on the side of the main menu. Any
 * of them can be joined as a spectator, and a spectator can then take over a
 * nation from the player panel.
 */
@customElement("live-games-panel")
export class LiveGamesPanel extends LitElement {
  @state() private games: LiveGame[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  disconnectedCallback() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    super.disconnectedCallback();
  }

  private async refresh(): Promise<void> {
    // Nothing to show (or poll for) while a game is on screen.
    if (
      document.hidden ||
      document.documentElement.classList.contains("in-game")
    ) {
      return;
    }
    try {
      const base = ClientEnv.serverHttpBase();
      const workers = Math.max(1, ClientEnv.numWorkers());
      const lists = await Promise.all(
        Array.from({ length: workers }, async (_, i) => {
          const res = await fetch(`${base}/w${i}/api/live_games`);
          if (!res.ok) return [];
          const body = (await res.json()) as { games?: LiveGame[] };
          return Array.isArray(body.games) ? body.games : [];
        }),
      );
      this.games = lists.flat().sort((a, b) => b.startedAt - a.startedAt);
    } catch {
      // Unreachable for now: keep the last list.
    }
  }

  private spectate(game: LiveGame) {
    whenModalLoaded("join-lobby-modal", () =>
      (document.querySelector("join-lobby-modal") as JoinLobbyModal)?.open({
        lobbyId: game.gameID,
        spectate: true,
      }),
    );
  }

  private mapName(gameMap: string): string {
    const key = maps.find((m) => m.type === gameMap)?.translationKey;
    return key ? translateText(key) : gameMap;
  }

  render() {
    return html`
      <div
        data-live-games
        class="rounded-xl border border-white/10 bg-black/40 p-3 backdrop-blur chrome:chrome-panel"
      >
        <h3
          class="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/80"
        >
          <span class="relative flex size-2.5">
            ${this.games.length > 0
              ? html`<span
                  class="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75"
                ></span>`
              : nothing}
            <span
              class="relative inline-flex size-2.5 rounded-full ${this.games
                .length > 0
                ? "bg-red-500"
                : "bg-white/30"}"
            ></span>
          </span>
          ${translateText("main.live_games")}
        </h3>
        ${this.games.length === 0
          ? html`<p class="text-xs text-white/50">
              ${translateText("main.live_games_empty")}
            </p>`
          : html`<ul class="flex flex-col gap-2">
              ${this.games.map((g) => {
                const minutes = Math.max(
                  0,
                  Math.floor((Date.now() - g.startedAt) / 60_000),
                );
                return html`<li
                  class="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5"
                >
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm font-bold text-white">
                      ${this.mapName(g.gameMap)}
                    </div>
                    <div class="text-[11px] text-white/60">
                      ${translateText("main.live_players", {
                        count: g.players,
                      })}
                      · ${translateText("main.live_minutes", { minutes })}
                    </div>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded-md bg-red-500/80 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-white hover:bg-red-500 cursor-pointer"
                    @click=${() => this.spectate(g)}
                  >
                    ${translateText("main.live_watch")}
                  </button>
                </li>`;
              })}
            </ul>`}
      </div>
    `;
  }
}
