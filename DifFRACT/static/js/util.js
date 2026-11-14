// Small helpers shared by every part of the page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el("div.cls#id", {attr: value, onclick: fn}, child, "text", [children]) */
/** A prompt as its tokens, each tinted by how strongly a text feature fires on it. The end-of-sequence token is
 *  shown, as "end", only where the feature fires on it, so that a feature of that token is not an empty line. */
export function tokenLine(tokens, toks, { titles = false } = {}) {
  const acts = new Map(toks || []);
  const max = Math.max(1e-9, ...acts.values());
  const line = el("p.ex-text");
  tokens.forEach((tok, j) => {
    const a = (acts.get(j) || 0) / max, hit = a >= 0.08, end = tok === "</s>";
    if (end && !hit) return;
    const span = end ? el("span.tok-end", "end") : el("span", tok);
    if (hit) {
      span.classList.add("tokhit");
      span.style.setProperty("--a", a.toFixed(2));
      if (titles) span.title = `activation ${acts.get(j)}`;
    }
    line.append(end ? " " : "", span);
  });
  return line;
}

export function el(spec, attrs, ...kids) {
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const node = document.createElement(tag || "div");
  for (const r of rest) {
    if (r[0] === ".") node.classList.add(r.slice(1));
    else node.id = r.slice(1);
  }
  if (attrs && (attrs.nodeType || typeof attrs !== "object" || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "html") node.innerHTML = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) p.startsWith("--") ? node.style.setProperty(p, val) : (node.style[p] = val);
    }
    else if (k in node && k !== "list" && typeof v !== "string") node[k] = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const k of kids.flat(3)) {
    if (k == null || k === false) continue;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return node;
}

/** replaceChildren that skips null and false. */
export function put(node, ...kids) {
  node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs, ...kids) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const k of kids.flat(3)) {
    if (k == null || k === false) continue;
    node.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return node;
}

const cache = new Map();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
/** JSON with one shared request per URL. A network failure is retried twice; a request that still fails is not cached. */
export function getJSON(url) {
  if (!cache.has(url)) {
    const p = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const r = await fetch(url);
          if (!r.ok) throw Object.assign(new Error(`${url}: ${r.status}`), { final: r.status < 500 });
          return await r.json();
        } catch (err) {
          if (err.final || attempt >= 2) throw err;
          await pause(350 * (attempt + 1));
        }
      }
    })();
    p.catch(() => cache.delete(url));
    cache.set(url, p);
  }
  return cache.get(url);
}

/** Run `mount` when the element comes within a screen of the viewport; show a line of text while loading and a retry on failure. */
export function lazy(node, mount, { label = "Loading the figure" } = {}) {
  let started = false;
  const run = async () => {
    started = true;
    node.replaceChildren(el("p.state", label + "…"));
    node.setAttribute("aria-busy", "true");
    try {
      await mount(node);
    } catch (err) {
      console.error(err);
      node.replaceChildren(
        el("p.state.state-error", "This figure could not be loaded. ", el("button.linkish", { type: "button", onclick: run }, "Try again")),
      );
    }
    node.removeAttribute("aria-busy");
  };
  const io = new IntersectionObserver(
    (entries) => {
      if (!started && entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    },
    { rootMargin: "900px 0px" },
  );
  io.observe(node);
}

export const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Paint a 32 x 32 activation map (bytes 0..255, relative to the map's own maximum) over an image: the patches the feature
 * fires on are tinted yellow, denser where it fires harder, and outlined patch by patch. The rest of the image is left
 * untouched. As in the paper's figures, an activation under 20% of the map's maximum counts as silent.
 * `cell` is the size of one patch on the canvas: 16 for an image shown large, 6 for a thumbnail.
 */
export function paintAccent(canvas, bytes, { floor = 0.2, cell = 16 } = {}) {
  const n = 32, c = cell, W = n * c;
  canvas.width = canvas.height = W;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, W);
  const on = (x, y) => x >= 0 && y >= 0 && x < n && y < n && bytes[n * y + x] / 255 >= floor;
  for (let i = 0; i < n * n; i++) {
    const a = bytes[i] / 255;
    if (a < floor) continue;
    ctx.fillStyle = `rgba(255, 196, 0, ${(0.2 + 0.42 * Math.min(1, (a - floor) / 0.6)).toFixed(3)})`;
    ctx.fillRect((i % n) * c, Math.floor(i / n) * c, c, c);
  }
  const edge = new Path2D();
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) (edge.moveTo(x * c, y * c), edge.lineTo((x + 1) * c, y * c));
      if (!on(x, y + 1)) (edge.moveTo(x * c, (y + 1) * c), edge.lineTo((x + 1) * c, (y + 1) * c));
      if (!on(x - 1, y)) (edge.moveTo(x * c, y * c), edge.lineTo(x * c, (y + 1) * c));
      if (!on(x + 1, y)) (edge.moveTo((x + 1) * c, y * c), edge.lineTo((x + 1) * c, (y + 1) * c));
    }
  }
  ctx.lineCap = "square";
  ctx.strokeStyle = "rgba(9, 11, 15, 0.5)";
  ctx.lineWidth = Math.max(2, c * 0.28);
  ctx.stroke(edge);
  ctx.strokeStyle = "#ffc400";
  ctx.lineWidth = Math.max(1, c * 0.125);
  ctx.stroke(edge);
}

