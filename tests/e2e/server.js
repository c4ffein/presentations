// The static server the e2e tests run the repo on: Bun.serve, no-store.
// `extra(url, req)` may answer a request first (test-only routes).
import path from "node:path";

export const ROOT = path.resolve(import.meta.dir, "../..");

export function startServer(extra) {
  return Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (extra) { const r = await extra(url, req); if (r) return r; }
      let p = decodeURIComponent(url.pathname);
      if (p.endsWith("/")) p += "index.html";
      const file = path.resolve(ROOT, "." + p);
      if (!file.startsWith(ROOT + path.sep)) return new Response("forbidden", { status: 403 });
      const f = Bun.file(file);
      if (!(await f.exists())) return new Response("not found: " + p, { status: 404 });
      return new Response(f, { headers: { "Cache-Control": "no-store" } });
    },
  });
}

// A valid 8-bit mono PCM WAV of silence, for tests that need playable audio.
export function silentWav(seconds = 0.25, rate = 8000) {
  const n = Math.round(seconds * rate);
  const b = new Uint8Array(44 + n);
  const dv = new DataView(b.buffer);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) b[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); dv.setUint32(4, 36 + n, true); w(8, "WAVE");
  w(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
  w(36, "data"); dv.setUint32(40, n, true);
  b.fill(128, 44);
  return b;
}
