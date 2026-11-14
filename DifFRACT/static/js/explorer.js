// The attribution-graph explorer. Rows are layers (the target at the top), the left lane is the text stream and the
// right lane the image stream. A feature of the text stream is a dot over the token it fires on most, a feature of the
// image stream a dot placed, left to right, where it fires in the image, so the graph can be read without names.
// Hovering a feature lights it on the image and the prompt; clicking it shows its corpus examples, its inputs and its
// outputs. With nothing selected, the panel shows the corpus examples of the target.
// The graph, the selection and the groups of a figure are mirrored in the address: ?graph=dog-couch&sel=L7/txt/17694

import { el, put, svg, getJSON, b64bytes, heatImage, signed } from "./util.js";
import { cardBody } from "./featcard.js";

const INDEX = () => getJSON("static/data/graphs/index.json");
const keyOf = (n) => (n.k === "f" ? `L${n.l}/${n.s}/${n.f}` : n.k === "e" ? `E/L${n.l}/${n.s}` : `IN/${n.s}`);
const nameOf = (n) => n.lab || (n.k === "f" ? `feature ${n.f}` : n.k === "e" ? `MLP error, layer ${n.l} ${n.s === "img" ? "image" : "text"}` : n.s === "img" ? "noisy latent (image input)" : "T5 embeddings (text input)");
const tokWord = (t) => (t === "</s>" ? "end" : t.trim());

let dlg, state;
// the explorer becomes one scrolling column below this width (site.css)
const NARROW = matchMedia("(max-width: 1000px)");

/** Width of a name in the font of .xlabel.named, measured once per name. */
const widths = new Map();
let measureCtx;
function nameWidth(text) {
  if (!widths.has(text)) {
    measureCtx ||= document.createElement("canvas").getContext("2d");
    measureCtx.font = `italic 500 12.5px ${getComputedStyle(document.documentElement).getPropertyValue("--serif") || "serif"}`;
    widths.set(text, measureCtx.measureText(text).width);
  }
  return widths.get(text);
}

function topToken(n, ntok) {
  const best = n.toks && n.toks[0];
  if (n.pad && (!best || n.pad[1] > best[1])) return ntok;
  return best ? best[0] : ntok;
}

function build() {
  if (dlg) return;
  dlg = el("dialog.explorer", { "aria-label": "Attribution graph explorer" });
  dlg.addEventListener("close", () => {
    history.replaceState(null, "", location.pathname + location.hash);
    document.documentElement.classList.remove("ex-open");
  });
  document.body.append(dlg);
}

function writeAddress() {
  const p = new URLSearchParams();
  p.set("graph", state.id);
  if (state.sel != null) p.set("sel", keyOf(state.g.nodes[state.sel]));
  if (state.groups.length) p.set("groups", state.groups.map((g) => `${g.label}:${g.keys.join(",")}`).join("|"));
  history.replaceState(null, "", "?" + p.toString().replace(/%2F/g, "/").replace(/%3A/g, ":").replace(/%2C/g, ",").replace(/%7C/g, "|") + location.hash);
}

export async function openFromAddress() {
  const p = new URLSearchParams(location.search);
  const groups = (p.get("groups") || "").split("|").filter(Boolean).map((s) => {
    const [label, keys] = s.split(":");
    return { label, keys: (keys || "").split(",").filter(Boolean) };
  });
  return openExplorer({ graph: p.get("graph"), sel: p.get("sel"), groups });
}

export async function openExplorer({ graph, sel = null, groups = [] }) {
  build();
  if (!dlg.open) dlg.showModal();
  document.documentElement.classList.add("ex-open");
  put(dlg, el("p.state", "Loading the graph…"));
  try {
    const index = await INDEX();
    const row = index.find((r) => r.id === graph) || index[0];
    const g = await getJSON(`static/data/graphs/${row.id}.json`);
    state = { id: row.id, row, g, index, groups, sel: null, hover: null, budget: 70, edges: 140, showErrors: false };
    prepare();
    if (sel) {
      const i = g.nodes.findIndex((n) => keyOf(n) === sel);
      if (i >= 0) state.sel = i;
    }
    render();
  } catch (err) {
    console.error(err);
    put(dlg, el("p.state.state-error", "The graph could not be loaded. ", el("button.linkish", { type: "button", onclick: () => openExplorer({ graph, sel, groups }) }, "Try again"), " or ",
      el("button.linkish", { type: "button", onclick: () => dlg.close() }, "close")));
  }
}

