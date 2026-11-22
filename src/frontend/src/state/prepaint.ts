import { DEFAULT_THEME, densities, themes } from "../theme/tokens";
import { CONTRAST_CHOICES, DEFAULT_PREFERENCES, PREFERENCE_KEYS, THEME_CHOICES } from "./preferenceSchema";

/**
 * The inline <script> that sets the <html> attributes before the first paint,
 * so the page never flashes the wrong theme. It is generated from
 * the same constants as resolveAttributes() and injected into index.html and
 * mock.html by the Vite config; tests/tooling/prepaint.test.ts proves both
 * produce the same attributes.
 *
 * It must stay plain ES2015 without imports: it runs before any module loads.
 */
export function prepaintScript(): string {
  const config = {
    keys: PREFERENCE_KEYS,
    themeChoices: THEME_CHOICES,
    contrastChoices: CONTRAST_CHOICES,
    densities: Object.keys(densities),
    themes: Object.keys(themes),
    defaultTheme: DEFAULT_THEME,
    defaults: DEFAULT_PREFERENCES,
  };
  return `(function (c) {
  var d = document.documentElement;
  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function pick(list, v, f) { return v !== null && list.indexOf(v) >= 0 ? v : f; }
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var theme = pick(c.themeChoices, get(c.keys.theme), c.defaults.theme);
  var contrast = pick(c.contrastChoices, get(c.keys.contrast), c.defaults.contrast);
  var density = pick(c.densities, get(c.keys.density), c.defaults.density);
  var cvd = get(c.keys.cvd) === "true";
  var wanted = theme === "system" ? (mq("(prefers-color-scheme: dark)") ? "dark" : "light") : theme;
  d.setAttribute("data-theme", theme);
  d.setAttribute("data-resolved-theme", c.themes.indexOf(wanted) >= 0 ? wanted : c.defaultTheme);
  d.setAttribute("data-contrast", contrast);
  d.setAttribute("data-resolved-contrast", contrast === "system" ? (mq("(prefers-contrast: more)") ? "high" : "normal") : contrast);
  d.setAttribute("data-cvd", cvd ? "on" : "off");
  d.setAttribute("data-density", density);
})(${JSON.stringify(config)});`;
}
