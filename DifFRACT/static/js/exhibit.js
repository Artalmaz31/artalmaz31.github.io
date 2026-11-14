// A case-study figure. On top, the hypothesis read off an attribution graph: a diagram of a few groups of features.
// Below it, the test: every intervention condition is a row with the seeds of the prompt and the blind labels of all its
// generations, so the whole result is on the page without pressing anything. Pointing at a row tints it and puts the
// diagram in the state its condition sets (which groups are suppressed, inverted or amplified). Pointing at a group shows
// where it fires, and a click on a group opens its features.
// Data: static/data/exhibits.json (tools/build_exhibits.py).

import { el, put, svg, heatImage, b64bytes, pct1, signed, attachPeek } from "./util.js";
import { attachCard } from "./featcard.js";

const MARK = { off: "suppressed", inv: "inverted", up: "amplified" };

function boxHeight(b) {
  return b.sub ? 46 : 34;
}

const laneOf = (b) => (b.lane || (b.stream === "img" ? "img" : "txt"));

/** Where an arrow leaves or enters a box. Between the lanes it uses the sides that face each other, within a lane the
 *  top and the bottom; `slot` spreads several arrows along that side. */
function anchor(b, other, slot, cross) {
  const h = boxHeight(b);
  const dy = other.y - b.y, dx = other.x - b.x;
  if (cross || Math.abs(dy) <= h * 0.8) return [b.x + (dx < 0 ? -b.w / 2 : b.w / 2), b.y + slot * h * 0.56, dx < 0 ? -1 : 1, 0];
  return [b.x + slot * b.w * 0.62, b.y + (dy < 0 ? -h / 2 : h / 2), 0, dy < 0 ? -1 : 1];
}

/** The arrowhead grows with the line (`w`) and stops TIP_GAP short of the box; the line ends just inside the head's base,
 *  so its round cap never shows past the tip. A line arrives along the normal of the box's side, so the head is too. */
const TIP_GAP = 5;
function edgePath(a, b, slotOut, slotIn, cross, w) {
  const [x1, y1, ax, ay] = anchor(a, b, slotOut, cross);
  const [xs, ys, bx, by] = anchor(b, a, slotIn, cross);
  const len = Math.max(7, 2.6 * w + 3), hw = Math.max(3.6, 1.25 * w + 1.6);
  const tip = [xs + bx * TIP_GAP, ys + by * TIP_GAP], base = [tip[0] + bx * len, tip[1] + by * len];
  const x2 = base[0] - bx * 0.6, y2 = base[1] - by * 0.6;
  const head = `M${tip[0]},${tip[1]} L${base[0] - by * hw},${base[1] + bx * hw} L${base[0] + by * hw},${base[1] - bx * hw}Z`;
  const d = Math.max(26, Math.hypot(x2 - x1, y2 - y1) * 0.4);
  const c1 = [x1 + ax * d, y1 + ay * d], c2 = [x2 + bx * d, y2 + by * d];
  const mid = [(x1 + 3 * c1[0] + 3 * c2[0] + x2) / 8, (y1 + 3 * c1[1] + 3 * c2[1] + y2) / 8];
  const tx = x2 + c2[0] - c1[0] - x1, ty = y2 + c2[1] - c1[1] - y1, tl = Math.hypot(tx, ty) || 1;
  let nx = -ty / tl, ny = tx / tl;
  if (ny > 0) { nx = -nx; ny = -ny; } // the label sits above the line
  return { d: `M${x1},${y1} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${x2},${y2}`, head, label: [mid[0] + nx * 12, mid[1] + ny * 9] };
}

/** Boxes are as wide as their two lines of text need. */
function fit(b) {
  b.w = Math.max(b.w || 0, 28 + b.label.length * 7.9, b.sub ? 22 + b.sub.length * 5.25 : 0);
  return b;
}