function prepare() {
  const { g } = state;
  const N = g.nodes.length;
  state.out = Array.from({ length: N }, () => []);
  state.inc = Array.from({ length: N }, () => []);
  for (const [a, b, w] of g.edges) {
    state.out[a].push([b, w]);
    state.inc[b].push([a, w]);
  }
  state.rank = new Map(g.nodes.map((n, i) => [i, n]).filter(([, n]) => n.k === "f" && !n.tgt).sort((p, q) => q[1].inf - p[1].inf).map(([i], r) => [i, r + 1]));
  state.nfeat = state.rank.size;
  state.byKey = new Map(g.nodes.map((n, i) => [keyOf(n), i]));
  state.groupOf = new Map();
  state.groups.forEach((gr, j) => gr.keys.forEach((k) => state.byKey.has(k) && state.groupOf.set(state.byKey.get(k), j)));
}

function visibleSet() {
  const { g, rank, budget, sel, groupOf, showErrors } = state;
  const vis = new Set();
  g.nodes.forEach((n, i) => {
    if (n.tgt || n.k === "i" || groupOf.has(i) || i === sel) vis.add(i);
    else if (n.k === "f" && rank.get(i) <= budget) vis.add(i);
    else if (n.k === "e" && showErrors) vis.add(i);
  });
  if (sel != null) {
    const near = [...state.inc[sel], ...state.out[sel]].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 14);
    near.forEach(([j]) => (g.nodes[j].k !== "e" || showErrors) && vis.add(j));
  }
  return vis;
}

/** `fitH`: the height the graph should fill (0 on a narrow screen, where the explorer scrolls as one column). */
function layout(vis, W, fitH = 0) {
  const { g } = state;
  const tgt = g.nodes[g.target];
  const top = tgt.l, fitRow = (fitH - 28 - 44) / (top + 2);
  const rowH = fitH ? Math.max(26, Math.min(120, fitRow)) : Math.max(40, Math.min(54, 680 / (top + 2)));
  const y0 = 28, H = y0 + (top + 2) * rowH + 44;
  const padL = 40, gap = 14;
  const ntxt = [...vis].filter((i) => g.nodes[i].s === "txt").length, nimg = vis.size - ntxt;
  const fr = Math.max(0.34, Math.min(0.66, Math.sqrt(ntxt + 1) / (Math.sqrt(ntxt + 1) + Math.sqrt(nimg + 1))));
  const inner = W - padL - 12 - gap;
  const lane = { txt: [padL, padL + inner * fr], img: [padL + inner * fr + gap, W - 12] };
  const y = (l) => y0 + (top - l) * rowH + rowH / 2;
  const maxInf = Math.max(...g.nodes.filter((n) => n.k === "f" && !n.tgt).map((n) => n.inf), 1e-9);
  const size = (n) => (n.tgt ? 1 : n.k === "f" ? Math.sqrt(Math.min(1, n.inf / maxInf)) : 0.3);
  const radius = (n) => (n.k !== "f" ? 6 : 3.5 + 6.5 * size(n));
  const ntok = g.tokens.length, cols = ntok + 1;
  const pos = new Map();
  const rows = new Map();
  for (const i of vis) {
    const n = g.nodes[i];
    const k = `${n.s}|${n.l}`;
    (rows.get(k) || rows.set(k, []).get(k)).push(i);
  }
  for (const [k, list] of rows) {
    const [s, l] = k.split("|");
    const [x0, x1] = lane[s], w = x1 - x0 - 16;
    // where each vertex wants to be: over its token, or where it fires in the image
    const want = list.map((i) => {
      const n = g.nodes[i];
      if (s === "txt") {
        const c = n.k === "f" ? topToken(n, ntok) : cols / 2 - 0.5;
        return { i, x: x0 + 8 + ((c + 0.5) / cols) * w, r: radius(n) };
      }
      return { i, x: x0 + 8 + (n.x ?? 0.5) * w, r: radius(n) };
    }).sort((a, b) => a.x - b.x || g.nodes[b.i].inf - g.nodes[a.i].inf);
    // a crowded row shrinks its vertices until they fit side by side
    const pad = 1.5;
    const need = want.reduce((t, v) => t + 2 * v.r + pad, 0);
    const f = need > w ? Math.max(0.35, w / need) : 1;
    want.forEach((v) => (v.r *= f));
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 1; j < want.length; j++) {
        const d = want[j - 1].r + want[j].r + pad * f;
        if (want[j].x - want[j - 1].x < d) want[j].x = want[j - 1].x + d;
      }
      const last = want[want.length - 1];
      const over = last.x + last.r - (x1 - 6);
      if (over > 0) {
        want.forEach((v) => (v.x -= over));
        for (let j = want.length - 2; j >= 0; j--) {
          const d = want[j].r + want[j + 1].r + pad * f;
          if (want[j + 1].x - want[j].x < d) want[j].x = want[j + 1].x - d;
        }
      }
    }
    want.forEach((v) => pos.set(v.i, { x: v.x, y: y(+l), r: v.r }));
  }
  return { pos, lane, y, H, rowH, top, cols, ntok, y0 };
}

