/* menu.js — reveal.js plugin: a burger menu at the top left of every deck.
 *
 * It appears when the mouse moves (anywhere on the page) and fades out
 * `hideDelay` ms after the last movement, unless it is open or hovered; `key`
 * (M) opens / closes it too, Esc or a click outside closes it. Items:
 *   - Narration, when resources/narration.js is in the deck with a base:
 *     turn it on, play / pause, auto mode, the pause between slides, the panel
 *   - Languages…: a floating window with three tabs — Interface, Slides, Audio —
 *     each an ordered list of the viewer's preferred languages. The interface
 *     list is `presentations.langs` in localStorage (shared by every deck on the
 *     site); slides and audio follow it unless the viewer unticks "same as the
 *     interface" on their tab, which gives them their own list
 *     (`presentations.langs.slides` / `.audio`). Each deck then picks, per
 *     channel, the first preferred language it has, falling back to its own
 *     first one; the interface falls back to the browser's language. Slide
 *     languages are `lang-<code>` classes in the deck (<h2 class="lang-en">…,
 *     <h2 class="lang-fr">…): the plugin shows the chosen one and hides the
 *     others. narration.js reads the audio list and translates its panel the
 *     same way (a DIY system: a table per plugin, t(key), one storage convention).
 *   - Help (also `?`): a floating window with the keys, in the viewer's language
 *   - Back to the list of talks: a link to `index`, relative to the deck's URL
 *     (every deck is at <site>/slides/<name>.html, so "../" is the site's index
 *     wherever the site is served from)
 * The windows float (no backdrop): the keys keep driving the deck, they drag
 * by their header, remember their place, Esc or ✕ closes them.
 *
 * In the deck:
 *   <link rel="stylesheet" href="../resources/menu.css">
 *   <script src="../resources/menu.js"></script>
 *   Reveal.initialize({
 *     menu: {
 *       hideDelay: 3000,      // ms without mouse movement before the burger fades
 *       slideLangs: null,     // e.g. ["fr", "en"], first = default; null = detect the lang-* classes
 *       langs: ["fr", "en"],  // languages offered in the window besides those the deck has
 *       index: "../",         // the list of talks, relative to the deck's URL; null = no item
 *       key: "M"              // null = no key
 *     },
 *     plugins: [ …, RevealNarration, RevealMenu ]   // after narration, if present
 *   });
 *
 * API (deck.getPlugin("menu")): open(), close(), toggle(), openWindow("langs" | "help"),
 * closeWindow(id), prefs(channel?), setPrefs(list, channel?), follow(channel, bool),
 * slideLang(), state().
 */