function diagram(scene0, hooks, narrow) {
  const SX = narrow ? 0.72 : 1, W = Math.round(560 * SX), GAP = narrow ? 12 : 16;
  const scene = { ...scene0, boxes: scene0.boxes.map((b) => ({ ...b, x: b.x * SX })) };
  const hasImg = scene.boxes.some((b) => (b.lane || b.stream) === "img" || (b.target && b.stream === "img" && b.lane !== "txt"));
  // a graph with no text-stream group gets the image lane alone, at full width, not an empty text lane beside it
  const imgOnly = hasImg && !scene.boxes.some((b) => laneOf(b) === "txt");
  if (imgOnly) {
    const x0 = W / 2 + GAP / 2;
    scene.boxes.forEach((b) => (b.x = ((b.x - x0) * W) / (W - x0)));
  }
  const H = Math.max(240, ...scene.boxes.map((b) => b.y + boxHeight(b) / 2 + 30));
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "diagram", role: "img", "aria-label": `Diagram of the feature groups in the attribution graph of ${scene.prompt}` });
  if (imgOnly) {
    root.append(svg("rect", { x: 0, y: 0, width: W, height: H, rx: 10, class: "lane lane-img" }), svg("text", { x: W - 12, y: H - 12, class: "lane-label img", "text-anchor": "end" }, "image stream"));
  } else if (hasImg) {
    root.append(
      svg("rect", { x: 0, y: 0, width: W / 2 - GAP / 2, height: H, rx: 10, class: "lane lane-txt" }),
      svg("rect", { x: W / 2 + GAP / 2, y: 0, width: W / 2 - GAP / 2, height: H, rx: 10, class: "lane lane-img" }),
      svg("text", { x: 12, y: H - 12, class: "lane-label txt" }, "text stream"),
      svg("text", { x: W - 12, y: H - 12, class: "lane-label img", "text-anchor": "end" }, "image stream"),
    );
  } else {
    root.append(svg("rect", { x: 0, y: 0, width: W, height: H, rx: 10, class: "lane lane-txt" }), svg("text", { x: 12, y: H - 12, class: "lane-label txt" }, "text stream"));
  }
  const byId = Object.fromEntries(scene.boxes.map((b) => [b.id, fit(b)]));
  const gEdges = svg("g", { class: "edges" });
  const isCross = (e) => hasImg && laneOf(byId[e.from]) !== laneOf(byId[e.to]);
  // arrows that share a side of a box are spread along it, in the order of the boxes at their other end
  const slots = (key, other) => {
    const groups = {};
    scene.edges.forEach((e) => (groups[e[key] + (isCross(e) ? "|x" : "|v")] ||= []).push(e));
    const out = new Map();
    Object.values(groups).forEach((list) => {
      const cross = isCross(list[0]);
      list.sort((p, q) => (cross ? byId[p[other]].y - byId[q[other]].y : byId[p[other]].x - byId[q[other]].x));
      list.forEach((e, k) => out.set(e, list.length === 1 ? 0 : k / (list.length - 1) - 0.5));
    });
    return out;
  };
  const slotIn = slots("to", "from"), slotOut = slots("from", "to");
  for (const e of scene.edges) {
    const a = byId[e.from], b = byId[e.to];
    const sign = e.w >= 0 ? "pos" : "neg";
    const width = 1.6 + 3.2 * Math.sqrt(Math.min(1, e.share * 4));
    const { d, head, label } = edgePath(a, b, slotOut.get(e), slotIn.get(e), isCross(e), width);
    const tip = `${signed(e.w)}: summed attribution of ${a.label} into ${b.label}` + (b.target ? ` (preactivation ${b.pre})` : "");
    gEdges.append(
      svg("path", { d, class: `edge ${sign}`, "stroke-width": width.toFixed(2), "data-from": e.from, "data-to": e.to }, svg("title", {}, tip)),
      svg("path", { d: head, class: `edge-head ${sign}`, "data-from": e.from, "data-to": e.to }),
      svg("text", { x: label[0], y: label[1] + 4, class: `edge-w ${sign}`, "text-anchor": "middle" }, signed(e.w, Math.abs(e.w) >= 10 ? 1 : 2), svg("title", {}, tip)),
    );
  }
  root.append(gEdges);
  const nodes = {};
  for (const b of scene.boxes) {
    const h = boxHeight(b), x = b.x - b.w / 2, y = b.y - h / 2;
    const stream = b.lane || b.stream;
    const g = svg("g", {
      class: `box ${stream}${b.target ? " target" : ""}${b.ghost ? " ghost" : ""}${b.n > 1 ? " many" : ""}`, tabindex: b.n ? 0 : -1, role: "button",
      "aria-label": `${b.label}: ${b.target ? "the target feature" : b.n + (b.n === 1 ? " feature" : " features")}. Show its examples.`,
    });
    if (b.n > 1) g.append(svg("rect", { x: x + 4, y: y + 4, width: b.w, height: h, rx: 8, class: "box-shadow" }));
    g.append(svg("rect", { x, y, width: b.w, height: h, rx: 8, class: "box-face" }));
    g.append(svg("text", { x: b.x, y: b.sub ? b.y - 3 : b.y + 5, class: "box-label", "text-anchor": "middle" }, b.label));
    if (b.sub) g.append(svg("text", { x: b.x, y: b.y + 14, class: "box-sub", "text-anchor": "middle" }, b.sub));
    const tag = b.target ? svg("text", { x: x + 2, y: y - 6, class: "box-tag" }, `target, layer ${b.layers[0]}`) : null;
    if (tag) g.append(tag);
    // the mark of a target sits beside its box, or after the tag above it where the canvas ends too soon (a phone)
    const beside = b.target && b.x + b.w / 2 + 64 <= W;
    const mark = !b.target
      ? svg("text", { x: b.x + b.w / 2, y: y - 6, class: "box-mark", "text-anchor": "end" })
      : beside ? svg("text", { x: b.x + b.w / 2 + 6, y: b.y + 4, class: "box-mark" }) : svg("tspan", { dx: 6, class: "box-mark" });
    (b.target && !beside ? tag : g).append(mark);
    // a condition that acts on a few features of a group (`<id>.pick`, the color prior's three sources) names them over
    // the group and leaves the box as it is: the rest of the group still carries its arrow
    nodes[b.id] = { g, mark, part: b.pick ? b.pick.keys.length : 0 };
    g.addEventListener("mouseenter", () => hooks.hover(b));
    g.addEventListener("mouseleave", () => hooks.hover(null));
    g.addEventListener("focus", () => hooks.hover(b));
    g.addEventListener("blur", () => hooks.hover(null));
    g.addEventListener("keydown", (ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), g.dispatchEvent(new MouseEvent("click"))));
    if (b.n) {
      attachCard(g, { keys: b.keys, step: scene.step, title: b.label, count: b.n, name: b.n === 1 ? b.label : null, note: b.note }, { hover: false });
    }
    root.append(g);
  }
  const setMarks = (marks = {}) => {
    for (const [id, n] of Object.entries(nodes)) {
      const m = marks[id], part = n.part && marks[id + ".pick"];
      n.g.classList.toggle("off", m === "off" || m === "inv");
      n.g.classList.toggle("up", m === "up");
      if (n.mark) n.mark.textContent = m ? MARK[m] : part ? `${n.part} of its features ${MARK[part]}` : "";
    }
    root.querySelectorAll(".edge, .edge-head").forEach((p) => {
      const cut = ["off", "inv"].includes(marks[p.dataset.from]);
      p.classList.toggle("cut", cut);
    });
  };
  return { node: root, setMarks };
}