function drawGraph(host) {
  const { g } = state;
  // the graph fills the canvas inside its padding, so it never scrolls on a desktop screen
  const cs = getComputedStyle(host);
  const inner = (a, b, n) => Math.floor(n - parseFloat(cs[a]) - parseFloat(cs[b]));
  const W = Math.max(NARROW.matches ? 520 : 440, inner("paddingLeft", "paddingRight", host.clientWidth || 816));
  const fitH = NARROW.matches ? 0 : inner("paddingTop", "paddingBottom", host.clientHeight);
  const vis = visibleSet();
  const L = layout(vis, W, Math.max(0, fitH));
  state.L = L;
  const root = svg("svg", { viewBox: `0 0 ${W} ${L.H}`, width: W, height: L.H, class: "xgraph", role: "group", "aria-label": "Attribution graph" });
  root.append(
    svg("rect", { x: L.lane.txt[0], y: 22, width: L.lane.txt[1] - L.lane.txt[0], height: L.H - 28, rx: 10, class: "lane lane-txt" }),
    svg("rect", { x: L.lane.img[0], y: 22, width: L.lane.img[1] - L.lane.img[0], height: L.H - 28, rx: 10, class: "lane lane-img" }),
    svg("text", { x: L.lane.txt[0] + 4, y: 14, class: "lane-label txt" }, "text stream"),
    svg("text", { x: L.lane.img[0] + 4, y: 14, class: "lane-label img" }, "image stream"),
  );
  for (let l = L.top; l >= -1; l--) root.append(svg("text", { x: 30, y: L.y(l) + 4, class: "xrow", "text-anchor": "end" }, l < 0 ? "in" : `L${l}`));
  const colW = (L.lane.txt[1] - L.lane.txt[0] - 16) / L.cols, fitc = Math.max(2, Math.floor(colW / 6.2));
  const short = (w) => (w.length > fitc ? w.slice(0, Math.max(1, fitc - 1)) + "…" : w);
  g.tokens.forEach((t, c) => {
    const w = tokWord(t);
    if (w) root.append(svg("text", { x: L.lane.txt[0] + 8 + c * colW + colW / 2, y: L.H - 14, class: "xtok", "text-anchor": "middle" }, short(w), svg("title", {}, w)));
  });
  root.append(svg("text", { x: L.lane.txt[0] + 8 + L.ntok * colW + colW / 2, y: L.H - 14, class: "xtok", "text-anchor": "middle" }, short("padding"), svg("title", {}, "padding positions")));
  root.append(svg("text", { x: (L.lane.img[0] + L.lane.img[1]) / 2, y: L.H - 14, class: "xtok", "text-anchor": "middle" }, L.lane.img[1] - L.lane.img[0] < 230 ? "← left, right →" : "left ← where it fires in the image → right"));

  // edges: the strongest among the visible vertices; with a selection, its own edges in full
  const sel = state.sel;
  let edges = g.edges.filter(([a, b]) => vis.has(a) && vis.has(b));
  const maxW = Math.max(...edges.map((e) => Math.abs(e[2])), 1e-9);
  edges.sort((p, q) => Math.abs(q[2]) - Math.abs(p[2]));
  const mine = sel == null ? [] : edges.filter(([a, b]) => a === sel || b === sel);
  const rest = edges.filter(([a, b]) => a !== sel && b !== sel).slice(0, state.edges);
  const ge = svg("g", { class: "xedges" + (sel != null ? " dim" : "") });
  const path = ([a, b, w], cls) => {
    const p = L.pos.get(a), q = L.pos.get(b);
    const my = (p.y + q.y) / 2;
    return svg("path", { d: `M${p.x},${p.y} C${p.x},${my} ${q.x},${my} ${q.x},${q.y}`, class: `xe ${w >= 0 ? "pos" : "neg"} ${cls}`,
      "stroke-width": (0.6 + 3.4 * Math.sqrt(Math.abs(w) / maxW)).toFixed(2), opacity: cls ? 0.9 : (0.12 + 0.6 * Math.sqrt(Math.abs(w) / maxW)).toFixed(2) },
      svg("title", {}, `${nameOf(g.nodes[a])} → ${nameOf(g.nodes[b])}: ${signed(w)}`));
  };
  rest.forEach((e) => ge.append(path(e, "")));
  mine.forEach((e) => ge.append(path(e, "mine")));
  root.append(ge);

  const near = new Set(mine.flatMap(([a, b]) => [a, b]));
  // names: one per name and row, on its most influential feature; a vertex without a name is read from its place
  const labelled = new Set();
  const seen = new Set();
  [...vis].filter((i) => g.nodes[i].lab || g.nodes[i].tgt).sort((a, b) => (g.nodes[b].tgt ? 1 : 0) - (g.nodes[a].tgt ? 1 : 0) || g.nodes[b].inf - g.nodes[a].inf).forEach((i) => {
    const n = g.nodes[i], k = `${n.s}|${n.l}|${n.lab}`;
    if (n.tgt || !seen.has(k)) labelled.add(i);
    seen.add(k);
  });
  const gn = svg("g", { class: "xnodes" });
  const order = [...vis].sort((a, b) => g.nodes[a].inf - g.nodes[b].inf);
  const far = (i) => sel != null && i !== sel && !near.has(i);
  for (const i of order) {
    const n = g.nodes[i], p = L.pos.get(i);
    const node = svg("g", {
      class: `xn ${n.s} k-${n.k}${n.tgt ? " target" : ""}${i === sel ? " sel" : ""}${far(i) ? " far" : ""}${state.groupOf.has(i) ? " grouped" : ""}`,
      transform: `translate(${p.x},${p.y})`, tabindex: 0, role: "button", "aria-label": `${nameOf(n)}, ${n.s === "img" ? "image" : "text"} stream${n.l >= 0 ? ", layer " + n.l : ""}`,
    }, svg("title", {}, nameOf(n)));
    if (n.k === "e") node.append(svg("rect", { x: -4, y: -4, width: 8, height: 8, transform: "rotate(45)", class: "xerr" }));
    else if (n.k === "i") node.append(svg("rect", { x: -6, y: -6, width: 12, height: 12, rx: 2, class: "xin" }));
    else node.append(svg("circle", { r: p.r, class: "xdot" }));
    node.addEventListener("mouseenter", () => setHover(i));
    node.addEventListener("mouseleave", () => setHover(null));
    node.addEventListener("focus", () => setHover(i));
    node.addEventListener("click", () => select(i === state.sel ? null : i));
    node.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(i)));
    gn.append(node);
  }
  root.append(gn);

  // names: placed where they cover no other dot and no other name (right, left, above, below of the dot); a name that
  // fits nowhere is left out, and the dot still shows it on hover
  const gl = svg("g", { class: "xlabels" });
  const boxes = [];
  const dots = [...vis].map((i) => L.pos.get(i));
  const hits = (b, own) => boxes.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1])
    || dots.some((d) => d !== own && b[0] < d.x + d.r && b[2] > d.x - d.r && b[1] < d.y + d.r && b[3] > d.y - d.r)
    || b[0] < 2 || b[2] > W - 2 || b[1] < 20 || b[3] > L.H - 26;
  const want = [...labelled, ...(sel != null && !labelled.has(sel) ? [sel] : [])]
    .sort((a, b) => (g.nodes[b].tgt ? 2 : b === sel ? 1 : 0) - (g.nodes[a].tgt ? 2 : a === sel ? 1 : 0) || g.nodes[b].inf - g.nodes[a].inf);
  for (const i of want) {
    const n = g.nodes[i], p = L.pos.get(i);
    const text = n.lab ? (n.tgt ? `${n.lab}, the target` : n.lab) : n.tgt || i === sel ? nameOf(n) + (n.tgt ? ", the target" : "") : "";
    if (!text) continue;
    const w = nameWidth(text), r = p.r + 3;
    const spots = [
      [p.x + r, p.y + 4, "start", [p.x + r - 1, p.y - 8, p.x + r + w + 1, p.y + 5]],
      [p.x - r, p.y + 4, "end", [p.x - r - w - 1, p.y - 8, p.x - r + 1, p.y + 5]],
      [p.x, p.y - r - 2, "middle", [p.x - w / 2 - 1, p.y - r - 14, p.x + w / 2 + 1, p.y - r + 1]],
      [p.x, p.y + r + 10, "middle", [p.x - w / 2 - 1, p.y + r - 1, p.x + w / 2 + 1, p.y + r + 13]],
      [p.x - p.r, p.y - r - 2, "start", [p.x - p.r - 1, p.y - r - 14, p.x - p.r + w + 1, p.y - r + 1]],
      [p.x + p.r, p.y - r - 2, "end", [p.x + p.r - w - 1, p.y - r - 14, p.x + p.r + 1, p.y - r + 1]],
      [p.x - p.r, p.y + r + 10, "start", [p.x - p.r - 1, p.y + r - 1, p.x - p.r + w + 1, p.y + r + 13]],
      [p.x + p.r, p.y + r + 10, "end", [p.x + p.r - w - 1, p.y + r - 1, p.x + p.r + 1, p.y + r + 13]],
    ];
    let spot = spots.find((c) => !hits(c[3], p));
    if (!spot && (n.tgt || i === sel)) spot = spots.find((c) => c[3][0] >= 2 && c[3][2] <= W - 2) || spots[0];
    if (!spot) continue;
    boxes.push(spot[3]);
    gl.append(svg("text", { x: spot[0], y: spot[1], "text-anchor": spot[2], class: `xlabel named${far(i) ? " far" : ""}` }, text));
  }
  root.append(gl);
  put(host, root);
}

