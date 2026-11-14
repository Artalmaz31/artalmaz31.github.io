// How a graph is built: the paper's figure (text/graph_tikz.tex) as one panel that goes through its four steps,
// A initialization, B iterative expansion, C compaction, D aggregation. Positions, clusters, labels and edges are the
// figure's own, in its units (x across the two lanes, y = layer offset from the target); an edge takes the color of
// its source, as in the paper. The step texts live in index.html; this module draws and animates.

import { $$, svg, reducedMotion } from "./util.js";

const W = 600, H = 424, S = 80;                       // px per cm; the figure is drawn at xscale 1.2, yscale 1.25
const X = (x) => 52 + (x + 0.05) * 1.2 * S;
const Y = (y) => 22 + (3.35 - y) * 1.25 * S;
const R_BIG = 15, R_SMALL = 8;
const COL = { txt: [222, 122, 28], img: [45, 108, 223], err: [139, 95, 199] };
const INK = { txt: "#a4520a", img: "#1b4da8", err: "#6a43a3" };

// clusters: one feature at several positions; `at` is the aggregated vertex of panel D
const CL = {
  AN: { s: "txt", m: [[0.70, 2.05], [0.95, 1.95]], at: [0.825, 2], label: "animal name" },
  W0: { s: "txt", m: [[2.00, 1.05], [2.25, 0.95]], at: [2.125, 1] },
  CS: { s: "img", m: [[3.30, 2.12], [3.60, 2.05], [3.48, 1.82]], at: [3.45, 2], label: "cat semantic" },
  EY: { s: "img", m: [[4.85, 1.12], [5.15, 1.05], [5.03, 0.82]], at: [5.00, 1], label: "eyes" },
  WC: { s: "txt", m: [[0.70, 1.05], [0.95, 0.95]], at: [0.825, 1], label: "word cat" },
  FT: { s: "img", m: [[3.30, 1.12], [3.60, 1.05], [3.48, 0.82]], at: [3.45, 1], label: "fur texture" },
  FA: { s: "img", m: [[4.85, 0.12], [5.15, 0.05], [5.03, -0.18]], at: [5.00, 0], label: "face" },
};
const T = [3.10, 3];
// per step A..D: shown (0/1), kind: d = discovered (outlined), x = expanded (filled), e = truncation error
const ST = {
  AN: ["d", "x", "x", "x"], W0: ["d", null, null, null], CS: ["d", "x", "x", "x"], EY: ["d", "x", "x", "x"],
  WC: [null, "d", "e", "e"], FT: [null, "d", "e", "e"], FA: [null, "d", "e", "e"],
};
// edges: from a cluster (every member, or one member) to the target or to a cluster; bend as in the figure (degrees)
const ED = [
  { f: "AN", t: "T", bend: 20 }, { f: "W0", t: "T", bend: 22, dropped: true }, { f: "CS", t: "T" }, { f: "EY", t: "T" },
  { f: "WC", t: "AN" }, { f: "WC", only: 1, t: "CS", bend: 15 }, { f: "FT", t: "CS" }, { f: "FA", t: "EY" },
];

const ease = (x) => x * x * (3 - 2 * x);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (a, b, t) => a.map((v, i) => Math.round(lerp(v, b[i], t)));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const tint = (c, k) => c.map((v) => Math.round(255 - (255 - v) * k));

/** The look of everything at one step (k = 0..3), or the empty start (k = -1): plain numbers, so two looks tween. */
function look(k) {
  const L = {};
  for (const [id, c] of Object.entries(CL)) {
    const kind = k < 0 ? null : ST[id][k];
    const agg = k === 3 ? 1 : 0;
    L[id] = {
      on: kind ? 1 : 0,
      err: kind === "e" ? 1 : 0,
      fill: kind === "x" || kind === "e" ? 1 : 0,
      agg,
      lab: c.label && kind && kind !== "e" ? 1 : 0,
    };
  }
  L.edges = ED.map((e) => {
    const on = k < 0 ? 0 : L[e.f].on && (e.t === "T" || L[e.t].on) ? 1 : 0;
    return { on, err: L[e.f].err, agg: k === 3 ? 1 : 0 };
  });
  return L;
}

/** A cubic from p to q that leaves p turned left by `bend` degrees and enters q turned right by it (TikZ bend left), in
 *  the figure's units (y up); returned in px. */