/** Beside the diagram: the model's prediction of the image at the graph's step and the prompt, highlighted where the group under the pointer fires. */
function whereStrip(scene) {
  const src = scene.preview || scene.image;
  const h = src ? heatImage(src, { alt: `The model's prediction of the clean image at step ${scene.step}` }) : null;
  const toks = el("p.where-prompt");
  const chips = scene.tokens.map((t) => {
    if (!t) return null;
    const c = el(t === "end" ? "span.tok.tok-end" : "span.tok", t);
    toks.append(c, " ");
    return c;
  });
  const target = scene.boxes.find((b) => b.target);
  const show = (b) => {
    const box = b || target;
    const max = box.tok && box.tok.length ? box.tok[0][1] : 1;
    const acts = new Map(box.tok || []);
    chips.forEach((c, i) => {
      if (!c) return;
      const a = (acts.get(i) || 0) / max;
      c.style.setProperty("--a", a >= 0.08 ? a.toFixed(2) : 0);
      c.classList.toggle("lit", a >= 0.08);
      if (c.classList.contains("tok-end")) c.hidden = a < 0.08;
    });
    if (h) h.set(box.map ? b64bytes(box.map) : null);
  };
  show(null);
  return { image: h ? h.node : null, toks, show };
}

const share = (k, n) => (Math.abs(((1000 * k) / n) % 1 - 0.5) < 1e-9 ? ((100 * k) / n).toFixed(2) : pct1(k, n).replace(/\.0$/, ""));

