// Figures that are not a diagram-plus-test exhibit: the four denoising steps (four small figures, each next to the
// paragraph it belongs to) and the matched budget. Nothing in them has to be pressed to be read.

import { el, svg, pct1, getJSON } from "./util.js";
import { testRows, thumb, shades } from "./exhibit.js";

const SIGMA = ["1", "0.75", "0.5", "0.25"];
const STATS = () => getJSON("static/data/temporal.json");
const pc = (v) => (v * 100).toFixed(1) + "%";

/** One target at the four steps: the model's prediction of the image, the split of this graph's attribution between the
 *  streams, and the mean split over the 20 targets. */
export async function mountTemporalSteps(root, T, { onOpen }) {
  const f = (await STATS())[0];
  root.classList.add("plate");
  const bar = (img, cls, labels) => {
    const t = 1 - img;
    return el("div.sharebar" + cls, { role: "img", "aria-label": `${pc(t)} of the attribution from the text stream, ${pc(img)} from the image stream` },
      el("span.t", { style: { flexGrow: t } }, labels && t > 0.3 ? `text ${pc(t)}` : ""),
      el("span.i", { style: { flexGrow: img } }, labels && img > 0.3 ? `image ${pc(img)}` : ""));
  };
  root.replaceChildren(el("div.card",
    el("p.kicker", "One target at the four steps", el("span", el("i.featname", "cat"), ", image stream, layer 12, on"), el("q", T.prompt)),
    el("div.tsteps", T.series.map((s, k) => el("figure.tstep",
      el("img", { src: s.preview, alt: `The model's prediction of the clean image at step ${k}`, loading: "lazy", width: 256, height: 256 }),
      el("p.when", `step ${k}`, el("span", `, σ = ${SIGMA[k]}`)),
      bar(s.img_share, "", true),
      el("p.sharecap", "this graph"),
      bar(f.img[k], ".mean", false),
      el("p.sharecap", `mean of the 20 targets: ${pc(1 - f.img[k])} text, ${pc(f.img[k])} image. ${pc(f.cross[k])} of edges cross between the streams.`)))),
    el("ul.legend", el("li", el("span.sw", { style: { background: "var(--txt)" } }), "attribution from text-stream sources"),
      el("li", el("span.sw", { style: { background: "var(--img)" } }), "from image-stream sources")),
    el("p.note", "The images are the model's prediction of the clean image at each step. ",
      el("button.linkish", { type: "button", onclick: () => onOpen({ graph: T.series[0].graph, pins: T.pins, label: "cat supernode" }) }, "Open the four graphs in the explorer"), ".")));
}

/** Median pruned-graph edges by source layer over the five layer-12 targets, one panel per step: text sources to the left,
 *  image sources to the right (the per-layer panel of the paper's Figure 4, recomputed on these graphs). */
export function mountTemporalLayers(root, T) {
  const W = 200, rowH = 11, top = 16, mid = W / 2, gap = 12, half = mid - gap - 2, H = top + 16 * rowH + 4;
  const max = Math.max(...T.profile.flatMap((p) => [...p.img, ...p.txt]));
  const panel = (p, st) => {
    const g = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
      "aria-label": `Edges by source layer at step ${st}: text ${Math.round(p.txt.reduce((a, b) => a + b))}, image ${Math.round(p.img.reduce((a, b) => a + b))}` });
    g.append(svg("text", { x: mid - gap, y: 10, "text-anchor": "end", fill: "var(--txt-ink)", style: "fill: var(--txt-ink); font-weight: 500" }, "text"),
      svg("text", { x: mid + gap, y: 10, style: "fill: var(--img-ink); font-weight: 500" }, "image"));
    for (let l = 15; l >= 0; l--) {
      const y = top + (15 - l) * rowH, wt = (p.txt[l] / max) * half, wi = (p.img[l] / max) * half;
      g.append(svg("text", { x: mid, y: y + 9, "text-anchor": "middle", style: "font-size: 8.5px" }, l % 3 === 0 || l === 15 ? `L${l}` : ""),
        svg("rect", { x: mid - gap - wt, y: y + 1.5, width: wt, height: rowH - 3, rx: 1.5, fill: "var(--txt)" }, svg("title", {}, `step ${st}, text sources at layer ${l}: ${Math.round(p.txt[l])} edges`)),
        svg("rect", { x: mid + gap, y: y + 1.5, width: wi, height: rowH - 3, rx: 1.5, fill: "var(--img)" }, svg("title", {}, `step ${st}, image sources at layer ${l}: ${Math.round(p.img[l])} edges`)));
    }
    return el("div", el("h5", `step ${st}`), g);
  };
  root.classList.add("plate");
  root.replaceChildren(el("div.card",
    el("p.kicker", "Where the edges come from", el("span", "by the stream and layer of their source")),
    el("div.layers", T.profile.map(panel)),
    el("p.note", `Median over the ${T.profile_n} targets at layer 12. A full bar is ${Math.round(max).toLocaleString("en-US")} edges.`)));
}

