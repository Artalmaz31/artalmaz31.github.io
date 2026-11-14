// The opening figure: all 30 seeds of "a white stop sign on the road" under three conditions, side by side.
// The counters are the blind annotator's labels.

import { el, signed, attachPeek } from "./util.js";
import { attachCard } from "./featcard.js";

export function mountHero(root, ex) {
  const scene = ex.scenes[0];
  const conds = scene.conditions;

  const panels = conds.map((c, j) => {
    const wall = el("div.wall", { role: "img", "aria-label": `Thirty generations of ${scene.prompt}: ${c.label}. ${c.k[0]} of ${c.k[1]} show a white sign.` },
      c.cells.map((x) => {
        const tile = el("span.tile" + (x.label === "white" ? "" : ".fade"),
          el("img", { src: x.src, alt: "", decoding: "async", loading: j === 0 ? "eager" : "lazy", width: 144, height: 144 }));
        attachPeek(tile, () => ({ src: x.src, text: x.label === "red" ? "still red" : x.label }));
        return tile;
      }));
    return el("div.wall-panel",
      el("p.wall-name", { title: c.label }, c.label),
      el("p.wall-num", el("b", String(c.k[0])), `of ${c.k[1]} white`),
      wall);
  });

  // the circuit in one line, with the weights of the graph
  const box = Object.fromEntries(scene.boxes.map((b) => [b.id, b]));
  const edge = Object.fromEntries(scene.edges.map((e) => [e.from, e.w]));
  const chip = (b, name) => {
    const n = el("button.feat." + (b.target ? "img" : "txt"), { type: "button" }, name);
    attachCard(n, { keys: b.keys, step: scene.step, title: b.n > 1 ? name : null, name: b.n === 1 ? name : null, count: b.n });
    return n;
  };
  const line = el("p.circuit-line",
    chip(box.obj, "stop sign"), el("span.arrow.pos", `${signed(edge.obj, 1)} →`), chip(box.t, "red"),
    el("span.arrow.neg", `← ${signed(edge.col, 1)}`), chip(box.col, "white"));

  // the strength is the same in both suppressed panels: said once, in the caption
  const alphas = [...new Set(conds.map((c) => c.sub).filter(Boolean))];

  root.replaceChildren(
    el("p.q", "Why does FLUX paint a white stop sign red?"),
    el("p.sub", "Because features on ", el("i.f", "stop sign"), " push its ", el("i.f", "red"), " feature up harder than ", el("i.f", "white"), " pushes it down. Suppress the red feature together with three of those sources, and the sign turns white on 27 of 30 seeds."),
    line,
    el("div.walls", panels),
    el("figcaption", "All 30 seeds of ", el("q.prompt", scene.prompt), " under each condition, none selected", alphas.length === 1 ? `, ${alphas[0]}.` : "."),
  );
}
