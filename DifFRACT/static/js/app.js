// Boot: mount the opening figure, then each figure as it comes near the viewport.

import { $, $$, el, getJSON, lazy } from "./util.js";
import { wireChips } from "./featcard.js";
import { mountHero } from "./hero.js";
import { mountExhibit, mountRows } from "./exhibit.js";
import { mountTemporalSteps, mountTemporalLayers, mountTemporalTest, mountTemporalBackbones, mountBudget } from "./panels.js";

const EX = getJSON("static/data/exhibits.json");

/** Open the explorer on a graph, with the groups of a figure pinned. The explorer's code loads on first use. */
async function openGraph(spec) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const m = await import("./explorer.js");
      return m.openExplorer(spec);
    } catch (err) {
      if (attempt) alert("The graph explorer could not be loaded. Check the connection and try again.");
    }
  }
}

// an image whose request was dropped is asked for once more
document.addEventListener("error", (e) => {
  const im = e.target;
  if (im.tagName !== "IMG" || im.dataset.retried || !im.getAttribute("src")) return;
  im.dataset.retried = "1";
  setTimeout(() => im.setAttribute("src", im.getAttribute("src")), 700);
}, true);
const sceneSpec = (scene) => ({
  graph: scene.graph,
  groups: scene.boxes.filter((b) => !b.target && b.n && b.keys.length <= 6).map((b) => ({ label: b.label, keys: b.keys })),
});

document.documentElement.dataset.app = "on"; // the page checks this to tell a script that failed to load
wireChips();

const hero = $("#hero-fig");
if (hero) {
  EX.then((E) => mountHero(hero, E.hero)).catch(() => hero.replaceChildren(el("p.state.state-error", "The opening figure could not be loaded. Reload the page to try again.")));
}

$$("[data-exhibit]").forEach((node) =>
  lazy(node, async (n) => {
    const E = await EX;
    // data-scenes="1" shows only that scene of the exhibit: a case with two experiments is two figures
    const only = n.dataset.scenes ? n.dataset.scenes.split(",").map(Number) : null;
    mountExhibit(n, E[n.dataset.exhibit], { onOpen: (scene) => openGraph(sceneSpec(scene)), only });
  }));

$$("[data-rows]").forEach((node) => lazy(node, async (n) => mountRows(n, (await EX)[n.dataset.rows])));

// the two phases of denoising: four small figures, each next to its paragraph
const TEMPO = {
  "#fig-tempo-steps": async (n) => mountTemporalSteps(n, (await EX).temporal, { onOpen: (s) => openGraph({ graph: s.graph, groups: [{ label: s.label, keys: s.pins }] }) }),
  "#fig-tempo-layers": async (n) => mountTemporalLayers(n, (await EX).temporal),
  "#fig-tempo-test": async (n) => mountTemporalTest(n, (await EX).temporal),
  "#fig-tempo-backbones": (n) => mountTemporalBackbones(n),
};
for (const [sel, mount] of Object.entries(TEMPO)) {
  const node = $(sel);
  if (node) lazy(node, mount);
}

const build = $("#fig-build");
if (build) import("./buildfig.js").then((m) => m.mountBuildFigure(build)).catch((err) => console.error(err));

const budget = $("#fig-budget");
if (budget) lazy(budget, async (n) => mountBudget(n, (await EX).budget));

const atlas = $("#atlas");
if (atlas) lazy(atlas, async (n) => (await import("./atlas.js")).mountAtlas(n), { label: "Loading the dictionary" });

const launch = $("#launch");
if (launch) lazy(launch, async (n) => (await import("./explorer.js")).mountLauncher(n), { label: "Loading the list of graphs" });

// fold-out sections with the material of the paper's appendix: loaded when first opened (tools/math/build_folds.mjs)
for (const d of $$("details[data-fold]")) {
  const box = $(".fold", d);
  const load = async () => {
    if (d.dataset.loaded) return;
    d.dataset.loaded = "1";
    try {
      const r = await fetch(`static/folds/${d.dataset.fold}.html`);
      if (!r.ok) throw new Error(r.status);
      box.innerHTML = await r.text();
      wireChips(box);
    } catch {
      delete d.dataset.loaded;
      box.replaceChildren(el("p.state.state-error", "This section could not be loaded. ", el("button.linkish", { type: "button", onclick: load }, "Try again")));
    }
  };
  d.addEventListener("toggle", () => d.open && load());
  if (d.open) load();
}
// a fold named in the address opens: #fold-attribution
const openFold = () => {
  const d = location.hash.startsWith("#fold-") && document.getElementById(location.hash.slice(1));
  if (d && d.tagName === "DETAILS") {
    d.open = true;
    d.scrollIntoView({ block: "start" });
  }
};
addEventListener("hashchange", openFold);
openFold();

