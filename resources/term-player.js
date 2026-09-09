/* term-player.js — replay a terminal recording (JSON from record_to_json.py) in a deck.
 *
 * Usage in a reveal.js deck (slides live in slides/):
 *   <link rel="stylesheet" href="../resources/term-player.css">
 *   ...
 *   <div class="claude-terminal">
 *     <div class="term-replay" data-recording="../resources/recordings/demo.json" data-autoplay="1"></div>
 *   </div>
 *   ...
 *   <script src="../resources/term-player.js"></script>
 *
 * Attributes on .term-replay (all optional except data-recording):
 *   data-recording  path of the JSON, relative to the page
 *   data-autoplay   "1" = start when the slide becomes current (never on page load)
 *   data-speed      0.5 | 1 | 2 | 4 (default 1)
 *   data-max-delay  cap per-chunk delay in ms (default 1200)
 *   data-line-delay ms between lines of a multi-line chunk (default 0 = chunk shown at once;
 *                   pytest writes 40-line bursts, 60-100 keeps the "typing" feel)
 *   data-max-lines  height of the body in lines (default 22): FIXED size, the body scrolls
 *   data-info       "1" = show the command + provenance overlay from the start; otherwise
 *                   the header is hidden behind the ⓘ button (click = toggle overlay over the output)
 *   data-wrap       "0" = no line wrapping, horizontal scroll instead
 * A <pre class="term-replay-static"> child or next sibling is left untouched
 * (hidden on screen once the player is mounted, shown when printing).
 *
 * Recording contract: {meta:{title,command,recorded_at,duration_s,chunks,...}, chunks:[[delay_ms,text],...]}
 * text is plain UTF-8, ANSI already stripped; "\n" = newline, lone "\r" = go back to the
 * start of the current line and overwrite it from column 0 (progress-bar style).
 *
 * Needs HTTP: fetch() of the JSON is blocked on file://, serve the repo
 * (python3 -m http.server) like transcript-modal.js needs for its viewer.
 * Reveal-safe: no key handlers at all (space/arrows stay reveal's), only clicks.
 * API: window.TermPlayer.mount(el, recording) / .mountUrl(el, url) / ._applyChunk(state, text)
 */