function cubic(p, q, bend = 0) {
  const dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy), a = Math.atan2(dy, dx), b = (bend * Math.PI) / 180, l = 0.3915 * d;
  const c1 = [p[0] + l * Math.cos(a + b), p[1] + l * Math.sin(a + b)];
  const c2 = [q[0] - l * Math.cos(a - b), q[1] - l * Math.sin(a - b)];
  return [p, c1, c2, q].map(([x, y]) => [X(x), Y(y)]);
}
const at = (P, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => u * u * u * P[0][i] + 3 * u * u * t * P[1][i] + 3 * u * t * t * P[2][i] + t * t * t * P[3][i]);
};
const tangent = (P, t) => {
  const u = 1 - t;
  return [0, 1].map((i) => 3 * u * u * (P[1][i] - P[0][i]) + 6 * u * t * (P[2][i] - P[1][i]) + 3 * t * t * (P[3][i] - P[2][i]));
};
/** The parameter where the curve leaves a circle (start) or enters a box or circle (end), by bisection. */
function clip(P, inside, fromEnd) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    const inn = inside(at(P, fromEnd ? 1 - m : m));
    if (inn) lo = m; else hi = m;
  }
  return fromEnd ? 1 - hi : hi;
}
/** The piece of the curve between t0 and t1 (De Casteljau), as a path. */
function piece(P, t0, t1) {
  const split = (Q, t) => {
    const l = (a, b) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    const a = l(Q[0], Q[1]), b = l(Q[1], Q[2]), c = l(Q[2], Q[3]), d = l(a, b), e = l(b, c), f = l(d, e);
    return [[Q[0], a, d, f], [f, e, c, Q[3]]];
  };
  let Q = split(P, t0)[1];
  Q = split(Q, (t1 - t0) / (1 - t0 || 1))[0];
  const s = (v) => `${v[0].toFixed(1)},${v[1].toFixed(1)}`;
  return `M${s(Q[0])} C${s(Q[1])} ${s(Q[2])} ${s(Q[3])}`;
}