// a graph named in the address opens at once: ?graph=dog-couch&groups=...
if (new URLSearchParams(location.search).get("graph")) import("./explorer.js").then((m) => m.openFromAddress());

// links that open a graph: <a data-graph="dog-couch">
$$("[data-graph]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openGraph({ graph: a.dataset.graph }); }));

// every case study opens with its finding: the sentence of its card in the index
for (const a of $$(".index a")) {
  const cs = document.getElementById(a.getAttribute("href").slice(1));
  const what = $(".what", a);
  const h = cs && $("h3", cs);
  if (h && what && !$(".takeaway", cs)) h.after(el("p.takeaway", { html: what.innerHTML }));
}

// an in-page link: the figures mounted on the way change the height above the target, so a plain jump (or the CSS smooth
// scroll) stops short of a section far down. The scroll follows the target until it stays put, unless the reader scrolls.
function goTo(target, smooth) {
  const pad = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const goal = () => Math.min(target.getBoundingClientRect().top + scrollY - pad, document.documentElement.scrollHeight - innerHeight);
  let stop = false, last = goal(), still = 0, ticks = 0;
  const cancel = () => (stop = true);
  const done = () => ["wheel", "touchstart", "keydown"].forEach((t) => removeEventListener(t, cancel));
  ["wheel", "touchstart", "keydown"].forEach((t) => addEventListener(t, cancel, { passive: true }));
  scrollTo({ top: last, behavior: smooth ? "smooth" : "auto" });
  const tick = () => {
    if (stop || ++ticks > 100) return done();
    const now = goal();
    if (Math.abs(now - last) > 1) { last = now; still = 0; scrollTo({ top: now, behavior: smooth ? "smooth" : "auto" }); }
    else if (Math.abs(scrollY - now) < 2) still++;
    if (still < 4) setTimeout(tick, 100);
    else done();
  };
  setTimeout(tick, 100);
}
const smoothOK = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const id = decodeURIComponent(a.getAttribute("href").slice(1));
  const target = id && document.getElementById(id);
  if (!target || target.tagName === "DETAILS") return;   // a fold opens through the hash (openFold)
  e.preventDefault();
  if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
  goTo(target, smoothOK());
});
// opened at an address with a section: the browser jumps before the figures above it have mounted
if (location.hash && !location.hash.startsWith("#fold-")) {
  const t = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (t) goTo(t, false);
}

// the section in view, in the top bar
const links = new Map($$(".topnav a").map((a) => [a.getAttribute("href").slice(1), a]));
const spied = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
let spyQueued = false;
const spy = () => {
  spyQueued = false;
  // the last section whose top has passed the upper third of the window; none above the first one
  const line = innerHeight * 0.33;
  let cur = null;
  for (const s of spied) if (s.getBoundingClientRect().top <= line) cur = s.id;
  links.forEach((a, id) => a.setAttribute("aria-current", id === cur ? "true" : "false"));
};
addEventListener("scroll", () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
addEventListener("resize", spy);
spy();

// clips play only while they are on screen; with reduced motion they wait for the reader to press play
const clips = $$("video[data-autoplay]");
if (clips.length) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) clips.forEach((v) => (v.controls = true));
  else {
    const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? e.target.play().catch(() => (e.target.controls = true)) : e.target.pause())), { threshold: 0.35 });
    clips.forEach((v) => io.observe(v));
  }
}

// copy the citation
$$("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const text = document.getElementById(b.dataset.copy).textContent.trim();
  try {
    await navigator.clipboard.writeText(text);
    b.textContent = "Copied";
  } catch {
    b.textContent = "Select and copy";
  }
  setTimeout(() => (b.textContent = "Copy"), 1600);
}));