/** Corpus images: run 4's 192-px previews for every example, 512-px ones (run 6, the same generations) for those the page enlarges. */
let HIRES = null;
export const hires = () => (HIRES ||= getJSON("static/data/hires.json").then((d) => {
  const s = new Set();
  let i = 0;
  d.i.forEach((di, k) => {
    i += di;
    for (let st = 0; st < 8; st++) if (d.m[k] >> st & 1) s.add(`${i}_s${st}`);
  });
  return s;
}).catch(() => new Set()));
export const corpusSrc = (x, big = null) => (big && big.has(`${x.i}_s${x.st}`) ? `static/img/corpus512/${x.i}_s${x.st}.webp` : `static/img/corpus/${x.i}_s${x.st}.webp`);

/**
 * An image with the map of a feature over it: `set(bytes)` highlights the patches the feature fires on, `set(null)` shows the
 * plain image. With `reveal`, the marks lift while the pointer is on the image. `small` is for thumbnails.
 */
export function heatImage(src, { alt = "", cls = "", reveal = false, eager = false, small = false } = {}) {
  const canvas = el("canvas.heat");
  const img = el("img", { src, alt, loading: eager ? "eager" : "lazy", decoding: "async" });
  const box = el("span.heatimg" + (cls ? "." + cls : "") + (reveal ? ".reveal" : ""), img, canvas);
  const set = (bytes) => {
    if (!bytes) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    paintAccent(canvas, bytes, { cell: small ? 6 : 16 });
  };
  set(null);
  return { node: box, set, img };
}

/**
 * A larger look at a small image while the pointer is on it (nothing to press, and nothing on a touch screen).
 * `info()` gives { src, text }.
 */
let peekBox = null;
export function attachPeek(node, info) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  node.addEventListener("mouseenter", () => {
    const { src, text } = info();
    if (!peekBox) {
      peekBox = el("div.peek", { hidden: true }, el("img", { alt: "" }), el("p"));
      document.body.append(peekBox);
      addEventListener("scroll", () => (peekBox.hidden = true), { passive: true });
    }
    peekBox.firstChild.src = src;
    peekBox.lastChild.textContent = text || "";
    peekBox.lastChild.hidden = !text;
    peekBox.hidden = false;
    const r = node.getBoundingClientRect(), w = 300, h = peekBox.offsetHeight || 340;
    const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const top = r.top - h - 10 >= 8 ? r.top - h - 10 : Math.min(innerHeight - h - 8, r.bottom + 10);
    peekBox.style.left = left + "px";
    peekBox.style.top = top + "px";
  });
  node.addEventListener("mouseleave", () => peekBox && (peekBox.hidden = true));
}

/** Percent with one decimal, half rounded to even, as the paper's tables print it (135/240 -> 56.2). */
export function pct1(k, n) {
  const t = (1000 * k) / n;
  const f = Math.floor(t);
  const r = Math.abs(t - f - 0.5) < 1e-9 ? (f % 2 === 0 ? f : f + 1) : Math.round(t);
  return (r / 10).toFixed(1);
}
export const pct = (k, n) => pct1(k, n).replace(/\.0$/, "");

export const signed = (x, d = 2) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d);

/** "L7/txt/17694" -> {layer: 7, stream: "txt", f: 17694} */
export function parseKey(key) {
  const [l, s, f] = key.split("/");
  return { layer: +l.slice(1), stream: s, f: +f };
}
export const streamName = (s) => (s === "img" ? "image stream" : "text stream");

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let uid = 0;
export const nextId = (p = "id") => `${p}-${++uid}`;