/**
 * The color of a blind label, in a bar of all generations and under an image. A label has one role in its experiment
 * (`roles`, from the data) and a role has one color on the whole page: deep blue the outcome the graph predicts, lighter
 * blues further outcomes the test counts, gray the image as it was, lighter grays the rest, red a sign that stayed red,
 * hatched an object destroyed. A label without a role is blue if a condition counts it, light gray otherwise.
 */
const ROLE = { pred: "var(--lab-pred)", pred2: "var(--lab-pred2)", pred3: "var(--lab-pred3)", orig: "var(--lab-orig)", other: "var(--lab-other)",
  other2: "var(--lab-other2)", red: "var(--neg)", lost: "var(--lab-lost)", unclear: "var(--lab-unclear)" };
export function shades(roles = {}, cs = []) {
  const counted = new Set(cs.flatMap((x) => x.hit || []));
  return (c, name) => ROLE[name === "unclear" ? "unclear" : roles[name] || (counted.has(name) ? "pred" : "other")];
}

/**
 * One generation: the image, with a larger look under the pointer, and a bar of its blind label's color under it. In the
 * color prior an image is labeled with the color itself ("white"): its bar is that of "requested color". A count of objects
 * is a badge on the image instead.
 */
export function thumb(x, c, shade, { lead = false } = {}) {
  const count = x.label && /^(\d+) objects?$/.exec(x.label);
  const fig = el("figure.thumb" + (lead ? ".lead" : count ? "" : ".bar"),
    el("img", { src: x.src, alt: lead ? `The paper's figure: ${x.note}` : x.paper ? "The paper's figure" : x.label ? `Generated image, labeled ${x.label}` : "Generated image", loading: "lazy", decoding: "async", width: 320, height: 320 }));
  // in the color prior an image is labeled with the color itself ("white"), the bar counts it as "requested color"
  const named = (n) => c.dist.counts.find((k) => k[0] === n);
  const row = x.label && c && c.dist ? named(x.label) || (x.label !== "red" && x.label !== "object destroyed" ? named("requested color") : null) : null;
  if (row && shade && !count) fig.style.setProperty("--c", shade(c, row[0]));
  if (count) fig.append(el("span.badge", count[1]));
  attachPeek(fig, () => ({ src: x.src, text: lead ? `the paper's figure: ${x.note}` : x.paper ? "the paper's figure" : x.label === "red" ? "still red" : x.label || "" }));
  return fig;
}

/** The labels of all generations of a condition as one bar, with the count of each label under it. */
function distBar(c, shade) {
  const bar = el("div.dist", { role: "img", "aria-label": c.dist.counts.map((x) => `${x[0]}: ${x[1]} of ${c.dist.n}`).join(", ") });
  const legend = el("ul.dist-legend");
  c.dist.counts.forEach(([name, k]) => {
    const bg = shade(c, name);
    bar.append(el("span.seg", { style: { flexGrow: k, background: bg }, title: `${name}: ${k} of ${c.dist.n}` }));
    legend.append(el("li", el("span.sw", { style: { background: bg } }), `${name} `, el("b", k)));
  });
  return [bar, legend];
}

