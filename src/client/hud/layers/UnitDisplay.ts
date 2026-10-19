import {
  BuildableUnit,
  BuildMenus,
  Gold,
  PlayerBuildableUnitType,
  UnitType,
} from "@openfront/engine-api/game/GameTypes";
import { renderNumber } from "@openfront/engine-lib/Format";
import { EventBus } from "@openfront/shared/EventBus";
import { html, LitElement } from "lit";
import { customElement } from "lit/decorators.js";
import { Controller } from "../../Controller";
import { ToggleStructureEvent } from "../../InputHandler";
import { UIState } from "../../UIState";
import { UserSettings } from "../../UserSettings";
import { translateText } from "../../Utils";
import { GameView } from "../../view";
import {
  atomBombIcon,
  cityIcon,
  defensePostIcon,
  factoryIcon,
  goldCoinIcon,
  hydrogenBombIcon,
  mirvIcon,
  missileSiloIcon,
  portIcon,
  samLauncherIcon,
  warshipIcon,
} from "../HotbarIcons";
import { TutorialHighlight, TutorialHighlightEvent } from "../Tutorial";

@customElement("unit-display")
export class UnitDisplay extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public uiState: UIState;
  private playerBuildables: BuildableUnit[] | null = null;
  private keybinds: Record<string, { value: string; key: string }> = {};
  private _cities = 0;
  private _warships = 0;
  private _factories = 0;
  private _missileSilo = 0;
  private _port = 0;
  private _defensePost = 0;
  private _samLauncher = 0;
  private allDisabled = false;
  private _hoveredUnit: PlayerBuildableUnitType | null = null;
  private tutorialHighlight: PlayerBuildableUnitType | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    const config = this.game.config();
    const userSettings = new UserSettings();

    this.keybinds = userSettings.parsedUserKeybinds();

    this.allDisabled = BuildMenus.types.every((u) => config.isUnitDisabled(u));

    const highlightUnits: Partial<
      Record<TutorialHighlight, PlayerBuildableUnitType>
    > = {
      city: UnitType.City,
      port: UnitType.Port,
      defense_post: UnitType.DefensePost,
      factory: UnitType.Factory,
      warship: UnitType.Warship,
      silo: UnitType.MissileSilo,
      atom: UnitType.AtomBomb,
      hydrogen: UnitType.HydrogenBomb,
      mirv: UnitType.MIRV,
      sam: UnitType.SAMLauncher,
    };
    this.eventBus.on(TutorialHighlightEvent, (e) => {
      this.tutorialHighlight = (e.target && highlightUnits[e.target]) ?? null;
      this.requestUpdate();
    });
    this.requestUpdate();
  }

  private cost(item: UnitType): Gold {
    for (const bu of this.playerBuildables ?? []) {
      if (bu.type === item) {
        return bu.cost;
      }
    }
    return 0n;
  }

  private canBuild(item: UnitType): boolean {
    if (this.game?.config().isUnitDisabled(item)) return false;
    const player = this.game?.myPlayer();
    switch (item) {
      case UnitType.AtomBomb:
      case UnitType.HydrogenBomb:
      case UnitType.MIRV:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.MissileSilo).length ?? 0) > 0
        );
      case UnitType.Warship:
        return (
          this.cost(item) <= (player?.gold() ?? 0n) &&
          (player?.units(UnitType.Port).length ?? 0) > 0
        );
      default:
        return this.cost(item) <= (player?.gold() ?? 0n);
    }
  }

  tick() {
    const player = this.game?.myPlayer();
    if (!player) return;
    player.buildables(undefined, BuildMenus.types).then((buildables) => {
      this.playerBuildables = buildables;
    });
    this._cities = player.totalUnitLevels(UnitType.City);
    this._missileSilo = player.totalUnitLevels(UnitType.MissileSilo);
    this._port = player.totalUnitLevels(UnitType.Port);
    this._defensePost = player.totalUnitLevels(UnitType.DefensePost);
    this._samLauncher = player.totalUnitLevels(UnitType.SAMLauncher);
    this._factories = player.totalUnitLevels(UnitType.Factory);
    this._warships = player.totalUnitLevels(UnitType.Warship);
    this.requestUpdate();
  }

  render() {
    const myPlayer = this.game?.myPlayer();
    if (
      !this.game ||
      !myPlayer ||
      this.game.inSpawnPhase() ||
      !myPlayer.isAlive()
    ) {
      return null;
    }
    if (this.allDisabled) {
      return null;
    }

    const k = (name: string, fallback: string) =>
      this.keybinds[name]?.key ?? fallback;
    const divider = html`<div
      class="mx-0.5 h-8 w-px self-center bg-white/15"
      aria-hidden="true"
    ></div>`;

    return html`
      <div class="border-t border-white/10 px-1 pt-1 pb-0.5 w-full">
        <div class="flex items-end gap-1 w-fit mx-auto">
          ${this.renderUnitItem(
            cityIcon,
            this._cities,
            UnitType.City,
            "city",
            k("buildCity", "1"),
          )}
          ${this.renderUnitItem(
            factoryIcon,
            this._factories,
            UnitType.Factory,
            "factory",
            k("buildFactory", "2"),
          )}
          ${this.renderUnitItem(
            portIcon,
            this._port,
            UnitType.Port,
            "port",
            k("buildPort", "3"),
          )}
          ${this.renderUnitItem(
            defensePostIcon,
            this._defensePost,
            UnitType.DefensePost,
            "defense_post",
            k("buildDefensePost", "4"),
          )}
          ${this.renderUnitItem(
            missileSiloIcon,
            this._missileSilo,
            UnitType.MissileSilo,
            "missile_silo",
            k("buildMissileSilo", "5"),
          )}
          ${this.renderUnitItem(
            samLauncherIcon,
            this._samLauncher,
            UnitType.SAMLauncher,
            "sam_launcher",
            k("buildSamLauncher", "6"),
          )}
          ${divider}
          ${this.renderUnitItem(
            warshipIcon,
            this._warships,
            UnitType.Warship,
            "warship",
            k("buildWarship", "7"),
          )}
          ${divider}
          ${this.renderUnitItem(
            atomBombIcon,
            null,
            UnitType.AtomBomb,
            "atom_bomb",
            k("buildAtomBomb", "8"),
            true,
          )}
          ${this.renderUnitItem(
            hydrogenBombIcon,
            null,
            UnitType.HydrogenBomb,
            "hydrogen_bomb",
            k("buildHydrogenBomb", "9"),
            true,
          )}
          ${this.renderUnitItem(
            mirvIcon,
            null,
            UnitType.MIRV,
            "mirv",
            k("buildMIRV", "0"),
            true,
          )}
        </div>
      </div>
    `;
  }

  private renderUnitItem(
    icon: string,
    number: number | null,
    unitType: PlayerBuildableUnitType,
    structureKey: string,
    hotkey: string,
    nuke = false,
  ) {
    if (this.game.config().isUnitDisabled(unitType)) {
      return html``;
    }
    const selected = this.uiState.ghostStructure === unitType;
    const hovered = this._hoveredUnit === unitType;
    const displayHotkey = hotkey
      .replace("Digit", "")
      .replace("Key", "")
      .toUpperCase();

    return html`
      <div
        class="flex flex-col items-center relative"
        @mouseenter=${() => {
          this._hoveredUnit = unitType;
          this.requestUpdate();
        }}
        @mouseleave=${() => {
          this._hoveredUnit = null;
          this.requestUpdate();
        }}
      >
        ${hovered
          ? html`
              <div
                class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 text-gray-200 text-center w-max text-xs bg-gray-800/90 backdrop-blur-xs rounded-sm p-1 z-[100] shadow-lg pointer-events-none"
              >
                <div class="font-bold text-sm mb-1">
                  ${translateText(
                    "unit_type." + structureKey,
                  )}${` [${displayHotkey}]`}
                </div>
                <div class="p-2">
                  ${translateText("build_menu.desc." + structureKey)}
                </div>
                ${unitType === UnitType.Warship
                  ? html`<div
                      class="mt-1 px-2 py-1 text-[10px] text-cyan-300 border-t border-white/10"
                    >
                      ⇧ ${translateText("build_menu.warship_shift_hint")}
                    </div>`
                  : null}
                <div class="flex items-center justify-center gap-1">
                  <img src=${goldCoinIcon} width="13" height="13" />
                  <span class="text-yellow-300"
                    >${renderNumber(this.cost(unitType))}</span
                  >
                </div>
              </div>
            `
          : null}
        <div
          class="relative flex size-9 sm:size-10 items-center justify-center rounded-lg border cursor-pointer transition-all duration-100 active:scale-95 text-white
             ${selected
            ? "border-sky-400 bg-sky-500/25 shadow-[0_0_10px_rgba(56,189,248,0.55)]"
            : nuke
              ? "border-red-400/30 bg-red-950/30 hover:border-red-300/60 hover:bg-red-900/40"
              : "border-white/15 bg-white/5 hover:border-white/40 hover:bg-white/10"}
             ${this.canBuild(unitType) ? "" : "opacity-40 grayscale"}
             ${this.tutorialHighlight === unitType ? "tutorial-highlight" : ""}"
          @click=${() => {
            if (selected) {
              this.uiState.ghostStructure = null;
            } else if (this.canBuild(unitType)) {
              this.uiState.ghostStructure = unitType;
            }
            this.requestUpdate();
          }}
          @mouseenter=${() => {
            switch (unitType) {
              case UnitType.AtomBomb:
              case UnitType.HydrogenBomb:
                this.eventBus?.emit(
                  new ToggleStructureEvent([
                    UnitType.MissileSilo,
                    UnitType.SAMLauncher,
                  ]),
                );
                break;
              case UnitType.Warship:
                this.eventBus?.emit(new ToggleStructureEvent([UnitType.Port]));
                break;
              default:
                this.eventBus?.emit(new ToggleStructureEvent([unitType]));
            }
          }}
          @mouseleave=${() =>
            this.eventBus?.emit(new ToggleStructureEvent(null))}
        >
          <span
            class="absolute left-0.5 top-0 text-[9px] font-bold leading-tight text-white/50"
            >${displayHotkey}</span
          >
          <img src=${icon} alt=${structureKey} class="size-5 sm:size-6" />
          ${number !== null && number > 0
            ? html`<span
                class="absolute -bottom-1 -right-1 min-w-4 rounded-full bg-zinc-800 px-1 text-center text-[10px] font-bold leading-4 text-white ring-1 ring-white/25"
                >${renderNumber(number)}</span
              >`
            : null}
        </div>
      </div>
    `;
  }
}