function setHover(i) {
  state.hover = i;
  paintStage();
}

function paintStage() {
  const { g, stage } = state;
  const i = state.hover ?? state.sel ?? g.target;
  const n = g.nodes[i];
  if (stage.heat) stage.heat.set(n.map ? b64bytes(n.map) : null, n.tgt && !n.map ? undefined : {});
  const acts = new Map(n.toks || []);
  const max = Math.max(1e-9, ...acts.values());
  stage.toks.forEach((c, j) => {
    if (!c) return;
    const a = (acts.get(j) || 0) / max;
    c.style.setProperty("--a", a >= 0.08 ? a.toFixed(2) : 0);
    if (c.classList.contains("tok-end")) c.hidden = a < 0.08;   // the end token only where the feature fires on it
  });
  stage.cap.textContent = n.k !== "f" ? nameOf(n) + (n.k === "e" ? ": what the transcoder of this layer does not reconstruct." : ": the embeddings that enter block 0.")
    : `${nameOf(n)}${n.tgt ? " (the target)" : ""}: ${n.map ? "where it fires in the image" : acts.size ? "the tokens it fires on" : "fires on padding positions only"}.`;
}

function listEdges(list, title, total) {
  const { g } = state;
  const rows = list.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
  if (!rows.length) return null;
  const max = Math.abs(rows[0][1]);
  const n = Math.max(total || 0, list.length);
  return el("div.xlist", el("h5", n > rows.length ? `${title}, the ${rows.length} strongest of ${n}` : `${title} (${n})`), el("ul", rows.map(([j, w]) =>
    el("li", el("button", { type: "button", onclick: () => select(j), onmouseenter: () => setHover(j), onmouseleave: () => setHover(null) },
      el("span.nm" + (g.nodes[j].lab ? ".named" : ""), nameOf(g.nodes[j]), g.nodes[j].k === "f" ? el("small", ` L${g.nodes[j].l} ${g.nodes[j].s}`) : null),
      el("span.bar", el("i." + (w >= 0 ? "pos" : "neg"), { style: { width: `${(Math.abs(w) / max) * 100}%` } })), el("span.w", signed(w)))))));
}