/** Draw the figure between two looks: a (shown before), b (the step being reached), t in [0, 1]. */
function frame(a, b, t) {
  const g = svg("g");
  const v = (id, key) => lerp(a[id][key], b[id][key], t);
  // phases inside one transition: things that leave fade first, edges grow next, new vertices land at the end
  const out = clamp(t / 0.35), grow = clamp((t - 0.15) / 0.55), land = clamp((t - 0.55) / 0.35), morph = ease(clamp((t - 0.1) / 0.8));

  // where every member of every cluster is now, and how big
  const pos = {}, box = {};
  for (const [id, c] of Object.entries(CL)) {
    const agg = lerp(a[id].agg, b[id].agg, morph);
    const r = lerp(R_SMALL, R_BIG, agg);
    pos[id] = c.m.map(([x, y]) => [lerp(X(x), X(c.at[0]), agg), lerp(Y(y), Y(c.at[1]), agg), r]);
    const xs = pos[id].map((p) => p[0]), ys = pos[id].map((p) => p[1]);
    box[id] = { x0: Math.min(...xs) - r - 4, x1: Math.max(...xs) + r + 4, y0: Math.min(...ys) - r - 4, y1: Math.max(...ys) + r + 4, agg };
  }
  const shown = (id) => {
    const on0 = a[id].on, on1 = b[id].on;
    return on0 && on1 ? 1 : on0 ? 1 - ease(out) : on1 ? ease(land) : 0;
  };
  const colorOf = (id) => mix(COL[CL[id].s], COL.err, ease(v(id, "err")));

  // edges, under the vertices
  const ge = svg("g", { class: "bf-edges" });
  const heads = svg("g");
  ED.forEach((e, j) => {
    const ea = a.edges[j], eb = b.edges[j];
    if (!ea.on && !eb.on) return;
    const op = ea.on && eb.on ? 1 : ea.on ? 1 - ease(out) : 1;
    const frac = ea.on ? 1 : ease(grow);          // a new edge is found from the target backward, so it grows from there
    if (op <= 0.01 || frac <= 0.01) return;
    const agg = lerp(ea.agg, eb.agg, morph);
    const col = rgb(mix(COL[CL[e.f].s], COL.err, ease(lerp(ea.err, eb.err, morph))));
    const members = e.only != null ? [e.only] : pos[e.f].map((_, i) => i);
    // the tip stops GAP short of the vertex, or of the dashed box around a cluster
    const GAP = 5;
    const tgtIn = e.t === "T"
      ? (p) => Math.hypot(p[0] - X(T[0]), p[1] - Y(T[1])) < R_BIG + 1 + GAP
      : (p) => { const bx = box[e.t]; return bx.agg > 0.5 ? Math.hypot(p[0] - pos[e.t][0][0], p[1] - pos[e.t][0][1]) < pos[e.t][0][2] + 1 + GAP : p[0] > bx.x0 - GAP && p[0] < bx.x1 + GAP && p[1] > bx.y0 - GAP && p[1] < bx.y1 + GAP; };
    const width = lerp(1.4, 2.6, agg);
    members.forEach((i) => {
      const m = pos[e.f][i];
      const src = [(m[0] - 52) / (1.2 * S) - 0.05, 3.35 - (m[1] - 22) / (1.25 * S)];
      let dst = T;
      if (e.t !== "T") {
        const bx = box[e.t];
        dst = [((bx.x0 + bx.x1) / 2 - 52) / (1.2 * S) - 0.05, 3.35 - ((bx.y0 + bx.y1) / 2 - 22) / (1.25 * S)];
      }
      const P = cubic(src, dst, lerp(e.bend || 0, (e.bend || 0) * 0.7, agg));
      const t0 = clip(P, (p) => Math.hypot(p[0] - m[0], p[1] - m[1]) < m[2] + 1, false);
      const t1 = clip(P, tgtIn, true);
      if (t1 <= t0) return;
      const ts = lerp(t1, t0, frac);              // grows from the target end toward the source
      // members of an aggregated cluster draw one edge: the others fade into it
      const mo = members.length > 1 && i > 0 ? 1 - agg : 1;
      const done = frac > 0.98 || ts === t1;
      const tip = at(P, t1), d = tangent(P, t1), n = Math.hypot(d[0], d[1]) || 1, ux = d[0] / n, uy = d[1] / n;
      const len = 5.2 + 1.8 * width, hw = 2.2 + 0.9 * width;
      // a finished edge ends just inside its head's base, so the round cap never shows past the tip
      const tb = done ? Math.max(ts, t1 - (len - 0.6) / n) : t1;
      ge.append(svg("path", { d: piece(P, ts, tb), fill: "none", stroke: col, "stroke-width": width, "stroke-dasharray": e.dropped ? "5 4" : null,
        opacity: (op * mo * (e.dropped ? 0.75 : 0.9)).toFixed(3), "stroke-linecap": "round" }));
      if (done) {
        heads.append(svg("path", { d: `M${tip[0]},${tip[1]} L${tip[0] - ux * len - uy * hw},${tip[1] - uy * len + ux * hw} L${tip[0] - ux * len + uy * hw},${tip[1] - uy * len - ux * hw}Z`,
          fill: col, opacity: (op * mo).toFixed(3) }));
      } else {
        // the growing front
        const f = at(P, ts);
        heads.append(svg("circle", { cx: f[0], cy: f[1], r: 2.4, fill: col, opacity: op.toFixed(3) }));
      }
    });
  });
  g.append(ge, heads);

  // clusters: a dashed box around the positions of one feature (gone once they are aggregated), and the vertices
  const gv = svg("g");
  for (const [id, c] of Object.entries(CL)) {
    const o = shown(id);
    if (o <= 0.01) continue;
    const col = colorOf(id), err = v(id, "err"), fill = v(id, "fill");
    const bx = box[id];
    if (pos[id].length > 1 && bx.agg < 0.98) {
      gv.append(svg("rect", { x: bx.x0, y: bx.y0, width: bx.x1 - bx.x0, height: bx.y1 - bx.y0, rx: 4, fill: "none", stroke: rgb(tint(col, 0.75)),
        "stroke-width": 1.2, "stroke-dasharray": "4 3", opacity: (o * (1 - bx.agg)).toFixed(3) }));
    }
    const face = rgb(mix([255, 255, 255], tint(col, err > 0.5 ? 0.32 : 0.62), fill));
    pos[id].forEach(([x, y, r], i) => {
      const pop = a[id].on ? 1 : lerp(0.4, 1, ease(land));
      gv.append(svg("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: (r * pop).toFixed(2), fill: face, stroke: rgb(col), "stroke-width": 1.8,
        "stroke-dasharray": err > 0.5 ? "3 2.4" : null, opacity: (i > 0 && bx.agg > 0.98 ? 0 : o).toFixed(3) }));
    });
    const lab = v(id, "lab") * o;
    if (c.label && lab > 0.01) {
      const cx = (bx.x0 + bx.x1) / 2;
      gv.append(svg("text", { x: cx.toFixed(1), y: (bx.y0 - 6).toFixed(1), "text-anchor": "middle", class: "bf-name", fill: INK[c.s], opacity: lab.toFixed(3) }, c.label));
    }
  }
  g.append(gv);
  return g;
}

