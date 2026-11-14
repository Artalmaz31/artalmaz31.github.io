// The dictionary of layers 6 and 12: for each feature, the corpus prompts on which it fires most and where it fires in them.
// Data: static/data/browser/<stream>_<layer>.json (integrate_assets.py, build_atlas.py).

import { el, put, getJSON, heatImage, b64bytes, hires, corpusSrc, tokenLine } from "./util.js";
import { openSheet } from "./sheet.js";

const TABS = [["img_12", "Image stream, layer 12"], ["txt_12", "Text stream, layer 12"], ["img_6", "Image stream, layer 6"], ["txt_6", "Text stream, layer 6"]];
const PAGE = 12;

function profile(e) {
  const p = e.prof5 || e.prof;
  const max = Math.max(...p, 1e-9);
  return [
    el("div.prof", { role: "img", "aria-label": "Mean activation over its five strongest prompts at steps 0 to 3: " + p.map((v) => v.toFixed(1)).join(", ") }, p.map((v) => el("i", { style: { height: `${(v / max) * 100}%` } }))),
    el("p.prof-cap", el("span", "step 0"), el("span", "activation by step"), el("span", "3")),
  ];
}

function imageCard(f, e, d, hi) {
  const src = (x) => corpusSrc(x, hi);
  const big = heatImage(src(e.ex[0]), { cls: "big", reveal: true });
  big.node.title = "Enlarge";
  big.node.addEventListener("click", () => openSheet({
    title: e.name || `feature ${f}`, anon: !e.name, meta: `${d.label}, feature ${f}` + (e.desc ? `. ${e.desc}` : ""),
    examples: e.ex.map((x) => ({ src: src(x), map: x.map, p: `${d.p[x.i]} (step ${x.st})` })),
  }));
  const cap = el("p.cap");
  const thumbs = el("div.thumbs");
  // pointing at a thumbnail shows its example for as long as the pointer stays, a click makes it the shown one
  let chosen = e.ex[0];
  const show = (x) => {
    big.img.src = src(x);
    big.img.alt = d.p[x.i];
    big.set(x.map ? b64bytes(x.map) : null);
    cap.textContent = `${d.p[x.i]} (step ${x.st})`;
  };
  const pick = (x, b) => {
    chosen = x;
    show(x);
    [...thumbs.children].forEach((c) => c.setAttribute("aria-pressed", c === b ? "true" : "false"));
  };
  thumbs.addEventListener("mouseleave", () => show(chosen));
  thumbs.addEventListener("focusout", (ev) => { if (!thumbs.contains(ev.relatedTarget)) show(chosen); });
  e.ex.slice(0, 5).forEach((x, k) => {
    const h = heatImage(corpusSrc(x), { alt: d.p[x.i], small: true });
    if (x.map) h.set(b64bytes(x.map));
    const b = el("button", { type: "button", "aria-pressed": "false", "aria-label": `Example ${k + 1}: ${d.p[x.i]}`, onclick: () => pick(x, b), onmouseenter: () => show(x), onfocus: () => show(x) }, h.node);
    thumbs.append(b);
    if (k === 0) pick(x, b);
  });
  return [big.node, thumbs, cap];
}

function textCard(f, e, d) {
  return el("ul.ex-list", e.ex.slice(0, 4).map((x) => el("li.ex", tokenLine(d.t[x.i] || [], x.toks), el("span.ex-v", `s${x.st}`))));
}

export async function mountAtlas(root) {
  let tab = 0, shown = PAGE;
  const tabs = el("div.tabs", { role: "tablist", "aria-label": "Transcoder" });
  const grid = el("div.atlas-grid");
  const more = el("div.atlas-more");
  async function draw() {
    put(tabs, TABS.map(([, name], j) => el("button", { type: "button", role: "tab", "aria-selected": j === tab ? "true" : "false", onclick: () => { tab = j; shown = PAGE; draw(); } }, name)));
    put(grid, el("p.state", "Loading the features…"));
    let d;
    try {
      d = await getJSON(`static/data/browser/${TABS[tab][0]}.json`);
      d.hi = await hires();
    } catch {
      put(grid, el("p.state.state-error", "The features could not be loaded. ", el("button.linkish", { type: "button", onclick: draw }, "Try again")));
      return;
    }
    const stream = TABS[tab][0].split("_")[0];
    d.label = TABS[tab][1];
    const ids = d.order.slice(0, shown);
    put(grid, ids.map((f) => {
      const e = d.f[f];
      return el("article.acard", e.name ? el("h4", el("i.featname", e.name)) : el("h4.anon", `feature ${f}`),
        el("p.desc", e.desc || (e.name ? "" : `${TABS[tab][0].replace("_", "-")}-${f}`)),
        stream === "img" ? imageCard(f, e, d, d.hi) : textCard(f, e, d), profile(e));
    }));
    put(more, shown < d.order.length ? el("button.btn.ghost", { type: "button", onclick: () => { shown += PAGE; draw(); } }, `Show ${Math.min(PAGE, d.order.length - shown)} more of ${d.order.length}`) : null);
  }
  put(root, tabs, grid, more);
  await draw();
}