function drawPanel() {
  const { g, panel } = state;
  const i = state.sel;
  if (i == null) {
    const t = g.nodes[g.target];
    const body = el("div");
    cardBody(keyOf(t), g.step, t.lab || null).then((b) => put(body, b));
    put(panel, body, el("p.fc-meta", `the target, preactivation ${t.pre}`),
      el("p.small.muted", `Shown: the ${Math.min(state.budget, state.nfeat)} most influential of ${state.nfeat} features and the ${state.edges} strongest edges among them${state.budget > 150 ? " that the page keeps (all edges among the 150 most influential features, the strongest beyond them)" : ""}. Size is influence on the target.`),
      listEdges(state.inc[g.target], "Direct inputs of the target", t.di));
    return;
  }
  const n = g.nodes[i];
  const head = n.k === "f"
    ? el("p.fc-meta", n.tgt ? `the target, preactivation ${n.pre}` : `direct effect on the target ${signed(n.d)}, ${state.rank.get(i)} of ${state.nfeat} by influence`)
    : el("p.fc-meta", `direct effect on the target ${signed(n.d)}`);
  const body = el("div");
  if (n.k === "f") cardBody(keyOf(n), g.step, n.lab || null).then((b) => put(body, b));
  else body.append(el("h4", nameOf(n)));
  put(panel, el("button.btn.small.ghost.xback", { type: "button", onclick: () => select(null) }, "Back to the target"), body, head,
    listEdges(state.inc[i], "Inputs", n.di), listEdges(state.out[i], "Outputs", n.do));
}

