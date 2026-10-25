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

/* The curtain (drawn by resources/theme.css): html.curtain now, before the first paint;
 * html.curtain-open once the fonts the page uses have arrived (and reveal is ready),
 * which slides it away; both classes go once it is gone. Fonts are only requested
 * when laid-out text uses them, so the page is laid out first (a forced layout at
 * DOMContentLoaded) and THEN document.fonts.ready is asked — earlier, it resolves at
 * once with nothing pending. Off for PDF export and the speaker view's copies, and
 * with ?curtain=off. */
(function () {
  var q = location.search;
  if (!document.fonts || /[?&](print-pdf|receiver)\b|[?&]curtain=off\b/.test(q)) return;
  var root = document.documentElement, opened = false;
  root.classList.add("curtain");
  function open() {
    if (opened) return;
    opened = true;
    root.classList.add("curtain-open");
    setTimeout(function () { root.classList.remove("curtain", "curtain-open"); }, 800);
  }
  document.addEventListener("DOMContentLoaded", function () {
    void document.body.offsetWidth; // lay out now: the fonts in use get requested
    document.fonts.ready.then(function () {
      var R = window.Reveal;
      try { if (R && R.isReady && !R.isReady()) { R.on("ready", open); return; } } catch (e) {}
      open();
    }, open);
  });
})();

/* The living-ink field on every deck: resources/field-gpu.js (the writings site's
 * engine) and resources/field.js (which attaches itself to the deck), loaded from
 * here — next to this file — so no deck lists them. In order (async = false), and
 * not at all without WebGPU: the field could not run anyway. */
(function () {
  var me = document.currentScript;
  if (!me || !navigator.gpu) return;
  ["field-gpu.js", "field.js"].forEach(function (f) {
    var s = document.createElement("script");
    s.src = new URL(f, me.src).href;
    s.async = false;
    document.head.appendChild(s);
  });
})();