/** The causal test of the shift: the cat's text supernode suppressed early or late. */
export function mountTemporalTest(root, T) {
  root.classList.add("plate");
  root.replaceChildren(el("div.card",
    el("div.ttable.seeds3", testRows({ conditions: T.conditions, measure: T.measure, roles: T.roles },
      { title: el("p.kicker", "The test", el("span", "suppress the cat's text supernode early or late")) })),
    el("p.protocol", T.protocol)));
}

/** One statistic of the temporal analysis over the four noise levels on the three backbones (the paper's table of backbones). */
function backbones(rows, key) {
  const cross = key === "cross";
  const top = cross ? 0.3 : 1, ticks = cross ? [0, 0.1, 0.2, 0.3] : [0, 0.25, 0.5, 0.75, 1];
  const color = cross ? "var(--ink-2)" : "var(--img)";
  const W = 400, H = 230, L = 34, R = 122, T = 12, B = 22;
  const x = (k) => L + (k / 3) * (W - L - R), y = (v) => T + (1 - v / top) * (H - T - B);
  const what = cross ? "Fraction of edges that cross between the streams" : "Share of attribution from the image stream";
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart", role: "img",
    "aria-label": `${what} at four noise levels: ` + rows.map((r) => `${r.name} ${r[key].map((v) => pc(v)).join(", ")}`).join(". ") });
  for (const v of ticks) {
    root.append(svg("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "tick" }), svg("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end" }, `${Math.round(v * 100)}%`));
  }
  SIGMA.forEach((s, k) => root.append(svg("text", { x: x(k), y: H - 5, "text-anchor": "middle" }, `σ ${k ? "≈" : "="} ${s}`)));
  const s0 = rows[0], sd = s0[key + "_sd"];
  const band = s0[key].map((v, k) => `${x(k)},${y(Math.min(top, v + sd[k]))}`).concat(s0[key].map((v, k) => `${x(k)},${y(Math.max(0, v - sd[k]))}`).reverse());
  root.append(svg("polygon", { points: band.join(" "), fill: color, opacity: 0.1 }));
  const dash = ["", "6 4", "2 4"];
  // keep the end labels apart
  const order = rows.map((r, j) => [y(r[key][3]), j]).sort((a, b) => a[0] - b[0]);
  for (let k = 1; k < order.length; k++) if (order[k][0] - order[k - 1][0] < 14) order[k][0] = order[k - 1][0] + 14;
  const ly = [];
  order.forEach(([v, j]) => (ly[j] = v));
  rows.forEach((r, j) => {
    root.append(svg("polyline", { points: r[key].map((v, k) => `${x(k)},${y(v)}`).join(" "), fill: "none", stroke: color, "stroke-width": j === 0 ? 2.6 : 1.6, "stroke-dasharray": dash[j], "stroke-linejoin": "round" }));
    r[key].forEach((v, k) => root.append(svg("circle", { cx: x(k), cy: y(v), r: j === 0 ? 3.6 : 2.6, fill: color, stroke: "#fff", "stroke-width": 1.2 }, svg("title", {}, `${r.name}, σ ${k ? "≈" : "="} ${SIGMA[k]}: ${pc(v)} ± ${(r[key + "_sd"][k] * 100).toFixed(1)}`))));
    root.append(svg("text", { x: W - R + 9, y: ly[j] + 4, class: j === 0 ? "lab-strong" : "" }, `${r.name} ${pc(r[key][3])}`));
  });
  return root;
}

/** The key of the two backbone charts: the line of each model, and the band of FLUX.1 [schnell]. */
function backboneKey(rows) {
  const dash = ["", "6 4", "2 4"];
  const line = (j) => svg("svg", { class: "sw-line", viewBox: "0 0 26 10", "aria-hidden": "true" },
    svg("line", { x1: 1, x2: 25, y1: 5, y2: 5, stroke: "var(--ink-2)", "stroke-width": j === 0 ? 2.6 : 1.6, "stroke-dasharray": dash[j] }),
    svg("circle", { cx: 13, cy: 5, r: j === 0 ? 3.2 : 2.4, fill: "var(--ink-2)", stroke: "#fff", "stroke-width": 1 }));
  return el("ul.legend",
    rows.map((r, j) => el("li", line(j), r.name)),
    el("li", el("span.sw", { style: { background: "var(--ink-2)", opacity: 0.18 } }), `±1 s.d. of ${rows[0].name}`));
}

/** The same analysis on three backbones: the two statistics of the paper's table, side by side. */
export async function mountTemporalBackbones(root) {
  const stats = await STATS();
  root.classList.add("plate");
  root.replaceChildren(el("div.card",
    el("p.kicker", "The same analysis on three backbones", el("span", "20 targets each, at four matched noise levels")),
    el("div.twocharts",
      el("div", el("h5", "Attribution from the image stream"), backbones(stats, "img")),
      el("div", el("h5", "Edges that cross between the streams"), backbones(stats, "cross"))),
    backboneKey(stats),
    el("p.protocol", "Steps of FLUX.1 [dev]: 0, 19, 33, 42 of 50. SD3.5-medium: 0, 20, 29, 35 of 40.")));
}

/** The matched budget: six ways to choose the companions. First FLUX.1 [schnell] with the blind annotator's labels over
 *  8 prompts x 30 seeds and three seeds of two prompts, then the same grid on the three backbones, labeled by one
 *  vision-language model. */
export function mountBudget(root, B) {
  const share = (c, name) => {
    const x = c.dist.counts.find((r) => r[0] === name);
    return x ? x[1] : 0;
  };
  const shade = shades(B.roles);
  const legend = () => el("ul.legend", ["requested color", "red", "object destroyed"].map((name) =>
    el("li", el("span.sw", { style: { background: shade(null, name) } }), name === "red" ? "still red" : name)));
  // the bar under an image is the color of its label: an image is labeled with the color itself ("white")
  const small = (x) => {
    const t = thumb(x, null, null);
    if (x.label) t.style.setProperty("--c", shade(null, x.label === "red" || x.label === "object destroyed" ? x.label : "requested color"));
    return t;
  };
  const cs0 = B.variants[0].conditions;
  const rows = cs0.map((c, j) => {
    const n = c.dist.n, ok = share(c, "requested color"), red = share(c, "red"), lost = share(c, "object destroyed"), other = n - ok - red - lost;
    const seg = (cls, k, lab) => (k ? el("span." + cls, { style: { flexGrow: k }, title: `${lab}: ${k} of ${n}` }, k / n > 0.09 ? pct1(k, n) : "") : null);
    return el("div.bud-row" + (j === cs0.length - 1 ? ".ours" : ""),
      el("span.bar-name", c.label, c.sub ? [" ", el("span.t-alpha", c.sub)] : null),
      el("span.stack", { role: "img", "aria-label": `${c.label}: requested color ${pct1(ok, n)}%, still red ${pct1(red, n)}%, object destroyed ${pct1(lost, n)}%` },
        seg("ok", ok, "requested color"), seg("red", red, "still red"), seg("other", other, "other"), seg("lost", lost, "object destroyed")),
      el("span.bud-thumbs", B.variants.map((v) => el("span", v.conditions[j].cells.slice(0, 3).map(small)))));
  });
  const annotator = el("div.card",
    el("p.kicker", "FLUX.1 [schnell]", el("span", "labeled by the blind annotator. Percent of the 240 generations of each selection rule")),
    el("div.bud",
      el("div.bud-head", el("span", "selection of the three companions"), el("span"), el("span.bud-headthumbs", B.variants.map((v) => el("span", el("q", v.label))))),
      rows),
    legend(),
    el("p.protocol", B.protocol));

  // the three backbones: one bar per backbone and rule, the two numbers of the paper's table at its ends
  const one = (v) => v.toFixed(1);
  const bar = (b, r) => {
    const seg = (cls, v, lab) => (v ? el("span." + cls, { style: { flexGrow: v }, title: `${lab}: ${one(v)}%` }) : null);
    return el("span.bb-cell",
      el("span.bb-name", b.name),
      el("span.bb-num", { title: "requested color" }, one(r.ok)),
      el("span.stack", { role: "img", "aria-label": `${b.name}, ${r.label}: requested color ${one(r.ok)}%, still red ${one(r.red)}%, object destroyed ${one(r.lost)}%` },
        seg("ok", r.ok, "requested color"), seg("red", r.red, "still red"), seg("lost", r.lost, "object destroyed")),
      el("span.bb-num.lost", { title: "object destroyed" }, one(r.lost)));
  };
  const alphaOf = Object.fromEntries(cs0.map((c) => [c.label, c.sub]));
  const three = el("div.card",
    el("p.kicker", "Three backbones", el("span", "labeled by a vision-language model. Percent of the pairs whose baseline it judges red, the pairs in which the prior acts")),
    el("div.bb",
      el("div.bb-row.bb-head", el("span"), B.backbones.map((b) => el("span.bb-model", el("b", b.name), el("small", `${b.n} pairs, ${b.prompts} of the 8 prompts`)))),
      B.backbones[0].rules.map((r, j) => el("div.bb-row" + (r.id === "context" ? ".ours" : ""), el("span.bar-name", r.label, alphaOf[r.label] ? [" ", el("span.t-alpha", alphaOf[r.label])] : null), B.backbones.map((b) => bar(b, b.rules[j]))))),
    legend(),
    el("p.protocol", B.backbones_protocol));

  root.classList.add("plate");
  root.replaceChildren(annotator, three);
}