(function () {
  "use strict";
  var HIDDEN_META = { title: 1, command: 1, recorded_at: 1, duration_s: 1, chunks: 1 };
  var SPEEDS = [0.5, 1, 2, 4];

  /* ---- line buffer: pure, unit-testable ---------------------------------
   * state = { done: "all completed lines, each ending in \n", line: "current line", col: N }
   * "\n" commits the current line; "\r" moves the column to 0; other text is written
   * at the column, overwriting what is there (like a real terminal, so a shorter
   * rewrite leaves the tail of the old line visible — that is what `script` saw too). */
  function newState() { return { done: "", line: "", col: 0 }; }
  function applyChunk(state, text) {
    var parts = text.split(/(\r|\n)/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === "\n") { state.done += state.line + "\n"; state.line = ""; state.col = 0; }
      else if (p === "\r") { state.col = 0; }
      else if (p) {
        state.line = state.line.slice(0, state.col) + p + state.line.slice(state.col + p.length);
        state.col += p.length;
      }
    }
    return state;
  }

  /* ---- DOM helpers ---------------------------------------------------- */
  function h(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // never innerHTML: recording text is untrusted
    return n;
  }
  function num(el, attr, dflt) { var v = parseFloat(el.getAttribute(attr)); return isNaN(v) ? dflt : v; }

  function buildUi(el, rec) {
    var meta = rec.meta || {};
    var head = h("div", "tp-head");
    head.appendChild(h("code", "tp-cmd", meta.command || meta.title || ""));
    if (meta.title) head.title = meta.title;
    var prov = Object.keys(meta).filter(function (k) { return !HIDDEN_META[k]; })
      .map(function (k) { return k + " " + meta[k]; }).join(" · ");
    if (prov) head.appendChild(h("span", "tp-meta", prov));

    var ctl = h("div", "tp-controls");
    var ui = { head: head, ctl: ctl,
      play: h("button", "tp-play", "▶"), fin: h("button", "tp-fin-btn", "⏭ fin"),
      restart: h("button", "tp-restart", "↺"), speed: h("select", "tp-speed"),
      info: h("button", "tp-info", "ⓘ") };
    ui.play.title = "play / pause"; ui.fin.title = "jump to the end"; ui.restart.title = "restart";
    ui.info.title = "command + provenance";
    var want = num(el, "data-speed", 1);
    SPEEDS.concat(SPEEDS.indexOf(want) < 0 ? [want] : []).sort(function (a, b) { return a - b; })
      .forEach(function (s) { var o = h("option", null, s + "×"); o.value = s; o.selected = s === want; ui.speed.appendChild(o); });
    [ui.play, ui.fin, ui.restart, ui.info, ui.speed].forEach(function (n) { ctl.appendChild(n); });

    var body = h("pre", "tp-body");
    if (el.getAttribute("data-wrap") === "0") body.classList.add("tp-nowrap");
    ui.body = body; ui.doneNode = document.createTextNode(""); ui.lineNode = document.createTextNode("");
    ui.cursor = h("span", "tp-cursor"); ui.finLine = h("div", "tp-fin");
    [ui.doneNode, ui.lineNode, ui.cursor, ui.finLine].forEach(function (n) { body.appendChild(n); });
    el.style.setProperty("--tp-max-lines", num(el, "data-max-lines", 22));
    // the header is an overlay on top of the output, toggled by ⓘ (hidden by default:
    // the recording usually prints its own provenance lines anyway)
    var stage = h("div", "tp-stage"); stage.appendChild(body); stage.appendChild(head);
    if (el.getAttribute("data-info") === "1") el.classList.add("tp-show-info");
    el.appendChild(ctl); el.appendChild(stage);
    return ui;
  }

  /* ---- player ---------------------------------------------------------- */
  function mount(el, rec) {
    if (el._termPlayer) return el._termPlayer;
    var chunks = (rec && rec.chunks) || [];
    var p = { el: el, rec: rec, chunks: chunks, ui: buildUi(el, rec), idx: 0, timer: null,
      playing: false, finished: false, maxDelay: num(el, "data-max-delay", 1200),
      lineDelay: num(el, "data-line-delay", 0), pending: [], nextDelay: 0, buf: newState() };
    p.speed = parseFloat(p.ui.speed.value) || 1;
    el.classList.add("tp-mounted");
    el._termPlayer = p;

    function render() {
      if (p.ui.doneNode.data.length !== p.buf.done.length) p.ui.doneNode.data = p.buf.done;
      p.ui.lineNode.data = p.buf.line;
      p.ui.body.scrollTop = p.ui.body.scrollHeight;   // follow the output
    }
    function setPlaying(on) {
      p.playing = on;
      el.classList.toggle("tp-playing", on);
      p.ui.play.textContent = on ? "⏸" : "▶";
    }
    function clearTimer() { if (p.timer) { clearTimeout(p.timer); p.timer = null; } }
    // p.pending = pieces of the current chunk still to show: the whole chunk, or, with
    // data-line-delay, one piece per line so a pytest burst is revealed line by line.
    // Pause clears the timer only; pending survives, so resuming continues mid-chunk.
    function schedule() {
      if (!p.pending.length) {
        if (p.idx >= chunks.length) { finish(); return; }
        var c = chunks[p.idx++], text = String(c[1]);
        p.pending = p.lineDelay > 0 ? (text.match(/[^\n]*\n|[^\n]+$/g) || [""]) : [text];
        p.nextDelay = Math.min(c[0] || 0, p.maxDelay);
      }
      p.timer = setTimeout(function () {
        p.timer = null;
        applyChunk(p.buf, p.pending.shift());
        p.nextDelay = p.lineDelay;
        render();
        schedule();
      }, p.nextDelay / p.speed);
    }
    function flushPending() { while (p.pending.length) applyChunk(p.buf, p.pending.shift()); }
    function finish() {
      clearTimer(); setPlaying(false); p.finished = true;
      var secs = (p.rec.meta && p.rec.meta.duration_s) ||
        chunks.reduce(function (s, c) { return s + (c[0] || 0); }, 0) / 1000;
      p.ui.finLine.textContent = "— fin (" + Math.round(secs * 10) / 10 + " s) —";
      el.classList.add("tp-finished");
      p.ui.body.scrollTop = p.ui.body.scrollHeight;
    }
    p.play = function () { if (p.playing || p.finished) return; setPlaying(true); schedule(); };
    p.pause = function () { if (!p.playing) return; clearTimer(); setPlaying(false); };
    p.toggle = function () { if (p.finished) p.restart(); else if (p.playing) p.pause(); else p.play(); };
    p.skip = function () {
      clearTimer(); flushPending();
      while (p.idx < chunks.length) applyChunk(p.buf, String(chunks[p.idx++][1]));
      render(); finish();
    };
    p.restart = function () {
      clearTimer(); setPlaying(false);
      p.idx = 0; p.pending = []; p.finished = false; p.buf = newState();
      p.ui.finLine.textContent = ""; el.classList.remove("tp-finished");
      render(); p.play();
    };
    p.setSpeed = function (s) { p.speed = s; if (p.playing) { clearTimer(); schedule(); } };

    // Clicks only. Blur afterwards: reveal does not ignore keys when a button/select
    // is focused, so a later Space/arrow would both act here and change slide.
    function onClick(btn, fn) { btn.addEventListener("click", function (e) { e.stopPropagation(); fn(); btn.blur(); }); }
    onClick(p.ui.play, p.toggle); onClick(p.ui.fin, p.skip); onClick(p.ui.restart, p.restart);
    onClick(p.ui.info, function () { el.classList.toggle("tp-show-info"); });
    p.ui.head.addEventListener("click", function (e) { e.stopPropagation(); el.classList.remove("tp-show-info"); });
    p.ui.speed.addEventListener("change", function () { p.setSpeed(parseFloat(p.ui.speed.value) || 1); p.ui.speed.blur(); });
    p.ui.body.addEventListener("click", function () {
      if (!String(window.getSelection && window.getSelection()).length) p.toggle();   // not while selecting text
    });

    watchVisibility(p, el.getAttribute("data-autoplay") === "1");
    render();
    return p;
  }

  /* Never autoplay on load: with reveal, start when the containing slide is current
   * and pause when it is left; elsewhere use IntersectionObserver. */
  function watchVisibility(p, autoplay) {
    function onVisible(vis) { if (vis) { if (autoplay) p.play(); } else p.pause(); }
    var R = window.Reveal;
    if (R && typeof R.on === "function" && typeof R.getCurrentSlide === "function") {
      var check = function () { var cur = R.getCurrentSlide(); onVisible(!!(cur && cur.contains(p.el))); };
      R.on("slidechanged", check); R.on("ready", check);
      if (typeof R.isReady === "function" && R.isReady()) check();
    } else if (typeof IntersectionObserver === "function") {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { onVisible(e.isIntersecting); });
      }, { threshold: 0.4 }).observe(p.el);
    }
  }

  function showError(el, url, err) {
    el.classList.add("tp-mounted", "tp-error");
    var body = h("pre", "tp-body tp-error-msg");
    body.appendChild(h("div", null, "could not load " + url));
    body.appendChild(h("div", "tp-fin", String(err && err.message || err) +
      (location.protocol === "file:" ? " — fetch() is blocked on file://, serve over http (python3 -m http.server)" : "")));
    el.appendChild(body);
  }

  function mountUrl(el, url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status + " " + r.statusText);
      return r.json();
    }).then(function (rec) {
      if (!rec || !Array.isArray(rec.chunks)) throw new Error("not a recording: missing chunks[]");
      return mount(el, rec);
    }).catch(function (err) { showError(el, url, err); });
  }

  function autoInit() {
    Array.prototype.forEach.call(document.querySelectorAll(".term-replay[data-recording]"), function (el) {
      if (!el._termPlayer) mountUrl(el, el.getAttribute("data-recording"));
    });
  }

  var root = typeof window !== "undefined" ? window : globalThis;
  root.TermPlayer = { mount: mount, mountUrl: mountUrl, init: autoInit, _applyChunk: applyChunk, _newState: newState };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
    else autoInit();
  }
})();