/** What a condition did, over all its generations: the headline number, the bar of labels, a note. */
function outcome(c, scene, shade, first) {
  const out = el("div.t-out");
  const m = scene.measure || {};
  if (c.k) {
    out.append(el("p.t-num", el("strong", `${c.k[0]} of ${c.k[1]}`), el("span.pc", `${share(c.k[0], c.k[1])}%`), c.k_title ? ` ${c.k_title}` : ""));
  } else if (c.mean != null) {
    const max = m.max || 10;
    out.append(el("p.t-num", el("strong", c.mean.toFixed(2))),
      el("div.meanbar" + (first ? ".base" : ""), { role: "img", "aria-label": `${c.mean.toFixed(2)} ${m.title}` }, el("i", { style: { width: `${(100 * c.mean) / max}%` } }),
        m.target ? el("span.goal", { style: { left: `${(100 * m.target) / max}%` } }) : null));
  }
  if (c.dist && c.mean == null) out.append(...distBar(c, shade));
  if (c.lead && c.lead.note) out.append(el("p.t-note", el("b", "The paper's figure. "), c.lead.note));
  if (c.note) out.append(el("p.t-note", c.note));
  if (!out.childNodes.length && first && scene.measure) out.append(el("p.t-base", "the baseline of every labeled pair"));
  return out;
}

/**
 * A row that drives the graph above it: pointing at it shows its condition there (`onRow(c, row)`, then `onRow(null)`),
 * a click or Enter keeps it (`onPin(c, row)`).
 */
function linkRow(row, c, { onRow, onPin }) {
  if (!onRow) return row;
  row.classList.add("linked");
  row.tabIndex = 0;
  row.setAttribute("role", "button");
  row.setAttribute("aria-pressed", "false");
  row.setAttribute("aria-label", `${c.label}${c.sub ? `, ${c.sub}` : ""}: show on the graph`);
  row.addEventListener("mouseenter", () => onRow(c, row));
  row.addEventListener("mouseleave", () => onRow(null));
  if (onPin) {
    row.addEventListener("click", () => onPin(c, row));
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPin(c, row); } });
  }
  return row;
}

/**
 * The rows of one experiment: a header (seeds, the measure), then one row per condition. With `onRow`, a row drives
 * the graph above it (`linkRow`). `title` (the test's kicker) takes the header's left cell, over the seeds, which is
 * otherwise empty; with a column of the paper's figure there it gets a line of its own.
 */
export function testRows(scene, { onRow, onPin, title } = {}) {
  const cs = scene.conditions;
  const shade = shades(scene.roles, cs);
  const m = scene.measure;
  const withLead = cs.some((c) => c.lead);
  const labeled = cs.find((c) => c.dist);
  const sub = !labeled ? "" : m && m.target
    ? `all ${labeled.dist.n} generations, counted blind. Dashed: the ${m.target_label}`
    : `all ${labeled.dist.n} generations${labeled.dist.scope === "prompt" ? " of this prompt" : ""}, labeled blind`;
  const inHead = title && !withLead;
  const head = el("div.thead" + (inHead ? ".titled" : ""),
    inHead ? el("div.t-title", title) : el("div.seedlabs", withLead ? el("span.lead-h", "the paper's figure") : null),
    el("div.t-measure", m ? m.title : "", sub ? el("small", sub) : null));
  const rows = cs.map((c, j) => {
    const row = el("div.trow",
      el("p.t-name", c.label, c.sub ? el("span.t-alpha", c.sub) : null),
      el("div.t-seeds",
        withLead ? (c.lead ? thumb({ src: c.lead.src, note: c.lead.note }, null, null, { lead: true }) : el("span.thumb.lead.hole")) : null,
        c.cells.map((x) => thumb(x, c, shade))),
      outcome(c, scene, shade, j === 0));
    return linkRow(row, c, { onRow, onPin });
  });
  return [title && !inHead ? el("div.t-title.full", title) : null, head, rows];
}