(function () {
  var PREFS_KEY = "presentations.langs", WIN_KEY = "menu.win.", UI = ["fr", "en"];
  var CHANNELS = ["interface", "slides", "audio"], KEYS = { interface: PREFS_KEY, slides: PREFS_KEY + ".slides", audio: PREFS_KEY + ".audio" };
  var NAMES = { fr: "Français", en: "English", de: "Deutsch", es: "Español", it: "Italiano", pt: "Português", nl: "Nederlands" };
  var GAPS = [0, 1000, 2000, 3000, 5000];
  var T = {
    fr: { listen: "Écouter la narration", play: "Lecture", pause: "Pause", auto: "Mode auto (enchaîner les slides)",
          gap: "Pause entre les slides", panel: "Panneau de narration", noNar: "Pas de narration pour ce deck",
          langs: "Langues…", help: "Aide (touches)", prefs: "Langues préférées, dans l'ordre", thisDeck: "Ce deck",
          slides: "slides", audio: "audio", none: "une seule langue", up: "monter", down: "descendre", close: "Fermer",
          on: "oui", off: "non", keys: "Raccourcis clavier",
          kNext: "Slide suivante, dans l'ordre de lecture : les fragments, puis vers le bas, puis la section suivante",
          kPrev: "Slide précédente, dans l'ordre de lecture", kRight: "Section suivante (à droite)", kLeft: "Section précédente (à gauche)",
          kDown: "Slide suivante dans la section (vers le bas)", kUp: "Slide précédente dans la section (vers le haut)",
          kNoFrag: "Idem, sans s'arrêter aux fragments", kEnds: "Première / dernière section", kOverview: "Vue d'ensemble",
          kFull: "Plein écran", kNotes: "Notes de l'orateur", kPause: "Pause (écran noir)", kGoto: "Aller à une slide",
          kMenu: "Menu", kNar: "Narration : l'activer, puis afficher / masquer le panneau", kHelp: "Cette aide",
          kEsc: "Fermer une fenêtre, sinon vue d'ensemble", space: "Espace", shift: "Maj", arrows: "flèches",
          index: "Retour à la liste des présentations", interface: "Interface", slidesTab: "Slides", audioTab: "Audio",
          follow: "Comme l'interface", chosen: "Choisi", available: "disponible" },
    en: { listen: "Listen to the narration", play: "Play", pause: "Pause", auto: "Auto mode (advance the slides)",
          gap: "Pause between slides", panel: "Narration panel", noNar: "No narration for this deck",
          langs: "Languages…", help: "Help (keys)", prefs: "Preferred languages, in order", thisDeck: "This deck",
          slides: "slides", audio: "audio", none: "one language only", up: "move up", down: "move down", close: "Close",
          on: "on", off: "off", keys: "Keyboard shortcuts",
          kNext: "Next slide, in reading order: the fragments, then down, then the next section",
          kPrev: "Previous slide, in reading order", kRight: "Next section (right)", kLeft: "Previous section (left)",
          kDown: "Next slide within the section (down)", kUp: "Previous slide within the section (up)",
          kNoFrag: "Same, without stopping at fragments", kEnds: "First / last section", kOverview: "Slide overview",
          kFull: "Fullscreen", kNotes: "Speaker notes", kPause: "Pause (black screen)", kGoto: "Jump to a slide",
          kMenu: "Menu", kNar: "Narration: turn it on, then show / hide the panel", kHelp: "This help",
          kEsc: "Close a window, else slide overview", space: "Space", shift: "Shift", arrows: "arrows",
          index: "Back to the list of talks", interface: "Interface", slidesTab: "Slides", audioTab: "Audio",
          follow: "Same as the interface", chosen: "Chosen", available: "available" }
  };

  function readList(key) {   // null = not stored
    try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }) : null; }
    catch (e) { return null; }
  }
  function readPrefs(channel) {   // the list a channel follows: its own if stored, else the interface's
    var own = channel && channel !== "interface" ? readList(KEYS[channel]) : null;
    return own || readList(PREFS_KEY) || [];
  }
  function follows(channel) { return channel === "interface" || readList(KEYS[channel]) == null; }
  function writePrefs(list, channel) { try { localStorage.setItem(KEYS[channel || "interface"], JSON.stringify(list)); } catch (e) {} }
  function browserLangs() { return ((navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""])).map(function (l) { return String(l).slice(0, 2).toLowerCase(); }); }
  function uiLang() { var main = readPrefs(); return best(UI, main.length ? main : browserLangs()); }
  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function best(available, prefs) {
    for (var i = 0; i < prefs.length; i++) if (available.indexOf(prefs[i]) >= 0) return prefs[i];
    return available[0] || null;
  }
  function name(code) { return NAMES[code] || code; }
  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }
  function each(list, f) { Array.prototype.forEach.call(list, f); }

  function RevealMenu() {
    var deck, cfg, slideLangs = [], ui = null, wins = {}, order = [], zTop = 1002, hideTimer = null, hover = false, isOpen = false;

    function t(k) { return (T[uiLang()] || T.fr)[k]; }
    function nar() { var p = deck.getPlugin && deck.getPlugin("narration"); return p && p.state ? p : null; }
    function narState() { var n = nar(); return n ? n.state() : null; }

    function init(d) {
      deck = d;
      cfg = Object.assign({ hideDelay: 3000, slideLangs: null, langs: ["fr", "en"], key: "M", index: "../" }, deck.getConfig().menu || {});
      slideLangs = cfg.slideLangs || detectSlideLangs();
      applyLangs();
      build();
      // A move without movement is the browser's own (Chromium fires one at
      // (0,0) when a page loads), not the viewer reaching for the mouse.
      document.addEventListener("pointermove", function (e) { if (e.movementX || e.movementY) wake(); });
      document.addEventListener("touchstart", wake, { passive: true });
      document.addEventListener("click", function (e) { if (isOpen && !ui.root.contains(e.target)) close(); });
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("storage", function (e) { if (e.key && e.key.indexOf(PREFS_KEY) === 0) applyLangs(); });   // another browser tab changed it
      if (cfg.key) {
        var k = String(cfg.key).toUpperCase();
        deck.addKeyBinding({ keyCode: k.charCodeAt(0), key: k, description: "Menu" }, toggle);
      }
      deck.addKeyBinding({ keyCode: 191, key: "?", description: "Help" }, function () { toggleWindow("help"); });   // replaces reveal's overlay
    }

    // ---- languages ----
    function langClasses(el) { var out = []; each(el.classList, function (c) { var m = /^lang-([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)?)$/.exec(c); if (m) out.push(m[1]); }); return out; }
    function langEls() { return deck.getSlidesElement().querySelectorAll('[class*="lang-"]'); }
    function detectSlideLangs() {
      var seen = [];
      each(langEls(), function (el) { langClasses(el).forEach(function (c) { if (seen.indexOf(c) < 0) seen.push(c); }); });
      return seen;
    }
    function slideLang() { return slideLangs.length ? best(slideLangs, readPrefs("slides")) : null; }
    function audioLang() { var ns = narState(); return ns && ns.enabled && ns.langs.length ? best(ns.langs, readPrefs("audio")) : null; }
    function applyLangs() {
      var l = slideLang();
      if (l) each(langEls(), function (el) { var mine = langClasses(el); if (mine.length) el.style.display = mine.indexOf(l) >= 0 ? "" : "none"; });
      var n = nar(), ns = narState(), a = audioLang();
      if (ns && ns.active && a && a !== ns.lang) n.setLang(a);   // programmatic: does not reorder the list
      if (ui && isOpen) render();
      order.forEach(renderWindow);
    }
    function setPrefs(list, channel) { writePrefs(list, channel); applyLangs(); }
    function follow(channel, on) {   // on = drop the channel's own list; off = start one from what it follows today
      try { if (on) localStorage.removeItem(KEYS[channel]); else writePrefs(readPrefs(channel), channel); } catch (e) {}
      applyLangs();
    }

    // ---- the burger and its panel ----
    function build() {
      var root = h("div", "menu-root");
      var burger = h("button", "menu-burger"); burger.setAttribute("aria-label", "Menu"); burger.title = "Menu (" + (cfg.key || "") + ")";
      burger.appendChild(h("span")); burger.appendChild(h("span")); burger.appendChild(h("span"));
      burger.addEventListener("click", function (e) { e.stopPropagation(); toggle(); });
      var panel = h("div", "menu-panel menu-hidden");
      root.appendChild(burger); root.appendChild(panel);
      root.addEventListener("mouseenter", function () { hover = true; wake(); });
      root.addEventListener("mouseleave", function () { hover = false; wake(); });
      root.addEventListener("focusin", function (e) { if (e.target.blur) e.target.blur(); });   // keys stay the deck's
      document.body.appendChild(root);
      ui = { root: root, burger: burger, panel: panel };
    }
    function wake() {
      document.body.classList.add("menu-awake");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { if (!isOpen && !hover) document.body.classList.remove("menu-awake"); }, cfg.hideDelay);
    }
    function open() { if (!ui) return; isOpen = true; ui.panel.classList.remove("menu-hidden"); document.body.classList.add("menu-open"); render(); wake(); }
    function close() { if (!ui) return; isOpen = false; ui.panel.classList.add("menu-hidden"); document.body.classList.remove("menu-open"); wake(); }
    function toggle() { if (isOpen) close(); else open(); }

    function item(label, onClick, opts) {
      opts = opts || {};
      var b = h("button", "menu-item"); b.appendChild(h("span", "menu-label", label));
      if (opts.key) b.appendChild(h("span", "menu-key", opts.key));
      if (opts.disabled) b.disabled = true;
      b.addEventListener("click", function (e) { e.stopPropagation(); onClick(); });
      return b;
    }
    function summary() {
      var parts = [], s = slideLang(), a = audioLang();
      if (s) parts.push(t("slides") + " " + s);
      if (a) parts.push(t("audio") + " " + a);
      return parts.length ? "(" + parts.join(" · ") + ")" : "";
    }
    function render() {
      var p = ui.panel, n = nar(), ns = narState();
      p.textContent = "";
      if (!ns || !ns.enabled) p.appendChild(item(t("noNar"), function () {}, { disabled: true }));
      else if (!ns.active) p.appendChild(item(t("listen"), function () { n.activate(); n.togglePanel(true); close(); }, { key: "N" }));
      else {
        p.appendChild(item((ns.paused ? "▶ " : "‖ ") + (ns.paused ? t("play") : t("pause")), function () { n.toggle(); render(); }));
        p.appendChild(item(t("auto") + " : " + (ns.auto ? t("on") : t("off")), function () { n.setAuto(!ns.auto); render(); }));
        p.appendChild(item(t("gap") + " : " + (ns.gap / 1000) + " s", function () { n.setGap(GAPS[(GAPS.indexOf(ns.gap) + 1) % GAPS.length]); render(); }));
        p.appendChild(item(t("panel") + " : " + (ns.panelHidden ? t("off") : t("on")), function () { n.togglePanel(); render(); }, { key: "N" }));
      }
      p.appendChild(h("hr", "menu-sep"));
      p.appendChild(item(t("langs") + " " + summary(), function () { close(); openWindow("langs"); }));
      p.appendChild(item(t("help"), function () { close(); openWindow("help"); }, { key: "?" }));
      if (cfg.index) {   // a real link (middle-click, "open in a new tab" work), resolved against the deck's URL
        var a = h("a", "menu-item menu-index"); a.href = new URL(cfg.index, location.href).href; a.appendChild(h("span", "menu-label", "← " + t("index")));
        p.appendChild(h("hr", "menu-sep")); p.appendChild(a);
      }
    }

    // ---- floating windows: draggable by the header, place remembered, Esc / ✕ closes ----
    var DEFAULTS = { langs: { left: 28, top: 84 }, help: { left: 28, top: 84 } };
    function openWindow(id) {
      if (wins[id]) { front(wins[id]); return; }
      var win = h("div", "menu-win"), head = h("div", "menu-win-head"), body = h("div", "menu-win-body");
      win.setAttribute("data-win", id);
      var title = h("span", "menu-win-title"), x = h("button", "menu-close", "✕");
      x.addEventListener("click", function () { closeWindow(id); });
      head.appendChild(title); head.appendChild(x); win.appendChild(head); win.appendChild(body);
      win.addEventListener("focusin", function (e) { if (e.target.blur) e.target.blur(); });
      win.addEventListener("pointerdown", function () { front(win); });
      drag(win, head, id);
      document.body.appendChild(win);
      wins[id] = { el: win, title: title, body: body, head: head };
      order.push(id);
      var saved = load(WIN_KEY + id), at = saved && saved.left != null ? saved : DEFAULTS[id];
      // A second window at the same default spot goes a little further, so both show.
      if (!saved && order.length > 1) at = { left: at.left + 40, top: at.top + 40 };
      place(win, at.left, at.top);
      front(win);
      renderWindow(id);
    }
    function closeWindow(id) {
      var w = wins[id]; if (!w) return;
      w.el.parentNode.removeChild(w.el); delete wins[id]; order.splice(order.indexOf(id), 1);
    }
    function toggleWindow(id) { if (wins[id]) closeWindow(id); else openWindow(id); }
    function front(win) { win.style.zIndex = ++zTop; }
    function place(win, x, y) {
      var w = win.offsetWidth, hh = win.offsetHeight;
      x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)); y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - hh));
      win.style.left = x + "px"; win.style.top = y + "px";
    }
    function drag(win, head, id) {
      var d = null;
      head.addEventListener("pointerdown", function (e) {
        if (e.target.tagName === "BUTTON") return;
        var r = win.getBoundingClientRect();
        d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture(e.pointerId); e.preventDefault();
      });
      head.addEventListener("pointermove", function (e) { if (d) place(win, e.clientX - d.dx, e.clientY - d.dy); });
      head.addEventListener("pointerup", function (e) {
        if (!d) return; d = null; head.releasePointerCapture(e.pointerId);
        var r = win.getBoundingClientRect(); store(WIN_KEY + id, { left: r.left, top: r.top });
      });
    }
    function renderWindow(id) {
      var w = wins[id]; if (!w) return;
      w.body.textContent = "";
      if (id === "langs") { w.title.textContent = t("prefs"); renderLangs(w.body); }
      else { w.title.textContent = t("keys"); renderHelp(w.body); }
    }

    var tab = "interface";
    function known(channel) {
      var all = [];
      [readPrefs(channel), UI, cfg.langs, slideLangs, (narState() || {}).langs || []].forEach(function (l) { l.forEach(function (c) { if (all.indexOf(c) < 0) all.push(c); }); });
      return all;
    }
    function move(list, i, d) { var j = i + d, c = list.slice(); if (j < 0 || j >= c.length) return c; c[i] = list[j]; c[j] = list[i]; return c; }
    function renderLangs(body) {
      var tabs = h("div", "menu-tabs");
      CHANNELS.forEach(function (c) {
        var b = h("button", "menu-tab" + (c === tab ? " menu-tab-on" : ""), t(c === "interface" ? "interface" : c === "slides" ? "slidesTab" : "audioTab"));
        b.setAttribute("data-tab", c); b.addEventListener("click", function () { tab = c; renderWindow("langs"); });
        tabs.appendChild(b);
      });
      body.appendChild(tabs);
      var following = follows(tab);
      if (tab !== "interface") {
        var lbl = h("label", "menu-follow"), box = h("input"); box.type = "checkbox"; box.className = "menu-follow-box"; box.checked = following;
        box.addEventListener("change", function () { follow(tab, box.checked); });
        lbl.appendChild(box); lbl.appendChild(document.createTextNode(t("follow"))); body.appendChild(lbl);
      }
      var list = known(tab), ol = h("ol", "menu-langs" + (following && tab !== "interface" ? " menu-langs-follow" : ""));
      list.forEach(function (code, i) {
        var li = h("li", "menu-lang"); li.setAttribute("data-lang", code);
        li.appendChild(h("span", "menu-lang-name", name(code))); li.appendChild(h("span", "menu-lang-code", code));
        var up = h("button", "menu-up", "▲"), down = h("button", "menu-down", "▼");
        up.disabled = i === 0 || following && tab !== "interface"; down.disabled = i === list.length - 1 || following && tab !== "interface";
        up.title = t("up"); down.title = t("down");
        up.addEventListener("click", function () { setPrefs(move(list, i, -1), tab); });
        down.addEventListener("click", function () { setPrefs(move(list, i, 1), tab); });
        li.appendChild(up); li.appendChild(down); ol.appendChild(li);
      });
      body.appendChild(ol);
      var ns = narState(), foot;
      if (tab === "interface") foot = t("chosen") + " : " + name(uiLang()) + " (" + t("available") + " : " + UI.join(", ") + ")";
      else if (tab === "slides") foot = t("thisDeck") + " — " + (slideLang() ? t("chosen") + " : " + name(slideLang()) + " (" + t("available") + " : " + slideLangs.join(", ") + ")" : t("none"));
      else foot = t("thisDeck") + " — " + (ns && ns.enabled && ns.langs.length ? t("chosen") + " : " + name(audioLang()) + " (" + t("available") + " : " + ns.langs.join(", ") + ")" : t("noNar"));
      body.appendChild(h("div", "menu-win-foot", foot));
    }
    function renderHelp(body) {
      var ns = narState(), narOn = !!(ns && ns.enabled), ar = t("arrows");
      var rows = [
        [t("space") + (narOn ? "" : "  N"), t("kNext")],
        [t("shift") + " + " + t("space") + "  P", t("kPrev")],
        ["→  L", t("kRight")],
        ["←  H", t("kLeft")],
        ["↓  J", t("kDown")],
        ["↑  K", t("kUp")],
        ["Alt + " + ar, t("kNoFrag")],
        [t("shift") + " + ←  →", t("kEnds")],
        ["Esc  O", t("kEsc")],
        ["F", t("kFull")],
        ["S", t("kNotes")],
        ["B  .", t("kPause")],
        ["G", t("kGoto")],
        [String(cfg.key || "M"), t("kMenu")]
      ];
      if (narOn) rows.push(["N", t("kNar")]);
      rows.push(["?", t("kHelp")]);
      var table = h("table", "menu-keys");
      rows.forEach(function (r) { var tr = h("tr"); tr.appendChild(h("td", "menu-keys-key", r[0])); tr.appendChild(h("td", null, r[1])); table.appendChild(tr); });
      body.appendChild(table);
    }

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (order.length) { closeWindow(order[order.length - 1]); e.stopPropagation(); }
      else if (isOpen) { close(); e.stopPropagation(); }
    }

    function state() {
      return { open: isOpen, awake: document.body.classList.contains("menu-awake"), windows: order.slice(),
               uiLang: uiLang(), slideLang: slideLang(), slideLangs: slideLangs.slice(), audioLang: audioLang(),
               prefs: readPrefs(), slidesPrefs: readPrefs("slides"), audioPrefs: readPrefs("audio"),
               follows: { slides: follows("slides"), audio: follows("audio") } };
    }

    return { id: "menu", init: init, open: open, close: close, toggle: toggle, openWindow: openWindow, closeWindow: closeWindow,
             prefs: readPrefs, setPrefs: setPrefs, follow: follow, slideLang: slideLang, state: state };
  }

  window.RevealMenu = RevealMenu;
})();