function select(i) {
  state.sel = i;
  writeAddress();
  drawGraph(state.host);
  drawPanel();
  paintStage();
}

/** The graph menu. A native select runs the prompt, the target and its place together in one string, so each option
 *  here sets them apart: the prompt, the target feature by name, then its stream and layer. */
function graphMenu(groups, current, nameOfRow) {
  const where = (r) => `${r.target.s === "img" ? "image" : "text"} stream, layer ${r.target.l}${r.step_series ? "" : r.step ? `, step ${r.step}` : ""}`;
  const feat = (r) => nameOfRow(r) || `feature ${r.target.f}`;
  const parts = (r) => [el("q.gm-prompt", r.prompt), el("span.gm-feat", nameOfRow(r) ? el("i.featname", feat(r)) : feat(r)), el("span.gm-where", where(r))];
  const label = (r) => `${r.prompt}, target ${feat(r)}, ${where(r)}`;
  const btn = el("button.gm-btn", { type: "button", "aria-haspopup": "listbox", "aria-expanded": "false", "aria-label": `Graph: ${label(current)}` }, parts(current));
  const opts = [];
  const list = el("div.gm-list", { role: "listbox", "aria-label": "Graphs", hidden: true },
    [...groups].map(([name, rows], gi) => el("div", { role: "group", "aria-labelledby": `gm-g${gi}` },
      el("p.gm-head", { id: `gm-g${gi}` }, name),
      rows.map((r) => {
        const o = el("div.gm-opt", { role: "option", tabindex: "-1", "aria-selected": r.id === current.id ? "true" : "false", "aria-label": label(r), onclick: () => choose(r) }, parts(r));
        opts.push([o, r]);
        return o;
      }))));
  const root = el("div.gm", btn, list);
  const outside = (e) => { if (!root.contains(e.target)) close(false); };
  function open() {
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    const [o] = opts.find(([, r]) => r.id === current.id) || opts[0];
    o.focus();
    o.scrollIntoView({ block: "nearest" });
    document.addEventListener("pointerdown", outside, true);
  }
  function close(refocus = true) {
    if (list.hidden) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) btn.focus();
  }
  function choose(r) {
    close(false);
    if (r.id !== current.id) openExplorer({ graph: r.id });
  }
  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); } });
  list.addEventListener("keydown", (e) => {
    const i = opts.findIndex(([o]) => o === document.activeElement);
    const go = (j) => { const [o] = opts[Math.max(0, Math.min(opts.length - 1, j))]; o.focus(); o.scrollIntoView({ block: "nearest" }); };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(opts.length - 1);
    else if (e.key === "Enter" || e.key === " ") { if (i >= 0) choose(opts[i][1]); }
    else if (e.key === "Escape") { e.stopPropagation(); close(); }   // the menu closes, the explorer stays open
    else if (e.key === "Tab") return close(false);
    else return;
    e.preventDefault();
  });
  return root;
}

