// The right side's switch (INFO | FILES) over the stack below it: INFO is
// orcha's panel, FILES the project's files and search (files.js).

import { h_flex } from "gpui-base";
import { layout, run } from "herdr";
import { tokens, icon } from "./ui.js";

const STACK = "right-body";
const TABS = [
  { id: "info", label: "INFO", icon: "fuel" },
  { id: "files", label: "FILES", icon: "folder" },
];

// The stack's shown child, found in the layout tree.
function shownChild() {
  const find = (node) => {
    if (!node || typeof node !== "object") return null;
    if (node.id === STACK) return node.active ?? null;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return null;
  };
  return find(layout()) === "files" ? "files" : "info";
}

/** Shows INFO or FILES on the right. */
export function showSide(id) {
  run("layout.select", { stack: STACK, child: id === "files" ? "files" : "info" });
}

export default class SideTabs {
  constructor(_cx) {}

  render(_cx) {
    const k = tokens();
    const now = shownChild();
    return h_flex()
      .id("orcha-sidetabs")
      .size_full()
      .px(10)
      .pt(8)
      .bg(k.paper)
      .child(
        h_flex()
          .w_full()
          .h(28)
          .p(2)
          .gap(2)
          .rounded(6)
          .border(2)
          .border_color(k.line)
          .bg(k.card)
          .children(
            TABS.map((tab) => {
              const on = tab.id === now;
              return h_flex()
                .id(`orcha-side-${tab.id}`)
                .flex_1()
                .h_full()
                .gap(5)
                .justify_center()
                .items_center()
                .rounded(4)
                .bg(on ? k.ink : k.card)
                .text_size(11)
                .font_black()
                .text_color(on ? k.paper : k.muted)
                .cursor_pointer()
                .hover((s) => (on ? s : s.bg(k.hover)))
                .on_click(() => showSide(tab.id))
                .child(icon(tab.icon, 12, on ? k.paper : k.muted))
                .child(tab.label);
            }),
          ),
      );
  }
}
