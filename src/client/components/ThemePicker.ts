import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { currentUiTheme, UI_THEME_CHANGED_EVENT } from "../UiTheme";
import { UI_THEMES, UiTheme, UserSettings } from "../UserSettings";
import { translateText } from "../Utils";

/** Two-color swatch per style, shown in the picker. */
const SWATCHES: Record<UiTheme, [string, string]> = {
  default: ["#3b82f6", "#1f2937"],
  chrome: ["#f8f9fb", "#5b6470"],
  neon: ["#22d3ee", "#a855f7"],
  ember: ["#fcd34d", "#7c2d12"],
};

/** The main menu's UI style switcher (top right). */
@customElement("theme-picker")
export class ThemePicker extends LitElement {
  @state() private open = false;
  @state() private theme: UiTheme = currentUiTheme();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    globalThis.addEventListener(UI_THEME_CHANGED_EVENT, this.sync);
    document.addEventListener("pointerdown", this.onOutside);
  }

  disconnectedCallback() {
    globalThis.removeEventListener(UI_THEME_CHANGED_EVENT, this.sync);
    document.removeEventListener("pointerdown", this.onOutside);
    super.disconnectedCallback();
  }

  private sync = () => {
    this.theme = currentUiTheme();
  };

  private onOutside = (e: PointerEvent) => {
    if (this.open && !this.contains(e.target as Node)) this.open = false;
  };

  private pick(theme: UiTheme) {
    new UserSettings().setUiTheme(theme);
    this.theme = theme;
    this.open = false;
  }

  private swatch(theme: UiTheme) {
    const [a, b] = SWATCHES[theme];
    return html`<span
      class="inline-block size-5 shrink-0 rounded-full border border-white/40"
      style="background: linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)"
    ></span>`;
  }

  render() {
    return html`
      <div class="relative">
        <button
          class="flex items-center gap-2 rounded-lg border border-white/15 bg-black/40 px-2 py-1.5 text-white hover:bg-white/10 cursor-pointer chrome:chrome-button-dark"
          aria-haspopup="listbox"
          aria-expanded=${this.open}
          title=${translateText("ui_theme.picker")}
          @click=${() => (this.open = !this.open)}
        >
          ${this.swatch(this.theme)}
          <span
            class="hidden text-xs font-bold uppercase tracking-wider sm:inline"
            >${translateText(`ui_theme.${this.theme}`)}</span
          >
        </button>
        ${this.open
          ? html`<ul
              role="listbox"
              class="absolute right-0 top-full z-[100] mt-2 w-52 overflow-hidden rounded-xl border border-white/15 bg-neutral-900/95 p-1 shadow-xl backdrop-blur chrome:chrome-panel"
            >
              ${UI_THEMES.map(
                (t) =>
                  html`<li>
                    <button
                      role="option"
                      aria-selected=${t === this.theme}
                      data-theme=${t}
                      class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white hover:bg-white/10 cursor-pointer ${t ===
                      this.theme
                        ? "bg-white/15 font-bold"
                        : ""}"
                      @click=${() => this.pick(t)}
                    >
                      ${this.swatch(t)} ${translateText(`ui_theme.${t}`)}
                    </button>
                  </li>`,
              )}
            </ul>`
          : ""}
      </div>
    `;
  }
}
