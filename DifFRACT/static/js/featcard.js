// The feature card: what one transcoder feature fires on in the corpus, at the denoising step of the graph it was read in.
// One card for the whole page. It opens on hover or focus of an anchor, stays while the pointer is on it,
// and is pinned by a click or a tap (Esc or the close button dismisses it).

import { el, put, getJSON, heatImage, b64bytes, parseKey, streamName, hires, corpusSrc, tokenLine } from "./util.js";
import { openSheet } from "./sheet.js";

let LABELS = null;
const labels = () => (LABELS ||= getJSON("static/data/labels.json").catch(() => ({})));

/** The name of a feature at a step: a label is shown only at the steps where the corpus examples of that step fit it. */
export async function labelOf(key, step = 0) {
  const L = await labels();
  const e = L[key];
  return e && e.steps.includes(+step) ? e.name : null;
}

const featUrl = (key) => {
  const { layer, stream, f } = parseKey(key);
  return `static/data/feat/${stream}_${layer}/${f}.json`;
};

function textExample(x) {
  const line = x.t ? tokenLine(x.t, x.toks, { titles: true }) : el("p.ex-text", x.p);
  return el("li.ex", line, el("span.ex-v", x.v.toFixed(1)));
}

/** One example large, with the patches the feature fires on highlighted; the others as thumbnails; all of them enlarge in the sheet.
 * `hi` is the set of examples with a 512-px image: the large one and the sheet use it, the thumbnails the 192-px one. */
function imageExamples(list, sheet, hi) {
  if (!list.length) return [el("p.fc-note", "No corpus example at this step.")];
  const big = heatImage(corpusSrc(list[0], hi), { cls: "big", reveal: true, eager: true });
  const caption = el("p.ex-cap");
  const row = el("div.ex-thumbs");
  const enlarge = () => openSheet({ ...sheet, examples: list.map((x) => ({ src: corpusSrc(x, hi), map: x.map, p: x.p, v: x.v })) });
  big.node.title = "Enlarge";
  big.node.addEventListener("click", enlarge);
  // pointing at a thumbnail shows its example for as long as the pointer stays, a click makes it the shown one
  let chosen = list[0];
  const show = (x) => {
    big.img.src = corpusSrc(x, hi);
    big.img.alt = x.p;
    big.set(x.map ? b64bytes(x.map) : null);
    caption.replaceChildren(el("span.ex-v", x.v.toFixed(1)), " ", x.p);
  };
  const pick = (x, node) => {
    chosen = x;
    show(x);
    row.querySelectorAll(".on").forEach((n) => { n.classList.remove("on"); n.setAttribute("aria-pressed", "false"); });
    node.classList.add("on");
    node.setAttribute("aria-pressed", "true");
  };
  row.addEventListener("mouseleave", () => show(chosen));
  row.addEventListener("focusout", (ev) => { if (!row.contains(ev.relatedTarget)) show(chosen); });
  list.forEach((x, k) => {
    const h = heatImage(corpusSrc(x), { alt: x.p, small: true });
    if (x.map) h.set(b64bytes(x.map));
    const b = el("button.ex-thumb", { type: "button", "aria-pressed": "false", "aria-label": `Example ${k + 1}: ${x.p}` }, h.node);
    b.addEventListener("mouseenter", () => show(x));
    b.addEventListener("focus", () => show(x));
    b.addEventListener("click", () => pick(x, b));
    row.append(b);
    if (k === 0) pick(x, b);
  });
  return [el("div.ex-img", big.node, row), caption,
    el("p.fc-note", el("button.linkish", { type: "button", onclick: enlarge }, "Enlarge the examples"))];
}

export async function cardBody(key, step, given) {
  const { layer, stream, f } = parseKey(key);
  const name = given || (await labelOf(key, step));
  const head = el(
    "header.fc-head",
    name ? el("h4", el("i.featname", name)) : el("h4.fc-anon", `feature ${f}`),
    el("p.fc-meta", `${streamName(stream)}, layer ${layer}`, name ? `, feature ${f}` : ""),
  );
  const out = el("div.fc-body", head, el("p.state", "Loading its examples…"));
  Promise.all([getJSON(featUrl(key)), stream === "img" ? hires() : null])
    .then(([d, hi]) => {
      const st = d.by[String(step)] ? String(step) : Object.keys(d.by)[0];
      const list = (d.by[st] || []).slice().sort((a, b) => b.v - a.v);
      const title = el("p.fc-sub", `Strongest in the corpus at step ${st}`);
      const ex = stream === "txt" ? [el("ul.ex-list", list.map(textExample))]
        : imageExamples(list, { title: name || `feature ${f}`, anon: !name, meta: `${streamName(stream)}, layer ${layer}, feature ${f}. Strongest in the corpus at step ${st}` }, hi);
      const note = d.notes && d.notes[st] ? el("p.fc-note", d.notes[st]) : null;
      put(out, head, title, ex, note);
    })
    .catch((err) => out.replaceChildren(head, /: 404$/.test(err && err.message)
      ? el("p.fc-note", "The page's corpus runs recorded no examples of this feature.")
      : el("p.state.state-error", "Its examples could not be loaded.")));
  return out;
}

