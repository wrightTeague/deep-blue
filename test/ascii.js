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

  // ---------- a tentacle in the water (Roster) ----------
  // Blue arms reach up from the bottom of the part of the navy water that's on screen, sway, and
  // every 8–16 s one reaches for a name or heading, wraps its tip round it, glows cyan, tugs it
  // toward its base and lets it spring back. Two canvases cover the screen inside the deep: one
  // behind the content and one in front for the bits of the coil that pass over the word.
  function tentacle(opt) {
    const o = Object.assign({ arms: [[0.86, -1]], speed: 0.7, reach: 0.8, curl: 1, size: 7, targets: ".zchip, .zone-h b", bottomInset: 0 }, opt);
    const back = document.createElement("canvas"), front = document.createElement("canvas");
    back.className = "ascii-tent"; front.className = "ascii-tent front";
    [back, front].forEach(cv => cv.setAttribute("aria-hidden", "true"));
    const BLUE = [[15, 59, 94], [31, 111, 209], [95, 211, 224]], CYAN = [[19, 74, 116], [95, 211, 224], [190, 248, 255]];
    const mix = (a, b, k) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * k));
    const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
    const smooth = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    let deepEl = null, grab = null, nextGrab = 0, started = performance.now() / 1000;
    nextGrab = started + 5;
    function release() { if (!grab) return; const el = grab.el; el.style.transform = ""; el.classList.remove("held"); setTimeout(() => el.classList.remove("tgrab"), 700); grab = null; }
    function draw(t) {
      const B = fit(back), F = fit(front), c = B.c, w = B.w, h = B.h;
      c.clearRect(0, 0, w, h); F.c.clearRect(0, 0, w, h);
      if (!deepEl || !deepEl.isConnected) return;
      const dr = deepEl.getBoundingClientRect();
      const top = Math.max(0, dr.top), bottom = Math.min(h - o.bottomInset, dr.bottom);
      if (bottom - top < 80) { release(); return; }
      const fs = o.size, cw = fs * 0.6, lh = fs * 1.1, cols = Math.ceil(w / cw), rows = Math.ceil((bottom - top) / lh), T = t * o.speed;
      const N = 24, reach = o.reach * (rows / 22);
      const cells = new Map();   // only the cells the arms cover
      const left = Math.max(0, dr.left) / cw, span = (Math.min(w, dr.right) - Math.max(0, dr.left)) / cw;
      const arms = o.arms.map(([ax, dir]) => [left + ax * span, dir]);
      // grab timeline: reach 1.3 s, wrap 0.7 s, tug 1.8 s, let go 1.2 s
      if (grab && !grab.el.isConnected) grab = null;
      if (!grab && t >= nextGrab) {
        const els = [...deepEl.querySelectorAll(o.targets)].filter(el => { const r = el.getBoundingClientRect(); return r.top > top + 10 && r.bottom < bottom - 30 && r.width > 0; });
        const pick = els[Math.floor(Math.random() * els.length)];
        if (pick) {
          const r = pick.getBoundingClientRect(), tx = (r.left + r.width / 2) / cw, ty = (r.top - top + r.height / 2) / lh;
          let best = 0, bd = 1e9; arms.forEach(([x], k) => { const d = Math.abs(x - tx); if (d < bd) { bd = d; best = k; } });
          grab = { el: pick, t0: t, tx, ty, arm: best }; pick.classList.add("tgrab", "held");
        } else nextGrab = t + 4;
      }
      let g = 0, wrap = 0, pull = 0;
      if (grab) {
        const pt = t - grab.t0;
        g = pt < 1.3 ? smooth(pt / 1.3) : pt < 3.6 ? 1 : 1 - smooth((pt - 3.6) / 1.2);
        wrap = pt < 1.1 ? 0 : pt < 1.8 ? smooth((pt - 1.1) / 0.7) : pt < 3.6 ? 1 : 1 - smooth((pt - 3.6) / 0.4);
        pull = pt < 1.8 || pt >= 3.6 ? 0 : smooth((pt - 1.8) / 0.6) * (1 + 0.12 * Math.sin((pt - 1.8) * 9));
        const bx = arms[grab.arm][0], by = rows + 1;
        const vx = (bx - grab.tx) * cw, vy = (by - grab.ty) * lh, vl = Math.hypot(vx, vy) || 1;
        const px = vx / vl * 26 * pull, py = vy / vl * 26 * pull;
        grab.cx = grab.tx + px / cw; grab.cy = grab.ty + py / lh;
        if (pt < 3.6) grab.el.style.transform = pull ? `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) rotate(${(Math.sign(vx) * pull * 7).toFixed(1)}deg)` : "";
        else if (grab.el.classList.contains("held")) { grab.el.classList.remove("held"); grab.el.style.transform = ""; }
        if (pt > 4.9) { const el = grab.el; setTimeout(() => el.classList.remove("tgrab"), 700); grab = null; nextGrab = t + 8 + Math.random() * 8; }
      }
      const put = (x, y, s, rgb, fr) => { if (x < 0 || y < 0 || x >= cols || y >= rows) return; cells.set(y * cols + x, [s, rgb, fr]); };
      arms.forEach(([ax, dir], k) => {
        const me = grab && grab.arm === k, G = me ? g : 0, tone = BLUE.map((c0, j) => mix(c0, CYAN[j], G));
        const pts = []; let x = ax, y = rows + 1; const ang = -Math.PI / 2 + dir * 0.25;
        const pulse = 0.33 + 0.67 * Math.sin(T * 0.5 + k * 1.7);
        let step = reach;
        if (me) { const need = Math.hypot((grab.cx - x) / 1.7, (grab.cy - y) / 0.85) / (N * 0.82); step = reach + G * Math.max(0, Math.min(reach * 1.8, need * 1.08) - reach); }
        let contact = -1;
        for (let i = 0; i < N; i++) {
          const u = i / (N - 1);
          let a = ang + Math.sin(u * 3.2 - T * 2.1 + k * 0.9) * 0.7 * u * (1 - G * 0.7) + dir * u * u * u * 2.2 * o.curl * pulse * (1 - G);
          if (me) {
            if (contact < 0) {
              const aT = Math.atan2((grab.cy - y) / 0.85, (grab.cx - x) / 1.7);
              a += angDiff(a, aT) * G * Math.min(1, 0.35 + u * 1.4);
              if (Math.hypot((grab.cx - x) / 1.7, (grab.cy - y) / 0.85) < 2.4 && G > 0.85) contact = i;
            } else a = pts[i - 1].a + dir * 1.15 * wrap + (1 - wrap) * angDiff(pts[i - 1].a, a);
          }
          pts.push({ x, y, u, a, wrapped: me && contact >= 0 && i > contact, G });
          x += Math.cos(a) * 1.7 * step; y += Math.sin(a) * 0.85 * step;
        }
        for (let i = N - 1; i >= 0; i--) {
          const p = pts[i], r = Math.max((1.6 * (1 - p.u) + 0.35) * Math.min(2, Math.max(0.8, reach * 0.9)), p.G * 0.95), shade = mix(tone[0], tone[1], 0.35 + 0.65 * (1 - p.u));
          const fr = p.wrapped && i % 3 !== 0;
          for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r * 2); dx <= Math.ceil(r * 2); dx++) {
            const e = (dx / (2 * r)) ** 2 + (dy / r) ** 2; if (e > 1) continue;
            const lower = dy > 0 ? 0.75 : 1;
            put(Math.round(p.x + dx), Math.round(p.y + dy), e > 0.56 ? "▓" : "█", shade.map(v => Math.round(v * lower)), fr);
          }
          if (i % 2 === 0 && i < N - 3) { const nx = -Math.sin(p.a) * dir, ny = Math.cos(p.a) * dir; put(Math.round(p.x + nx * r * 2), Math.round(p.y + ny * r), "o", tone[2], fr); }
        }
      });
      [c, F.c].forEach(cx => { cx.save(); cx.beginPath(); cx.rect(Math.max(0, dr.left), top, Math.min(w, dr.right) - Math.max(0, dr.left), bottom - top); cx.clip(); cx.font = `700 ${fs}px ${MONO}`; cx.textBaseline = "top"; });
      for (const [i, [s, rgbv, fr]] of cells) {
        const cx = fr ? F.c : c, X = (i % cols) * cw, Y = top + Math.floor(i / cols) * lh, [r, g2, b] = rgbv;
        if (s === "o") { cx.fillStyle = `rgb(${r},${g2},${b})`; cx.fillText(s, X, Y); }
        else { cx.fillStyle = `rgba(${r},${g2},${b},${s === "█" ? 0.92 : 0.65})`; cx.fillRect(X, Y, cw + 0.5, lh + 0.5); }
      }
      c.restore(); F.c.restore();
    }
    return {
      // Move the arm into this page's water (each redraw builds a new one) or take it out.
      place(el) {
        if (!el) { release(); back.remove(); front.remove(); deepEl = null; return; }
        deepEl = el;
        if (back.parentNode !== el) { el.insertBefore(back, el.querySelector(".deep-in")); el.appendChild(front); }
        if (![...items].some(it => it.cv === back)) add(back, draw, 20); else kick();
      },
      destroy() { release(); back.remove(); front.remove(); },
    };
  }

  window.DBAscii = { gateSea, waterline, celebrate, reduce, tentacle };
})();
