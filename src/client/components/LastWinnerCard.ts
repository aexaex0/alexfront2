import { maps } from "@openfront/engine-api/game/GameTypes";
import { renderTroops } from "@openfront/engine-lib/Format";
import { assetUrl } from "@openfront/shared/AssetUrls";
import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { ClientEnv } from "../ClientEnv";
import { LastWinner, localWin, newerWinner } from "../LastWinner";
import { normaliseMapKey, translateText } from "../Utils";

const POLL_MS = 15_000;

/**
 * AlexFront: the big card on the main menu (where the quick-play lobby used to
 * be): the map the last winner won on, covered by their territory skin, with
 * their name and troop count.
 */
@customElement("last-winner-card")
export class LastWinnerCard extends LitElement {
  @state() private winner: LastWinner | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.winner = localWin();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), POLL_MS);
  }

  disconnectedCallback() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    super.disconnectedCallback();
  }

  private async refresh(): Promise<void> {
    if (
      document.hidden ||
      document.documentElement.classList.contains("in-game")
    ) {
      return;
    }
    let best: LastWinner | null = localWin();
    try {
      const base = ClientEnv.serverHttpBase();
      const workers = Math.max(1, ClientEnv.numWorkers());
      const found = await Promise.all(
        Array.from({ length: workers }, async (_, i) => {
          const res = await fetch(`${base}/w${i}/api/last_winner`);
          if (!res.ok) return null;
          const body = (await res.json()) as { winner?: LastWinner | null };
          return body.winner ?? null;
        }),
      );
      for (const w of found) best = newerWinner(best, w);
    } catch {
      // Server unreachable: the local solo win (if any) still shows.
    }
    this.winner = best;
  }

  private mapName(gameMap: string): string {
    const key = maps.find((m) => m.type === gameMap)?.translationKey;
    return key ? translateText(key) : gameMap;
  }

  render() {
    const w = this.winner;
    const thumb = w
      ? assetUrl(
          `maps/${encodeURIComponent(normaliseMapKey(w.gameMap))}/thumbnail.webp`,
        )
      : null;
    return html`
      <div
        data-last-winner
        class="relative h-44 sm:h-full min-h-44 w-full overflow-hidden rounded-xl border border-white/15 bg-black/60 shadow-xl"
      >
        ${thumb
          ? html`<div
              class="absolute inset-0 bg-cover bg-center"
              style="background-image:url('${thumb}')"
            ></div>`
          : nothing}
        ${w?.skinUrl
          ? html`<div
              class="absolute inset-0 bg-repeat opacity-45 mix-blend-overlay"
              style="background-image:url('${assetUrl(
                w.skinUrl,
              )}');background-size:72px 72px"
            ></div>`
          : nothing}
        <div
          class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/10"
        ></div>
        <div
          class="relative flex h-full flex-col items-center justify-end gap-1 p-4 text-center text-white"
        >
          ${w
            ? html`
                <span
                  class="rounded-full bg-amber-400/90 px-3 py-0.5 text-[11px] font-black uppercase tracking-widest text-black"
                  >👑 ${translateText("main.last_winner")}</span
                >
                <span
                  class="max-w-full truncate text-3xl font-black drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)] sm:text-4xl"
                  >${w.name}</span
                >
                <span class="text-sm font-bold text-white/85">
                  ${w.troops !== null
                    ? html`🪖
                      ${translateText("main.last_winner_troops", {
                        troops: renderTroops(w.troops),
                      })}
                      · `
                    : nothing}
                  🗺️ ${this.mapName(w.gameMap)}
                </span>
              `
            : html`
                <span class="text-4xl">👑</span>
                <span class="text-lg font-black uppercase tracking-wider">
                  ${translateText("main.last_winner_none")}
                </span>
              `}
        </div>
      </div>
    `;
  }
}