function base() {
  const g = svg("g");
  g.append(
    svg("rect", { x: X(-0.05), y: Y(3.35), width: X(2.7) - X(-0.05), height: Y(-0.5) - Y(3.35), class: "lane-txt", rx: 8 }),
    svg("rect", { x: X(2.7) + 3, y: Y(3.35), width: X(5.45) - X(2.7) - 3, height: Y(-0.5) - Y(3.35), class: "lane-img", rx: 8 }),
  );
  ["ℓ − 3", "ℓ − 2", "ℓ − 1", "ℓ"].forEach((l, y) => {
    g.append(svg("line", { x1: X(-0.05), x2: X(5.45), y1: Y(y), y2: Y(y), class: "bf-guide" }));
    g.append(svg("text", { x: X(-0.05) - 8, y: Y(y) + 5, "text-anchor": "end", class: "bf-layer" }, l));
  });
  g.append(
    svg("text", { x: X(-0.05) + 12, y: Y(-0.5) - 10, class: "lane-label txt" }, "text stream"),
    svg("text", { x: X(5.45) - 12, y: Y(-0.5) - 10, "text-anchor": "end", class: "lane-label img" }, "image stream"),
  );
  return g;
}

function target() {
  return svg("g", {},
    svg("circle", { cx: X(T[0]), cy: Y(T[1]), r: R_BIG, fill: "var(--img)", stroke: "var(--img-ink)", "stroke-width": 3 }),
    svg("text", { x: X(T[0]) + R_BIG + 7, y: Y(T[1]) + 5, class: "bf-name bf-target" }, "cat eyes"));
}

export function mountBuildFigure(fig) {
  const stage = fig.querySelector(".bf-stage");
  const buttons = $$("button[data-step]", fig);
  const replay = fig.querySelector(".bf-replay");
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "bf-svg", role: "img",
    "aria-label": "An attribution graph being built for the image-stream feature cat eyes at layer ℓ: text-stream sources on the left, image-stream sources on the right, one row per layer." });
  const layer = svg("g");
  root.append(base(), layer, target());
  stage.replaceChildren(root);

  const still = reducedMotion();
  let shown = look(-1), step = -1, raf = 0, timer = 0, auto = false;
  const mark = () => buttons.forEach((b, i) => {
    b.setAttribute("aria-pressed", i === step ? "true" : "false");
    b.closest("li").classList.toggle("done", i < step);
  });
  function go(k, { user = false } = {}) {
    if (user) stopAuto();
    const from = shown, to = look(k);
    step = k;
    mark();
    cancelAnimationFrame(raf);
    if (still) {
      layer.replaceChildren(frame(to, to, 1));
      shown = to;
      return;
    }
    const t0 = performance.now(), dur = 1400;
    const tick = (now) => {
      const t = clamp((now - t0) / dur);
      layer.replaceChildren(frame(from, to, t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else shown = to;
    };
    raf = requestAnimationFrame(tick);
  }
  function stopAuto() {
    auto = false;
    clearTimeout(timer);
    if (replay) replay.hidden = false;
  }
  function play() {
    auto = true;
    if (replay) replay.hidden = true;
    shown = look(-1);
    let k = 0;
    const next = () => {
      if (!auto) return;
      go(k);
      k += 1;
      if (k < 4) timer = setTimeout(next, 4200);
      else timer = setTimeout(() => { auto = false; if (replay) replay.hidden = false; }, 1600);
    };
    next();
  }
  buttons.forEach((b, i) => b.addEventListener("click", () => go(i, { user: true })));
  if (replay) replay.addEventListener("click", () => play());

  if (still || !("IntersectionObserver" in window)) {
    go(0);
    if (replay) replay.hidden = true;
    return;
  }
  layer.replaceChildren(frame(shown, shown, 1));
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) {
      io.disconnect();
      play();
    }
  }, { threshold: 0.45 });
  io.observe(stage);
}