function render() {
  const { g, row, index } = state;
  // header: the graph menu, the steps of a series, find
  const series = row.step_series ? index.filter((r) => r.step_series === row.step_series) : [];
  const groups = new Map();
  index.forEach((r) => {
    if (r.step_series && r.step !== 0 && r.step_series !== row.step_series) return;
    if (r.step_series && r.step_series === row.step_series && r.id !== row.id) return;
    (groups.get(r.group) || groups.set(r.group, []).get(r.group)).push(r);
  });
  const seriesName = (r) => {
    if (!r.step_series) return r.target.lab;
    const labs = new Set(index.filter((x) => x.step_series === r.step_series).map((x) => x.target.lab || ""));
    return labs.size === 1 ? [...labs][0] : "";
  };
  const menu = graphMenu(groups, row, seriesName);
  const steps = series.length
    ? el("div.tabs.small", { role: "tablist", "aria-label": "Denoising step" }, series.sort((a, b) => a.step - b.step).map((r) =>
      el("button", { type: "button", role: "tab", "aria-selected": r.id === row.id ? "true" : "false", onclick: () => openExplorer({ graph: r.id, sel: state.sel != null ? keyOf(g.nodes[state.sel]) : null, groups: state.groups }) }, `step ${r.step}`)))
    : el("span.xstep", `step ${g.step}`);
  const find = el("input", { type: "search", placeholder: "Search", title: "A feature number or name, or on:word for the features over that word", "aria-label": "Find a feature by number, name or token" });
  find.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = find.value.trim().toLowerCase();
    if (!q) return;
    const tok = q.startsWith("on:") ? q.slice(3) : null;
    const hits = g.nodes.map((n, i) => [n, i]).filter(([n]) => n.k === "f" && (tok ? n.s === "txt" && tokWord(g.tokens[topToken(n, g.tokens.length)] || "").toLowerCase() === tok
      : String(n.f) === q || (n.lab || "").toLowerCase().includes(q))).sort((a, b) => b[0].inf - a[0].inf);
    if (hits.length) select(hits[0][1]);
    else find.setCustomValidity("No feature of this graph matches"), find.reportValidity(), setTimeout(() => find.setCustomValidity(""), 1500);
  });
  const copy = el("button.btn.small.ghost", { type: "button", onclick: async () => { try { await navigator.clipboard.writeText(location.href); copy.textContent = "Link copied"; } catch { copy.textContent = "Copy the address bar"; } setTimeout(() => (copy.textContent = "Copy link"), 1500); } }, "Copy link");
  const header = el("header.xhead", el("strong", "Attribution graph"), menu, steps, find, copy, el("button.btn.small.ghost.xclose", { type: "button", "aria-label": "Close", title: "Close", onclick: () => dlg.close() }, "×"));

  // stage: the image at the graph's step and the prompt
  const src = row.preview || row.image;
  const heat = src ? heatImage(src, { alt: `The model's prediction of the clean image at step ${g.step}` }) : null;
  const toks = g.tokens.map((t) => (t === "</s>" ? el("span.tok.tok-end", { hidden: true }, "end") : tokWord(t) ? el("span.tok", tokWord(t)) : null));
  const cap = el("p.where-cap");
  const legend = state.groups.length
    ? el("div.xgroups", el("h5", "Groups of the figure"), state.groups.map((gr) => {
      const ids = gr.keys.map((k) => state.byKey.get(k)).filter((x) => x != null);
      return el("button.feat", { type: "button", disabled: !ids.length, onclick: () => ids.length && select(ids[0]) }, gr.label, el("small", ` ${ids.length}`));
    }))
    : null;
  // a slider with its value beside its name; --p is the filled part of its track
  const slider = (name, min, max, step, get, set) => {
    const out = el("output", String(get()));
    const input = el("input", { type: "range", min, max, step, value: get() });
    const fill = () => input.style.setProperty("--p", `${(100 * (input.value - min)) / (max - min)}%`);
    input.addEventListener("input", () => { set(+input.value); out.textContent = input.value; fill(); drawGraph(state.host); drawPanel(); });
    fill();
    return el("label.xslider", el("span", name, out), input);
  };
  const ctl = el("div.xctl",
    slider("Features shown", 20, Math.max(40, Math.min(state.nfeat, 400)), 10, () => state.budget, (v) => (state.budget = v)),
    slider("Edges shown", 40, 600, 20, () => state.edges, (v) => (state.edges = v)),
    el("label.check", el("input", { type: "checkbox", checked: state.showErrors, onchange: (e) => { state.showErrors = e.target.checked; drawGraph(state.host); } }), "MLP errors"));
  // what the colors and shapes of the graph mean
  const key = el("ul.legend.xkey",
    el("li", el("span.sw.dot", { style: { background: "var(--txt)" } }), "text feature"),
    el("li", el("span.sw.dot", { style: { background: "var(--img)" } }), "image feature"),
    el("li", el("span.sw.line", { style: { background: "var(--pos)" } }), "excites"),
    el("li", el("span.sw.line", { style: { background: "var(--neg)" } }), "inhibits"),
    el("li", el("span.sw.box"), "input embeddings"));
  const stageEl = el("aside.xstage", heat ? heat.node : null, el("p.where-prompt", toks.map((t) => (t ? [t, " "] : null))), cap,
    el("p.small.muted", `“${g.prompt}”. The image is the model's prediction of the clean image at step ${g.step}.`), key, legend, ctl);
  state.stage = { heat, toks, cap };

  state.host = el("div.xcanvas");
  state.panel = el("aside.xpanel");
  put(dlg, header, el("div.xbody", stageEl, state.host, state.panel));
  drawGraph(state.host);
  drawPanel();
  paintStage();
  writeAddress();
  // the canvas, not the dialog: a scrollbar that appears inside it changes its size too
  // redrawn on the next frame and only when the size really changed, so a redraw cannot feed the observer back
  if (state.ro) state.ro.disconnect();
  let seen = "";
  state.ro = new ResizeObserver(() => {
    const h = state.host;
    if (!dlg.open || !h.isConnected) return;
    const size = `${h.clientWidth}x${h.clientHeight}`;
    if (size === seen) return;
    seen = size;
    requestAnimationFrame(() => h.isConnected && drawGraph(h));
  });
  state.ro.observe(state.host);
}

/** The tiles under "Explore": one per graph of the case studies. */
export async function mountLauncher(node) {
  const index = await INDEX();
  const seen = new Set();
  const rows = index.filter((r) => {
    const k = r.step_series || r.id;
    if (seen.has(k) || (r.step_series && r.step !== 0)) return false;
    seen.add(k);
    return true;
  });
  const cases = new Set();
  const main = rows.filter((r) => !r.step_series && !cases.has(r.group) && cases.add(r.group));
  put(node, main.map((r) => el("button", { type: "button", onclick: () => openExplorer({ graph: r.id }) },
    el("img", { src: r.preview || r.image, alt: "", loading: "lazy", width: 320, height: 200 }),
    el("span", el("b", r.group), el("q", r.prompt)))),
  el("button", { type: "button", onclick: () => openExplorer({ graph: "mountain-0" }) },
    el("img", { src: index.find((r) => r.id === "mountain-0").preview, alt: "", loading: "lazy", width: 320, height: 200 }),
    el("span", el("b", "Twenty targets, four steps"), "the 80 graphs of the temporal analysis")));
}