/** The color prior: the conditions in rows, the prompts in columns, three seeds of each. */
function matrixRows(scene, { onRow, onPin } = {}) {
  const vs = scene.variants;
  // the prompts over the columns on one line each, in one size that fits the longest
  const head = el("div.thead", { style: { "--chars": Math.max(...vs.map((v) => v.label.length)) } }, vs.map((v) => el("div", el("q", { title: v.label }, v.label))));
  const rows = vs[0].conditions.map((c0, j) => {
    const row = el("div.trow",
      el("p.t-name", c0.label, c0.sub ? el("span.t-alpha", c0.sub) : null),
      vs.map((v) => {
        const c = v.conditions[j], shade = shades(scene.roles, v.conditions);
        const [bar] = distBar(c, shade);
        return el("div.mcell", el("p.m-prompt", v.label), el("div.t-seeds", c.cells.slice(0, 3).map((x) => thumb(x, c, shade))),
          el("p.t-num", el("strong", `${c.k[0]} of ${c.k[1]}`), el("span.pc", `${share(c.k[0], c.k[1])}%`)), bar);
      }));
    return linkRow(row, c0, { onRow, onPin });
  });
  const shade = shades(scene.roles, vs[0].conditions);
  const legend = el("ul.legend", ["requested color", "red", "object destroyed"].map((name) =>
    el("li", el("span.sw", { style: { background: shade(null, name) } }), name === "red" ? "still red" : name)));
  return { head, rows, legend };
}

/** A test without a graph of its own: the rows of one experiment on a plate (the apple of the color case). */
export function mountRows(root, spec) {
  root.classList.add("exhibit", "plate");
  root.replaceChildren(el("div.card.ex-test",
    el("div.ttable" + (spec.conditions.some((c) => c.dist || c.k || c.lead) ? "" : ".plain"), { style: { "--n": spec.conditions[0].cells.length } },
      testRows(spec, { title: el("p.kicker", "The test", el("span", "on"), el("q", spec.prompt)) })),
    el("p.protocol", spec.protocol || "")));
}

