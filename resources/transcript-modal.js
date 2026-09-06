/* transcript-modal.js — open a session transcript in a modal, from any deck.
 *
 * Usage in a deck (slides live in slides/, viewer in transcripts/):
 *   <a href="#" data-transcript="making-of.json">voir le making-of</a>
 *   ...
 *   <script src="../resources/transcript-modal.js"></script>
 *
 * The link's data-transcript is the JSON filename in transcripts/. Optionally
 * override the viewer path with data-viewer, or globally via
 *   window.TRANSCRIPT_VIEWER = "../transcripts/viewer.html";
 *
 * Reveal-safe: while the modal is open, keyboard events are captured so the
 * deck doesn't change slides behind it. Esc or a click on the backdrop closes.
 */
(function () {
  var DEFAULT_VIEWER = "../transcripts/viewer.html";
  var overlay, frame, keyTrap;

  function viewerBase(link) {
    return (link && link.getAttribute("data-viewer")) ||
           window.TRANSCRIPT_VIEWER || DEFAULT_VIEWER;
  }

  function build() {
    overlay = document.createElement("div");
    overlay.setAttribute("style", [
      "position:fixed", "inset:0", "z-index:9999", "display:none",
      "background:rgba(0,0,0,0.72)", "padding:3vh 3vw"
    ].join(";"));

    var box = document.createElement("div");
    box.setAttribute("style", [
      "position:relative", "width:100%", "height:100%",
      "border-radius:8px", "overflow:hidden", "box-shadow:0 10px 40px rgba(0,0,0,0.5)",
      "background:#1b1b1b"
    ].join(";"));

    var close = document.createElement("button");
    close.textContent = "✕";
    close.setAttribute("aria-label", "Fermer");
    close.setAttribute("style", [
      "position:absolute", "top:8px", "right:10px", "z-index:2",
      "border:none", "background:#232323", "color:#e8e6e3",
      "font-size:18px", "line-height:1", "width:34px", "height:34px",
      "border-radius:6px", "cursor:pointer"
    ].join(";"));
    close.addEventListener("click", closeModal);

    frame = document.createElement("iframe");
    frame.setAttribute("style", "width:100%;height:100%;border:0;background:#1b1b1b;");
    frame.setAttribute("title", "Transcript");

    box.appendChild(close);
    box.appendChild(frame);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) closeModal(); });
    document.body.appendChild(overlay);

    // Capture-phase trap so Reveal's global key handler never sees these.
    keyTrap = function (e) {
      if (overlay.style.display === "none") return;
      if (e.key === "Escape") { closeModal(); e.preventDefault(); }
      e.stopPropagation();
    };
    document.addEventListener("keydown", keyTrap, true);
  }

  function openModal(file, base) {
    if (!overlay) build();
    frame.src = base + "?t=" + encodeURIComponent(file);
    overlay.style.display = "block";
  }
  function closeModal() {
    if (!overlay) return;
    overlay.style.display = "none";
    frame.src = "about:blank";
  }

  // Capture phase + stopPropagation: Reveal listens for clicks on a[href^="#"]
  // inside .slides and navigates to the matching slide ("#" = first slide),
  // which would reset the deck the moment a transcript link is clicked.
  document.addEventListener("click", function (e) {
    var link = e.target.closest("[data-transcript]");
    if (!link) return;
    e.preventDefault();
    e.stopPropagation();
    openModal(link.getAttribute("data-transcript"), viewerBase(link));
  }, true);

  window.TranscriptModal = { open: openModal, close: closeModal };
})();
