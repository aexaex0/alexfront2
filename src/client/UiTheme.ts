import {
  UI_THEME_KEY,
  USER_SETTINGS_CHANGED_EVENT,
  UiTheme,
  UserSettings,
} from "./UserSettings";

/**
 * AlexFront UI styles. Every styled theme puts `theme-chrome` on <html>, which
 * the `chrome:` Tailwind variant keys off; neon and ember add their own class
 * that swaps the style's CSS variables (styles/core/chrome-theme.css).
 */
export const CHROME_THEME_CLASS = "theme-chrome";

const STYLE_CLASSES: Record<UiTheme, string | null> = {
  default: null,
  chrome: null,
  neon: "theme-neon",
  ember: "theme-ember",
};

/** Fired on globalThis when the setting changes; detail is the new theme. */
export const UI_THEME_CHANGED_EVENT = `${USER_SETTINGS_CHANGED_EVENT}:${UI_THEME_KEY}`;

export function currentUiTheme(): UiTheme {
  return new UserSettings().uiTheme();
}

/**
 * True for any styled theme (chrome, neon, ember). Reads the setting rather
 * than <html>'s class, so components that connect before initUiTheme() runs,
 * or that hear the change event first, agree.
 */
export function isChromeTheme(): boolean {
  return currentUiTheme() !== "default";
}

function applyUiTheme() {
  const theme = currentUiTheme();
  const root = document.documentElement;
  root.classList.toggle(CHROME_THEME_CLASS, theme !== "default");
  for (const [name, cls] of Object.entries(STYLE_CLASSES)) {
    if (cls !== null) root.classList.toggle(cls, name === theme);
  }
}

/** Applies the saved theme and follows later changes to the setting. */
export function initUiTheme() {
  applyUiTheme();
  globalThis.addEventListener(UI_THEME_CHANGED_EVENT, applyUiTheme);
}
