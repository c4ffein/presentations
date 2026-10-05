/* theme.js — light or dark, the SAME setting as the rest of the site.
 *
 * The site's ☀︎ / ⏾ button writes a `preferred-theme` cookie (light | dark |
 * default = follow the OS; path=/ and, on *.cafeine.dev, the whole domain),
 * so every deck reads it here and puts data-theme="light" | "dark" on <html>
 * before the first paint — load this script in <head>, before the
 * stylesheets. resources/theme.css paints both themes from that attribute.
 * The OS switching while the page is open follows when the cookie says
 * default; ?theme=dark | light forces one page without touching the cookie
 * (a link, a screenshot). The burger menu (menu.js) toggles it, writing the
 * cookie like the site does.
 *
 * API (window.presentationsTheme): get() = "light" | "dark" (what shows),
 * pref() = the cookie's value or "default", set(pref), toggle(), and a
 * `themechange` event on document with detail = what now shows.
 */
(function () {
  var COOKIE = "preferred-theme", forced = null;
  try { var q = new URLSearchParams(location.search).get("theme"); if (q === "dark" || q === "light") forced = q; } catch (e) {}
  function domain() { var h = location.hostname; return /\.cafeine\.dev$/.test(h) ? ";domain=.cafeine.dev" : ""; }
  function pref() { var m = document.cookie.match(new RegExp("(^| )" + COOKIE + "=([^;]+)")); return m ? m[2] : "default"; }
  function os() { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"; }
  function get() { if (forced) return forced; var p = pref(); return p === "dark" || p === "light" ? p : os(); }
  function apply() {
    document.documentElement.setAttribute("data-theme", get());
    try { document.dispatchEvent(new CustomEvent("themechange", { detail: get() })); } catch (e) {}
  }
  function set(p) { forced = null; document.cookie = COOKIE + "=" + p + domain() + ";path=/;max-age=31536000;SameSite=Lax"; apply(); }
  function toggle() { set(get() === "dark" ? "light" : "dark"); }
  apply();
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    (mq.addEventListener ? mq.addEventListener.bind(mq, "change") : mq.addListener.bind(mq))(function () { if (!forced && pref() === "default") apply(); });
  }
  window.presentationsTheme = { get: get, pref: pref, set: set, toggle: toggle };
})();