// ------------------------------------------------------------------ the single floating card
let card, hideTimer, showTimer, pinned = false, anchor = null;

function ensure() {
  if (card) return card;
  card = el("aside.featcard", { role: "dialog", "aria-label": "Feature", hidden: true });
  card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  card.addEventListener("mouseleave", () => !pinned && scheduleHide());
  document.body.append(card);
  document.addEventListener("keydown", (e) => e.key === "Escape" && !card.hidden && hide(true));
  document.addEventListener("pointerdown", (e) => {
    if (!card.hidden && pinned && !card.contains(e.target) && !(anchor && anchor.contains(e.target)) && !e.target.closest("dialog.fsheet")) hide(true);
  });
  addEventListener("scroll", () => !card.hidden && !pinned && hide(true), { passive: true });
  return card;
}

function place(a) {
  const r = a.getBoundingClientRect();
  const w = Math.min(400, innerWidth - 16);
  card.style.width = w + "px";
  if (innerWidth < 640) {
    card.classList.add("sheet");
    card.style.left = card.style.top = "";
    return;
  }
  card.classList.remove("sheet");
  const h = card.offsetHeight || 320;
  let left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  let top = r.bottom + 8;
  if (top + h > innerHeight - 8) top = Math.max(8, r.top - h - 8);
  card.style.left = left + "px";
  card.style.top = top + "px";
}

async function show(a, spec, pin) {
  ensure();
  clearTimeout(hideTimer);
  anchor = a;
  pinned = !!pin;
  const keys = spec.keys;
  const tabs = el("div.fc-tabs", { role: "tablist" });
  const pane = el("div.fc-pane");
  const select = async (k) => {
    [...tabs.children].forEach((t, j) => t.setAttribute("aria-selected", j === k ? "true" : "false"));
    pane.replaceChildren(await cardBody(keys[k], spec.step ?? 0, keys.length === 1 ? spec.name : null));
    requestAnimationFrame(() => place(a));
  };
  if (keys.length > 1) {
    keys.forEach((key, k) => {
      const { layer, f } = parseKey(key);
      const t = el("button", { type: "button", role: "tab", onclick: () => select(k), title: key }, `L${layer} ${f}`);
      tabs.append(t);
    });
  }
  const head = spec.title
    ? el("div.fc-group", el("strong", spec.title), spec.count > keys.length ? `, the ${keys.length} most influential of ${spec.count} features` : keys.length > 1 ? `, ${keys.length} features` : "",
      spec.note ? el("p.fc-note", spec.note) : null)
    : null;
  const close = el("button.fc-close", { type: "button", "aria-label": "Close", onclick: () => hide(true) }, "×");
  put(card, close, head, keys.length > 1 ? tabs : null, pane);
  card.hidden = false;
  card.classList.toggle("pinned", pinned);
  await select(0);
  place(a);
}

function hide(now) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!card) return;
  if (now) {
    card.hidden = true;
    pinned = false;
    anchor = null;
  }
}
const scheduleHide = () => {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => hide(true), 180);
};

/** Make `node` open the card for `spec` = {keys: [...], step, name?, title?, count?}. */
export function attachCard(node, spec, { hover = true } = {}) {
  const get = typeof spec === "function" ? spec : () => spec;
  node.addEventListener("mouseenter", () => {
    if (pinned || !hover) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(node, get(), false), 140);
  });
  node.addEventListener("mouseleave", () => {
    clearTimeout(showTimer);
    if (!pinned) scheduleHide();
  });
  node.addEventListener("click", (e) => {
    e.preventDefault();
    if (pinned && anchor === node) hide(true);
    else show(node, get(), true);
  });
}

/** Feature chips in the prose: <button class="feat" data-key="L7/txt/17694" data-step="0">dog-suppressor</button> */
export function wireChips(root = document) {
  root.querySelectorAll("button.feat[data-key]").forEach((b) => {
    if (b.dataset.wired) return;
    b.dataset.wired = "1";
    b.type = "button";
    const { stream } = parseKey(b.dataset.key);
    b.classList.add(stream);
    attachCard(b, { keys: b.dataset.key.split(","), step: +(b.dataset.step || 0), name: b.dataset.key.includes(",") ? null : b.textContent.trim(), title: b.dataset.key.includes(",") ? b.textContent.trim() : null });
  });
}