/** `only`: the indices of the scenes this figure shows (a case with two experiments is two figures). */
export function mountExhibit(root, ex, { onOpen, only } = {}) {
  root.classList.add("exhibit", "plate");
  const scenes = only ? ex.scenes.filter((_, i) => only.includes(i)) : ex.scenes;
  const tested = scenes.filter((s) => (s.conditions || []).length);
  const narrow = matchMedia("(max-width: 640px)");
  let shown = 0, dia, where;
  let pinned = null, hovered = null;   // { scene, c, row }
  const status = tested.length ? el("p.ex-state", { "aria-live": "polite" }) : null;
  // the graph in the state of the row under the pointer, else of the kept row, and its name over the graph
  function paint() {
    const on = (x) => x && scenes[shown] === x.scene;
    const a = on(hovered) ? hovered : on(pinned) ? pinned : null;
    dia.setMarks(a ? a.c.mark : {});
    if (!status) return;
    status.classList.toggle("on", !!a);
    const kept = a && pinned && a.row === pinned.row;
    const unseen = a && a.c.id !== "base" && !Object.keys(a.c.mark || {}).length;
    put(status, "On the graph: ", a ? [el("b", a.c.label), a.c.sub ? el("span.t-alpha", a.c.sub) : null] : "the model as it is",
      unseen ? el("span.ex-unseen", "its features are not in this graph") : null,
      kept ? el("button.ex-unpin", { type: "button", title: "Back to the model as it is", "aria-label": "Back to the model as it is", onclick: () => pin(null) }, "×") : null);
  }
  function pin(p) {
    hovered = null;   // on a touch screen the tapped row stays "under the pointer"; a click decides
    const again = p && pinned && pinned.row === p.row;
    if (pinned) { pinned.row.classList.remove("pinned"); pinned.row.setAttribute("aria-pressed", "false"); }
    pinned = p && !again ? p : null;
    if (pinned) {
      pinned.row.classList.add("pinned");
      pinned.row.setAttribute("aria-pressed", "true");
      if (scenes[shown] !== pinned.scene) return drawGraph(scenes.indexOf(pinned.scene));
    }
    paint();
  }
  narrow.addEventListener("change", () => drawGraph(shown));

  const graph = el("div.card.ex-graph");
  const test = tested.length ? el("div.card.ex-test") : null;
  root.replaceChildren(graph, test || "");

  // the images of the other prompts are loaded now, so a switch shows them at once
  scenes.forEach((s) => { const src = s.preview || s.image; if (src) new Image().src = src; });

  function drawGraph(k, switched = false) {
    shown = k;
    const scene = scenes[k];
    if (pinned && pinned.scene !== scene) { pinned.row.classList.remove("pinned"); pinned.row.setAttribute("aria-pressed", "false"); pinned = null; }
    where = whereStrip(scene);
    dia = diagram(scene, { hover: (b) => where.show(b && scene.boxes.find((x) => x.id === b.id)) }, narrow.matches);
    const multi = scenes.length > 1;
    const tabs = multi
      ? el("div.tabs.small.ex-tabs", { role: "tablist", "aria-label": "Prompt of the graph" }, scenes.map((s, j) =>
        el("button", { type: "button", role: "tab", "aria-selected": j === k ? "true" : "false", onclick: (ev) => {
          const kb = ev.detail === 0;   // a keyboard press: the focus goes to the new tab
          drawGraph(j, true);
          if (kb) graph.querySelector(".ex-tabs [aria-selected=true]").focus();
        } }, s.tab || s.prompt)))
      : null;
    const facts = scene.facts || ex.note ? el("p.facts", [scene.facts, ex.note].filter(Boolean).join(" ")) : null;
    // one grid: the diagram and the image side by side, the line of each under it, the facts across
    gbody = el("div.ex-graph-body" + (status ? "" : ".no-state") + (switched ? ".swap" : ""),
      el("div.ex-dia", dia.node), el("div.ex-pic", where.image), status, where.toks, facts);
    put(graph,
      el("p.kicker", "The graph", el("span", multi ? "of the same feature, traced on" : "traced on"), multi ? null : el("q", scene.prompt),
        el("button.btn.small.ghost.kick-act", { type: "button", onclick: () => onOpen && onOpen(scene) }, "Open the full graph")),
      tabs, gbody);
    fitPicNow();
    fitPic.disconnect();
    fitPic.observe(gbody);
    paint();
  }
  // the image is as tall as the diagram. The diagram scales with its width (ratio r of its viewBox) and gets what the
  // image leaves of the row (W less the gap g), so the side p = r (W - g) / (1 + r), found at once, not frame by frame
  let gbody = null;
  function fitPicNow() {
    if (!gbody || !gbody.isConnected) return;
    if (matchMedia("(max-width: 760px)").matches) return gbody.style.removeProperty("--pic");
    const vb = gbody.querySelector(".ex-dia svg").viewBox.baseVal, r = vb.height / vb.width;
    const W = gbody.clientWidth, g = parseFloat(getComputedStyle(gbody).columnGap) || 0;
    const side = Math.round(Math.max(200, Math.min((r * (W - g)) / (1 + r), W * 0.42)));
    if (Math.abs(side - (parseFloat(gbody.style.getPropertyValue("--pic")) || 0)) > 0.5) gbody.style.setProperty("--pic", `${side}px`);
  }
  const fitPic = new ResizeObserver(() => requestAnimationFrame(fitPicNow));

  if (test) {
    const body = [];
    tested.forEach((scene) => {
      // pointing at a row puts the diagram in the state of the row's condition, if it shows that graph; a click keeps it
      const onRow = (c, row) => { hovered = c ? { scene, c, row } : null; paint(); };
      const onPin = (c, row) => pin({ scene, c, row });
      const one = tested.length === 1;
      const group = one ? null : el("p.tgroup", scene.test_title || ["On ", el("q", scene.prompt)]);
      const title = one ? el("p.kicker", "The test") : group;
      if (scene.variants) {
        const mx = matrixRows(scene, { onRow, onPin });
        body.push(group, el("div.tmatrix", { style: { "--n": scene.variants.length } }, mx.head, mx.rows), mx.legend);
      } else {
        const n = scene.conditions[0].cells.length, plain = !scene.conditions.some((c) => c.dist || c.k || c.lead);
        body.push(el("div.ttable" + (plain ? ".plain" : n <= 3 ? ".seeds3" : ""), { style: { "--n": n } }, testRows(scene, { onRow, onPin, title })));
      }
      if (scene.cells_title) body.push(el("p.note", scene.cells_title + "."));
      body.push(el("p.protocol", scene.protocol || ""));
    });
    const ownKicker = tested.length > 1 || tested[0].variants;
    put(test, ownKicker ? el("p.kicker", "The test") : null, body);
  }
  drawGraph(0);
}
