/* narration.js — reveal.js plugin: per-slide audio narration, in several
 * languages and variants, served as plain files from any static server.
 *
 * A slide embeds the NAME OF A RECORDING in a tag — on the section, on any
 * element inside it, or on a fragment (played when the fragment shows):
 *   <section data-narration="mental-model/gpt-2">…</section>
 *   <section>… <span data-narration="mental-model/gpt-2" hidden></span> …</section>
 *   <p class="fragment" data-narration="mental-model/gpt-2-more">…</p>
 * Slides themselves are not named: the name is the recording's, it goes
 * with the slide into every deck it is built into, and two slides may share
 * one. The plugin plays
 *   <base>/<name>.<lang>[.<variant>].<format>
 * trying the variant file first (when the deck asks for one) and falling back
 * to the plain one: a deck can carry a few re-recorded slides and share the
 * rest. A slide without a recording is "silent": in auto mode the deck moves
 * on after `silentDelay` ms.
 *
 * Nothing happens at load: no panel, no request. Narration ACTIVATES when the
 * page URL carries `?narration` (a shared link) or when the viewer presses N;
 * pressing N then puts `narration` in the URL so a reload stays on. Activation
 * PRELOADS every recording of the deck for the current language into memory
 * (current slide first, then onwards), so the talk survives losing the
 * connection; a file that failed to preload streams from the server instead.
 * Afterwards N only shows / hides the panel.
 * A browser refuses sound before the viewer has touched the page (Chrome
 * without history on the site, Firefox, Safari): a link that turns narration
 * on then sits on "ready" with nothing heard. So activation from the URL probes
 * once with a silent clip; refused = BLOCKED: auto mode holds (silent slides
 * included), the panel shows and says "click or press a key", and the first
 * pointer or key anywhere on the page — that is the gesture — starts it.
 *
 * In the deck:
 *   <link rel="stylesheet" href="../resources/narration.css">
 *   <script src="../resources/narration.js"></script>
 *   Reveal.initialize({
 *     narration: {
 *       base: "https://audio.example.org/presentations",   // null = plugin off
 *       langs: ["fr", "en"],   // buttons; plays the first of the viewer's preferred languages it has
 *                              // (localStorage `presentations.langs`, shared with menu.js), else the first
 *       lang: null,            // force the initial language
 *       variant: null,         // e.g. "inria": try <name>.fr.inria.mp3 before <name>.fr.mp3
 *       format: "mp3",
 *       silentDelay: 1500,     // ms spent on a slide without recording in auto mode
 *       gap: 1000,             // ms of pause between the end of a recording and the next slide, in auto mode
 *       auto: false,           // start in auto ("hear me talk") mode
 *       active: false,         // true = on at load even without ?narration
 *       preload: true,         // fetch every recording of the language on activation
 *       panel: true,           // the floating panel (draggable, collapsible, position remembered)
 *       key: "N"               // activates, then shows / hides the panel (reveal's N = next
 *                              // slide is redundant with Space and the arrows); null = no key
 *     },
 *     plugins: [ …, RevealNarration ]
 *   });
 * URL: ?narration          on, with the deck's base
 *      ?narration=<base>   on, from that server instead (try one without rebuilding)
 *      &lang=en&variant=inria   override language / variant
 *      &auto&gap=2000           start in auto mode / the pause between slides, ms (a link that plays itself)
 *
 * API (deck.getPlugin("narration")): activate(), play(), pause(), toggle(),
 * setAuto(bool), setGap(ms), setLang(l, remember?), setVariant(v | null),
 * togglePanel(show?), state().
 */
