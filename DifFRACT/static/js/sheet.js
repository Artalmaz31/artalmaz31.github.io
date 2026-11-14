// The feature sheet: the corpus examples of one image-stream feature at full size, in a dialog.

import { el, put, heatImage, b64bytes } from "./util.js";

let dlg;

const NOTE = "Marked: the patches where the feature reaches at least 20% of its strongest activation in that image.";

/** openSheet({ title, anon, meta, note, examples: [{ src, map, p, v }] }) */
export function openSheet({ title, anon, meta, note, examples }) {
  if (!dlg) {
    dlg = el("dialog.fsheet", { "aria-label": "Examples of a feature" });
    document.body.append(dlg);
    dlg.addEventListener("click", (e) => e.target === dlg && dlg.close());
  }
  const items = examples.map((x) => {
    const h = heatImage(x.src, { alt: x.p, eager: true, reveal: true });
    h.set(x.map ? b64bytes(x.map) : null);
    return { h, x };
  });
  put(dlg,
    el("header.fs-head",
      el("div", anon ? el("h3.fs-anon", title) : el("h3", el("i.featname", title)), meta ? el("p.fc-meta", meta) : null),
      el("button.fs-close", { type: "button", "aria-label": "Close", onclick: () => dlg.close() }, "×")),
    el("div.fs-grid", items.map(({ h, x }) => el("figure.fs-ex", h.node,
      el("figcaption", x.v != null ? el("span.ex-v", x.v.toFixed(1)) : null, " ", x.p)))),
    el("p.fs-note", note || NOTE));
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}
