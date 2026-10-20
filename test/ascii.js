/* Deep Blue ASCII touches (test board only): the rolling sea on the passcode screen, the
   waterline drawn in characters, and the splash + HOLD / BREAK / CALLAHAN?! when a goal is
   complete. Plain canvas, no libraries. Everything stops drawing while it's off screen or the
   tab is hidden, shows a still frame for people who ask for reduced motion, and can be turned
   off per phone. Exposes window.DBAscii. */
(function () {
  "use strict";
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
  const reduce = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SEA = "#134a74", PAPER = "#f1f7f8";

  function fit(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.max(1, Math.round(r.width * d)), H = Math.max(1, Math.round(r.height * d));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const c = cv.getContext("2d"); c.setTransform(d, 0, 0, d, 0, 0);
    return { c, w: r.width, h: r.height };
  }
  const charW = (c, fs) => { c.font = `${fs}px ${MONO}`; return c.measureText("M").width || fs * 0.6; };

  // ---------- one animation loop for every ASCII canvas on the page ----------
  const items = new Set();   // { cv, draw(t), fps, last, visible }
  let raf = 0;
  const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { const it = [...items].find(x => x.cv === e.target); if (it) it.visible = e.isIntersecting; kick(); }), { rootMargin: "60px" }) : null;
  function tick(now) {
    raf = 0;
    const t = now / 1000;
    let any = false;
    items.forEach(it => {
      if (!it.cv.isConnected) { items.delete(it); if (io) io.unobserve(it.cv); return; }
      if (!it.visible) return;
      any = true;
      if (now - it.last < 1000 / it.fps) return;
      it.last = now; it.draw(t);
    });
    if (any && !document.hidden && !reduce()) raf = requestAnimationFrame(tick);
  }
  function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); }
  document.addEventListener("visibilitychange", kick);
  function add(cv, draw, fps) {
    const it = { cv, draw, fps, last: 0, visible: !io };
    items.add(it);
    if (io) io.observe(cv);
    draw(reduce() ? 0.8 : performance.now() / 1000);   // still frame right away
    kick();
  }

  // ---------- the passcode screen's sea (Swell: speed 0.9, height 1.1, 12px) ----------
  const RAMP = " .,:-~=≈*#";
  function gateSea(cv, opt) {
    const o = Object.assign({ speed: 0.9, amp: 1.1, size: 12 }, opt);
    add(cv, t => {
      const { c, w, h } = fit(cv), fs = o.size, cw = charW(c, fs), lh = fs * 1.15;
      const cols = Math.ceil(w / cw), rows = Math.ceil(h / lh), T = t * o.speed, amp = o.amp;
      c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
      c.font = `${fs}px ${MONO}`; c.textBaseline = "top";
      const surf = x => rows * 0.22 + amp * (1.6 * Math.sin(x * 0.11 + T * 1.1) + 1.0 * Math.sin(x * 0.047 - T * 0.7));
      for (let x = 0; x < cols; x++) {
        const s = surf(x);
        c.fillStyle = SEA; c.fillRect(x * cw, Math.max(0, s * lh + lh * 0.6), cw + 1, h);
        for (let y = Math.max(0, Math.floor(s - 1)); y < rows; y++) {
          const d = y - s; let ch, col;
          if (d < -0.5) continue;
          if (d < 0.6) { ch = Math.sin(x * 0.5 + T * 2) > 0 ? "~" : "≈"; col = "#c3d6e4"; }
          else {
            const n = 0.5 + 0.5 * Math.sin(x * 0.37 + y * 0.71 + T * 1.7) * Math.cos(x * 0.13 - y * 0.29 - T * 0.9);
            const depth = Math.min(1, d / (rows * 0.75)), b = n * (1 - depth * 0.75);
            ch = RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.round(b * (RAMP.length - 1))))]; if (ch === " ") continue;
            col = `rgba(${Math.round(169 + 30 * b)},${Math.round(196 + 30 * b)},${Math.round(217 + 20 * b)},${0.18 + 0.7 * b})`;
          }
          c.fillStyle = col; c.fillText(ch, x * cw, y * lh);
        }
      }
    }, 30);
  }

  // ---------- the waterline (Crest: speed 1.1, 12px) ----------
  function waterline(el, opt) {
    if (el.dataset.ascii) return;
    el.dataset.ascii = "1";
    const o = Object.assign({ speed: 1.1, size: 12 }, opt);
    const cv = document.createElement("canvas"); cv.className = "ascii-wave"; cv.setAttribute("aria-hidden", "true");
    el.appendChild(cv);
    add(cv, t => {
      const { c, w, h } = fit(cv), fs = o.size, cw = charW(c, fs), T = t * o.speed, cols = Math.ceil(w / cw) + 1;
      c.clearRect(0, 0, w, h); c.font = `${fs}px ${MONO}`; c.textBaseline = "middle";
      for (let x = 0; x < cols; x++) {
        const y = h * 0.55 + 6 * Math.sin(x * 0.28 + T * 1.6) + 3 * Math.sin(x * 0.09 - T);
        c.fillStyle = SEA; c.fillRect(x * cw, y, cw + 1, h - y + 1);
        c.fillText(Math.sin(x * 0.28 + T * 1.6) > 0.3 ? "≈" : "~", x * cw, y - fs * 0.3);
        c.fillStyle = "rgba(195,214,228,.55)"; c.fillText("·", x * cw, y + fs * 0.5);
      }
    }, 24);
  }

  // ---------- goal celebration ----------
  const GLYPH = {
    H: ["#   #", "#   #", "#####", "#   #", "#   #"], O: [" ### ", "#   #", "#   #", "#   #", " ### "], L: ["#    ", "#    ", "#    ", "#    ", "#####"],
    D: ["#### ", "#   #", "#   #", "#   #", "#### "], B: ["#### ", "#   #", "#### ", "#   #", "#### "], R: ["#### ", "#   #", "#### ", "#  # ", "#   #"],
    E: ["#####", "#    ", "#### ", "#    ", "#####"], A: [" ### ", "#   #", "#####", "#   #", "#   #"], K: ["#   #", "#  # ", "###  ", "#  # ", "#   #"],
    C: [" ####", "#    ", "#    ", "#    ", " ####"], N: ["#   #", "##  #", "# # #", "#  ##", "#   #"], "?": [" ### ", "#   #", "  ## ", "     ", "  #  "], "!": ["  #  ", "  #  ", "  #  ", "     ", "  #  "]
  };
  const block = word => [0, 1, 2, 3, 4].map(r => [...word].map(ch => (GLYPH[ch] || GLYPH["!"])[r]).join(" "));
  // A disc seen from above: eight rim ridges and a stripe across the middle turn with theta.
  function disc(c, x, y, fs, theta, k) {
    const f = Math.max(6, Math.round(fs * 0.62 * k)), cw = charW(c, f), lh = f * 1.05, Rr = 3.2, Rc = Rr * lh / cw;
    c.save(); c.font = `700 ${f}px ${MONO}`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "rgba(227,238,251,.97)"; c.beginPath(); c.ellipse(x, y, (Rc + 0.4) * cw, (Rr + 0.4) * lh, 0, 0, Math.PI * 2); c.fill();
    for (let r = -Math.ceil(Rr); r <= Math.ceil(Rr); r++) for (let q = -Math.ceil(Rc); q <= Math.ceil(Rc); q++) {
      const nx = q / Rc, ny = r / Rr, d = Math.hypot(nx, ny); if (d > 1.04) continue;
      const a = Math.atan2(ny, nx); let ch = "", col = "11,37,64";
      if (d > 0.72) { const seg = ((a - theta) % (Math.PI / 4) + Math.PI / 4) % (Math.PI / 4); ch = seg < 0.22 ? "#" : "o"; if (Math.cos(a + 2.2) > 0.85) { ch = "*"; col = "95,211,224"; } }
      else if (Math.abs(Math.sin(a - theta)) * d < 0.13 && d > 0.12) { ch = d > 0.5 ? "=" : "-"; col = "31,111,209"; }
      else if (d > 0.42 && d < 0.56) { ch = ":"; col = "74,96,117"; }
      else if (d < 0.12) { ch = "+"; col = "31,111,209"; }
      if (ch) { c.fillStyle = `rgba(${col},1)`; c.fillText(ch, x + q * cw, y + r * lh); }
    }
    c.restore();
  }
  let celeb = null;
  // word: "HOLD" | "BREAK" | "CALLAHAN?!" | "" (splash only). from/to: {x, y} in the viewport.
  function celebrate(o) {
    if (reduce()) return;
    if (celeb) celeb.cv.remove();
    const cv = document.createElement("canvas"); cv.className = "ascii-celebrate"; cv.setAttribute("aria-hidden", "true");
    document.body.appendChild(cv);
    const fs = 18, flyMs = 1000, postMs = o.word ? 800 : 600, start = performance.now();
    celeb = { cv };
    const frame = now => {
      if (!cv.isConnected) return;
      const { c, w, h } = fit(cv); c.clearRect(0, 0, w, h);
      const el = now - start;
      if (el >= flyMs + postMs) { cv.remove(); if (celeb && celeb.cv === cv) celeb = null; return; }
      const from = o.from || { x: w * 0.3, y: h * 0.6 }, to = o.to || { x: w * 0.8, y: h * 0.1 };
      const ease = q => 1 - Math.pow(1 - q, 2.2), fq = Math.min(1, el / flyMs), e = ease(fq);
      const path = q => ({ x: from.x + (to.x - from.x) * q, y: from.y + (to.y - from.y) * q - Math.sin(q * Math.PI) * Math.min(h * 0.12, 90) });
      c.font = `600 ${fs}px ${MONO}`; c.textAlign = "center"; c.textBaseline = "middle";
      for (let i = 1; i <= 12; i++) { const q = e - i * 0.04; if (q <= 0) break; const pt = path(q); c.fillStyle = `rgba(95,211,224,${0.6 - i * 0.045})`; c.fillText("·", pt.x, pt.y); }
      if (fq < 1) { const pt = path(e); disc(c, pt.x, pt.y, fs, el / 1000 * 1.4 * Math.PI * 2, 1 - 0.35 * e); }
      else {
        const q = Math.min(1, (el - flyMs) / postMs), sq = Math.min(1, q * (o.word ? 2.2 : 1)), r = 70 * Math.sqrt(sq);
        if (sq < 1) {
          for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; c.fillStyle = `rgba(${i % 2 ? "255,197,51" : "95,211,224"},${1 - sq})`; c.fillText(i % 3 ? "*" : "+", to.x + Math.cos(a) * r, to.y + Math.sin(a) * r * 0.8); }
          c.fillStyle = `rgba(15,118,110,${1 - sq})`; c.font = `800 ${fs * 1.3}px ${MONO}`; c.fillText("+1", to.x - 40, to.y + 30 - sq * 20); c.font = `600 ${fs}px ${MONO}`;
        }
        if (o.word) {
          const cal = o.word === "CALLAHAN?!", rows = block(o.word), cols = rows[0].length, bw = Math.min(w, 560);
          const s2 = Math.min((bw - 24) / (cols * 0.6), fs), a = q < 0.75 ? 1 : (1 - q) * 4;
          const tone = o.word === "HOLD" ? "95,211,224" : "255,197,51", y0 = h * 0.42, x0 = (w - cols * s2 * 0.6) / 2;
          c.fillStyle = `rgba(7,26,44,${0.92 * a})`; c.fillRect(0, y0 - s2 * 1.2, w, s2 * 6.6 + fs * 1.9);
          c.font = `700 ${s2}px ${MONO}`; c.textAlign = "left";
          rows.forEach((row, ri) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") { c.fillStyle = `rgba(${tone},${a * (0.78 + 0.22 * Math.sin(i * 0.4 + el * 0.03))})`; c.fillText(cal && Math.random() < 0.5 ? "@" : "#", x0 + i * s2 * 0.6, y0 + ri * s2 * 1.1); } });
          if (o.name) { c.font = `700 ${Math.round(fs * 0.8)}px ${MONO}`; c.textAlign = "center"; c.fillStyle = `rgba(195,214,228,${a})`; c.fillText(cal ? o.name + " takes it in" : o.name, w / 2, y0 + 5 * s2 * 1.1 + fs * 0.9); }
        }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  window.DBAscii = { gateSea, waterline, celebrate, reduce };
})();