(function () {
  var PANEL_KEY = "narration.panel", PREFS_KEY = "presentations.langs", AUDIO_KEY = PREFS_KEY + ".audio", PARALLEL = 3;
  var SILENCE = "data:audio/wav;base64,UklGRiwAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQgAAACAgICAgICAgA==";   // 8 silent samples: the autoplay probe

  // The viewer's preferred languages, in order (the convention shared with
  // menu.js): the audio list if they made one, else the interface list. The
  // panel's labels follow the interface list, then the browser's language.
  function readList(key) {
    try { var v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }) : null; }
    catch (e) { return null; }
  }
  function readPrefs() { return readList(AUDIO_KEY) || readList(PREFS_KEY) || []; }
  function writePrefs(list) { try { localStorage.setItem(AUDIO_KEY, JSON.stringify(list)); } catch (e) {} }
  var T = {
    fr: { title: "Narration", loading: "chargement…", ready: "prêt", playing: "lecture", ended: "terminé", missing: "pas d'enregistrement",
          silent: "slide muette", auto: "auto", preloading: "préchargement des enregistrements {lang}",
          retry: "cliquer pour réessayer ; en attendant ils sont lus depuis le serveur", inMemory: "{n} enregistrements {lang} en mémoire",
          failed: "{n} en échec ↻", collapse: "replier", blocked: "cliquer ou appuyer sur une touche pour lancer le son" },
    en: { title: "Narration", loading: "loading…", ready: "ready", playing: "playing", ended: "ended", missing: "no recording",
          silent: "silent slide", auto: "auto", preloading: "preloading {lang} recordings",
          retry: "click to retry; these stream from the server meanwhile", inMemory: "{n} {lang} recordings in memory",
          failed: "{n} failed ↻", collapse: "collapse", blocked: "click or press a key to start the sound" }
  };
  function t(k, vars) {
    var main = readList(PREFS_KEY) || [], nav = ((navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""])).map(function (l) { return String(l).slice(0, 2).toLowerCase(); });
    var s = (T[best(["fr", "en"], main.length ? main : nav)] || T.fr)[k] || k;
    return s.replace(/\{(\w+)\}/g, function (_, v) { return vars && v in vars ? vars[v] : ""; });
  }
  function best(available, prefs) {
    for (var i = 0; i < prefs.length; i++) if (available.indexOf(prefs[i]) >= 0) return prefs[i];
    return available[0] || null;
  }

  function store(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
  function h(tag, cls, text) { var el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; }

  function RevealNarration() {
    var deck, cfg, audio, ui = null, silentTimer = null, token = 0, wantPlay = false, active = false;
    var st = { lang: null, variant: null, auto: false, id: null, src: null, status: "idle", attempts: [], history: [] };
    // cache[url] = { url (object URL) } | { missing: true } | { failed: true }: one
    // entry per FILE, so switching language or variant reuses what is already
    // in memory and nothing is ever dropped (no object URL to revoke).
    var cache = {}, pending = {}, progress = null;

    function init(d) {
      deck = d;
      var c = Object.assign({ base: null, langs: ["fr"], lang: null, variant: null, format: "mp3", silentDelay: 1500, gap: 1000,
                              auto: false, active: false, preload: true, panel: true, key: "N" }, deck.getConfig().narration || {});
      var q = new URLSearchParams(location.search), want = c.active;
      if (q.has("narration")) {
        var v = q.get("narration");
        if (v && !/^(1|on|true)$/i.test(v)) c.base = v;
        want = true;
      }
      if (q.get("lang")) c.lang = q.get("lang");
      if (q.has("variant")) c.variant = q.get("variant") || null;
      if (q.has("auto")) c.auto = true;
      if (q.get("gap") != null && !isNaN(+q.get("gap"))) c.gap = +q.get("gap");
      if (!c.base) return;                      // nowhere to fetch from: plugin off
      cfg = c; cfg.base = String(cfg.base).replace(/\/+$/, "");
      if (cfg.key) {
        var k = String(cfg.key).toUpperCase();
        deck.addKeyBinding({ keyCode: k.charCodeAt(0), key: k, description: "Narration" }, function () {
          if (active) togglePanel(); else { activate(); togglePanel(true); }
        });
      }
      if (want) activate();
    }

    // Everything that costs something: the audio element, the panel, the
    // deck listeners and the preload. Runs once, from the URL or from N.
    function activate() {
      if (active || !cfg) return; active = true;
      st.lang = cfg.lang || best(cfg.langs, readPrefs());
      st.variant = cfg.variant; st.auto = !!cfg.auto;

      audio = new Audio(); audio.preload = "auto";
      audio.addEventListener("ended", function () { st.status = "ended"; render(); if (st.auto) later(advance, cfg.gap); });
      ["play", "pause", "timeupdate", "durationchange"].forEach(function (e) { audio.addEventListener(e, render); });

      if (cfg.panel) buildPanel();
      ["slidechanged", "fragmentshown", "fragmenthidden"].forEach(function (e) { deck.on(e, sync); });
      if (!(navigator.userActivation && navigator.userActivation.hasBeenActive)) probe();
      if (deck.isReady()) start(); else deck.on("ready", start);
      try {
        var u = new URL(location.href);
        if (!u.searchParams.has("narration")) { u.searchParams.set("narration", ""); history.replaceState(history.state, "", u.href.replace("narration=", "narration")); }
      } catch (e) {}
    }
    function start() { sync(); if (cfg.preload) preload(st.lang); }

    // ---- blocked: no sound before a gesture ----
    // Assumed from the start of a gesture-less activation, so nothing moves
    // meanwhile; lifted by the probe when the browser allows sound, else by the
    // first pointer or key on the page. `refused` = the probe said no: the
    // panel shows and says what to do.
    function probe() {
      st.blocked = true;
      document.addEventListener("pointerdown", unblock, true); document.addEventListener("keydown", unblock, true);
      var a = new Audio(SILENCE);
      a.play().then(unblock, function (e) { if (e && e.name === "NotAllowedError") refuse(); else unblock(); });
    }
    function refuse() { if (!st.blocked) return; st.refused = true; render(); if (ui) togglePanel(true); }
    function unblock() {
      if (!st.blocked) return;
      st.blocked = false; st.refused = false;
      document.removeEventListener("pointerdown", unblock, true); document.removeEventListener("keydown", unblock, true);
      render();
      if (st.status === "ready" || st.status === "ended") { if (st.auto || wantPlay) play(); }
      else if (st.auto && (st.status === "silent" || st.status === "missing")) scheduleSilent();
    }
    function playError(e) { if (e && e.name === "NotAllowedError") { if (!st.blocked) probe(); refuse(); } }

    // The element whose recording is current: the last visible fragment
    // carrying data-narration, else the slide's own tag (the section or any
    // non-fragment element inside it).
    function target() {
      var slide = deck.getCurrentSlide(); if (!slide) return null;
      var frags = slide.querySelectorAll(".fragment.visible[data-narration]");
      if (frags.length) return frags[frags.length - 1];
      if (slide.hasAttribute("data-narration")) return slide;
      return slide.querySelector("[data-narration]:not(.fragment)");
    }

    function sync() {
      var el = target(), id = el ? el.getAttribute("data-narration") : null;
      if (id === st.id && st.status !== "idle") {
        // A step that changed nothing to hear (a fragment without recording):
        // in auto mode keep the deck moving.
        if (st.auto && (st.status === "ended" || st.status === "missing" || st.status === "silent")) scheduleSilent();
        return;
      }
      loadId(id);
    }

    function candidates(id, lang) {
      var b = cfg.base + "/" + id + "." + lang, list = [];
      if (st.variant) list.push(b + "." + st.variant + "." + cfg.format);
      list.push(b + "." + cfg.format);
      return list;
    }

    // ---- preload: every recording of the deck, for one language ----
    function names() {
      var seen = {}, out = [], cur = st.id, from = 0;
      Array.prototype.forEach.call(deck.getSlidesElement().querySelectorAll("[data-narration]"), function (el) {
        var n = el.getAttribute("data-narration"); if (n && !seen[n]) { seen[n] = true; out.push(n); }
      });
      if (cur && (from = out.indexOf(cur)) > 0) out = out.slice(from).concat(out.slice(0, from));   // current slide first
      return out;
    }
    // What the cache already says about a recording, without fetching: the
    // first candidate in memory, "missing" when every candidate 404'd, "failed"
    // when one errored (to retry), null while something is still unknown.
    function entry(lang, id) {
      var list = candidates(id, lang), attempts = [];
      for (var i = 0; i < list.length; i++) {
        var e = cache[list[i]]; attempts.push(list[i]);
        if (!e) return null;
        if (e.failed) return { failed: true, attempts: attempts };
        if (!e.missing) return { src: list[i], url: e.url, attempts: attempts };
      }
      return { missing: true, attempts: attempts };
    }
    // Fetch one file into memory, once: a 404 is "missing" (final), a network
    // error is "failed" (retried on the next preload or streamed meanwhile).
    function fetchUrl(u) {
      if (cache[u] && !cache[u].failed) return Promise.resolve(cache[u]);
      if (pending[u]) return pending[u];
      pending[u] = fetch(u).then(function (r) {
        if (r.status === 404) return { missing: true };
        if (!r.ok) throw new Error(r.status);
        return r.blob().then(function (b) { return { url: URL.createObjectURL(b) }; });
      }).catch(function () { return { failed: true }; })
        .then(function (e) { cache[u] = e; delete pending[u]; return e; });
      return pending[u];
    }
    // Resolve a recording: the variant file, then the plain one (same shape as entry()).
    function resolve(id, lang) {
      var list = candidates(id, lang), attempts = [];
      return (function step(i) {
        if (i >= list.length) return Promise.resolve({ missing: true, attempts: attempts });
        attempts.push(list[i]);
        return fetchUrl(list[i]).then(function (e) {
          if (e.missing) return step(i + 1);
          if (e.failed) return { failed: true, attempts: attempts };
          return { src: list[i], url: e.url, attempts: attempts };
        });
      })(0);
    }

    function preload(lang) {
      var todo = names().filter(function (n) { var e = entry(lang, n); return !e || e.failed; });
      progress = { lang: lang, total: todo.length, done: 0, failed: 0 }; render();
      var i = 0;
      function next() {
        if (i >= todo.length) return;
        var id = todo[i++];
        resolve(id, lang).then(function (e) { progress.done++; if (e.failed) progress.failed++; render(); next(); });
      }
      for (var k = 0; k < PARALLEL; k++) next();
    }

    // ---- the current recording ----
    function loadId(id) {
      var my = ++token;
      clearTimeout(silentTimer);
      st.id = id; st.src = null; st.attempts = [];
      audio.pause();
      if (!id) { st.status = "silent"; render(); if (st.auto) scheduleSilent(); return; }
      st.status = "loading"; render();
      var e = entry(st.lang, id);
      if (e && !e.failed) return useEntry(e, my);
      if (cfg.preload) resolve(id, st.lang).then(function (e) { if (my === token) useEntry(e, my); });
      else tryNext(candidates(id, st.lang), null, 0, my);
    }
    function useEntry(e, my) {
      st.attempts = e.attempts.slice();
      if (e.missing) { st.status = "missing"; render(); if (st.auto) scheduleSilent(); return; }
      if (e.failed) return tryNext(candidates(st.id, st.lang), null, 0, my);   // offline or server down: stream
      tryNext([e.url], e.src, 0, my);
    }

    // Point the audio element at list[i]; on error move to the next one.
    // `label` is what state() reports as src when the list holds object URLs.
    function tryNext(list, label, i, my) {
      if (my !== token) return;
      if (i >= list.length) { st.status = "missing"; render(); if (st.auto) scheduleSilent(); return; }
      var src = list[i], shown = label || src;
      function cleanup() { audio.removeEventListener("canplay", ok); audio.removeEventListener("error", err); }
      function ok() {
        cleanup(); if (my !== token) return;
        st.src = shown; st.status = "ready"; st.history.push(shown); render();
        if ((st.auto || wantPlay) && !st.blocked) { wantPlay = false; audio.play().catch(playError); }
      }
      function err() { cleanup(); if (my === token) tryNext(list, label, i + 1, my); }
      if (!label) st.attempts.push(src);
      audio.addEventListener("canplay", ok); audio.addEventListener("error", err);
      audio.src = src; audio.load();
    }

    // The end of the deck: reveal's isLastSlide() asks the slide for a next
    // sibling, and the scroll view (a phone in portrait) re-parents every slide
    // into a page of its own — there it says "last" on every slide, which used
    // to untick auto after the first recording. The last slide's indices say.
    function atEnd() {
      var all = deck.getSlides(), last = all[all.length - 1], ci = deck.getIndices(), li = last ? deck.getIndices(last) : null;
      return !!li && li.h === ci.h && (li.v || 0) === (ci.v || 0) && !deck.availableFragments().next;
    }
    function advance() {
      clearTimeout(silentTimer);
      if (atEnd()) { st.auto = false; render(); return; }
      deck.next();
    }
    function later(f, ms) { clearTimeout(silentTimer); silentTimer = setTimeout(f, ms); }
    function scheduleSilent() { if (!st.blocked) later(advance, cfg.silentDelay); }

    function play() {
      if (!active) return;
      if (st.status === "ready" || st.status === "ended") {
        if (st.status === "ended") audio.currentTime = 0;
        audio.play().catch(playError);
      } else if (st.status === "loading") wantPlay = true;
    }
    function pause() { if (!active) return; wantPlay = false; audio.pause(); }
    function toggle() { if (!active) return; if (audio.paused) play(); else pause(); }
    function setAuto(on) {
      if (!active) return;
      st.auto = !!on; clearTimeout(silentTimer); render();
      if (!st.auto) return;
      if (st.status === "ready" || st.status === "ended") { if (audio.paused) play(); }
      else if (st.status === "missing" || st.status === "silent") scheduleSilent();
    }
    function reload() { var was = !audio.paused || wantPlay; var id = st.id; st.status = "idle"; loadId(id); if (was && !st.auto) wantPlay = true; }
    function setLang(l, remember) {   // remember = the viewer chose it: it goes first in their preferences
      if (!active) return;
      if (cfg.langs.indexOf(l) < 0) cfg.langs.push(l); st.lang = l; reload();
      if (remember) writePrefs([l].concat(readPrefs().filter(function (x) { return x !== l; })));
      if (cfg.preload) preload(l);
    }
    function setVariant(v) { if (!active) return; st.variant = v || null; reload(); if (cfg.preload) preload(st.lang); }
    function setGap(ms) { if (!cfg) return; cfg.gap = Math.max(0, +ms || 0); render(); }
    function togglePanel(show) {
      if (!ui) return;
      var hide = show == null ? !ui.panel.classList.contains("nar-hidden") : !show;
      ui.panel.classList.toggle("nar-hidden", hide);
      if (!hide && ui.panel.style.left) ui.place(parseFloat(ui.panel.style.left), parseFloat(ui.panel.style.top));   // back on screen if the window shrank
      ui.savePanel();
    }
    function state() {
      return { enabled: !!cfg, langs: cfg ? cfg.langs.slice() : [], gap: cfg ? cfg.gap : null, active: active, lang: st.lang, variant: st.variant, auto: st.auto, id: st.id, src: st.src, status: st.status,
               blocked: !!st.blocked, refused: !!st.refused,
               attempts: st.attempts.slice(), history: st.history.slice(),
               paused: !audio || audio.paused, currentTime: audio ? audio.currentTime : 0,
               panelHidden: !!(ui && ui.panel.classList.contains("nar-hidden")),
               preload: progress ? Object.assign({}, progress) : null };
    }

    // ---- panel ----
    function buildPanel() {
      var saved = load(PANEL_KEY) || {};
      var panel = h("div", "nar-panel" + (saved.collapsed ? " nar-collapsed" : "") + (saved.hidden ? " nar-hidden" : ""));
      var head = h("div", "nar-head"), body = h("div", "nar-body");
      var collapse = h("button", "nar-collapse", saved.collapsed ? "+" : "–");
      collapse.setAttribute("aria-label", t("collapse"));
      var preloadEl = h("span", "nar-preload", "");
      preloadEl.addEventListener("click", function () { if (progress && progress.failed) preload(st.lang); });
      head.appendChild(h("span", "nar-title", t("title"))); head.appendChild(preloadEl); head.appendChild(collapse);

      var langs = h("div", "nar-row nar-langs");
      cfg.langs.forEach(function (l) {
        var b = h("button", "nar-lang", l); b.setAttribute("data-lang", l);
        b.addEventListener("click", function () { setLang(l, true); });
        langs.appendChild(b);
      });
      var row = h("div", "nar-row");
      var playBtn = h("button", "nar-play", "▶"), bar = h("div", "nar-bar"), fill = h("div", "nar-fill"), time = h("span", "nar-time", "0:00 / 0:00");
      playBtn.addEventListener("click", toggle);
      bar.appendChild(fill);
      bar.addEventListener("click", function (e) {
        if (!audio.duration) return;
        var r = bar.getBoundingClientRect(); audio.currentTime = audio.duration * (e.clientX - r.left) / r.width;
      });
      row.appendChild(playBtn); row.appendChild(bar); row.appendChild(time);
      var row2 = h("div", "nar-row");
      var autoLbl = h("label", "nar-auto"), autoBox = h("input"); autoBox.type = "checkbox"; autoBox.className = "nar-auto-box";
      autoBox.addEventListener("change", function () { setAuto(autoBox.checked); });
      autoLbl.appendChild(autoBox); autoLbl.appendChild(document.createTextNode(t("auto")));
      var status = h("span", "nar-status", "");
      row2.appendChild(autoLbl); row2.appendChild(status);
      body.appendChild(langs); body.appendChild(row); body.appendChild(row2);
      panel.appendChild(head); panel.appendChild(body);

      // Nothing in the panel keeps the focus: a click works, then the keys are the deck's again.
      panel.addEventListener("focusin", function (e) { if (e.target.blur) e.target.blur(); });
      collapse.addEventListener("click", function () {
        panel.classList.toggle("nar-collapsed");
        var c = panel.classList.contains("nar-collapsed"); collapse.textContent = c ? "+" : "–"; savePanel();
      });

      // Drag by the header.
      var drag = null;
      head.addEventListener("pointerdown", function (e) {
        if (e.target === collapse || e.target === preloadEl) return;
        var r = panel.getBoundingClientRect();
        drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; head.setPointerCapture(e.pointerId); e.preventDefault();
      });
      head.addEventListener("pointermove", function (e) { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
      head.addEventListener("pointerup", function (e) { if (drag) { drag = null; head.releasePointerCapture(e.pointerId); savePanel(); } });
      function place(x, y) {
        var w = panel.offsetWidth, hh = panel.offsetHeight;
        x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w)); y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - hh));
        panel.style.left = x + "px"; panel.style.top = y + "px"; panel.style.right = "auto"; panel.style.bottom = "auto";
      }
      function savePanel() {
        // From the styles place() set, never from the rectangle: a hidden panel measures as (0, 0).
        store(PANEL_KEY, { left: panel.style.left ? parseFloat(panel.style.left) : null, top: panel.style.top ? parseFloat(panel.style.top) : null,
                           collapsed: panel.classList.contains("nar-collapsed"), hidden: panel.classList.contains("nar-hidden") });
      }
      document.body.appendChild(panel);
      if (saved.left != null && saved.top != null) place(saved.left, saved.top);
      window.addEventListener("resize", function () { if (panel.style.left) place(parseFloat(panel.style.left), parseFloat(panel.style.top)); });
      ui = { panel: panel, playBtn: playBtn, fill: fill, time: time, status: status, autoBox: autoBox, langs: langs, preload: preloadEl, savePanel: savePanel, place: place };
      render();
    }

    function render() {
      if (!ui) return;
      ui.playBtn.textContent = audio.paused ? "▶" : "‖";
      ui.playBtn.disabled = !(st.status === "ready" || st.status === "ended" || st.status === "loading");
      var d = audio.duration || 0, cur = audio.currentTime || 0;
      ui.fill.style.width = d ? (100 * cur / d) + "%" : "0";
      ui.time.textContent = fmt(cur) + " / " + fmt(d);
      ui.autoBox.checked = st.auto;
      var label = st.status === "idle" ? "" : st.status === "ready" ? t(audio.paused ? "ready" : "playing") : t(st.status);
      if (st.refused) label = t("blocked");
      ui.panel.classList.toggle("nar-blocked", !!st.refused);
      ui.status.textContent = (st.id ? st.id.split("/").pop() + " · " : "") + label;
      ui.status.title = st.src || (st.id || "");
      Array.prototype.forEach.call(ui.langs.children, function (b) { b.classList.toggle("nar-on", b.getAttribute("data-lang") === st.lang); });
      // Preload: "↓ 12/34" while fetching, "3 failed ↻" (click retries), nothing once all is in memory.
      var p = progress, txt = "", title = "";
      if (p && p.done < p.total) { txt = "↓ " + p.done + "/" + p.total; title = t("preloading", { lang: p.lang }); }
      else if (p && p.failed) { txt = t("failed", { n: p.failed }); title = t("retry"); }
      else if (p && p.total) { title = t("inMemory", { n: p.total, lang: p.lang }); }
      ui.preload.textContent = txt; ui.preload.title = title; ui.preload.classList.toggle("nar-retry", !!(p && p.failed && p.done >= p.total));
    }

    return { id: "narration", init: init, activate: activate, play: play, pause: pause, toggle: toggle, setAuto: setAuto,
             setGap: setGap, setLang: setLang, setVariant: setVariant, togglePanel: togglePanel, state: state };
  }

  window.RevealNarration = RevealNarration;
})();
