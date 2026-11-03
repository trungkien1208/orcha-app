// Tabs in the main frame's top edge (SPEC §2 "Main"): name and state dot;
// the open tab in ink and bold; more than six fold into `+N`; `+` opens a tab.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, openOverlay } from "herdr";
import { tokens, dot, icon, ownTitle } from "./ui.js";

const SHOWN = 6;

export default class Tabs {
  constructor(_cx) {}

  // A tab someone named keeps its name; else what its agent works on, else
  // its first program, else its number.
  label(tab, allPanes, byPane) {
    if (tab.named) return tab.name;
    const mine = allPanes.filter((p) => p.tab === tab.id);
    const lead = mine.find((p) => p.program?.agent) ?? mine[0];
    return byPane.get(lead?.pane)?.title || ownTitle(lead) || lead?.program?.name || tab.name;
  }

  tab(k, tab, label) {
    const open = tab.active;
    return h_flex()
      .id(`orcha-tab-${tab.id}`)
      .h(26)
      .px(10)
      .gap(6)
      .items_center()
      .rounded(5)
      .border(2)
      .border_color(k.line)
      .bg(open ? k.ink : k.card)
      .text_size(12)
      .text_color(open ? k.paper : k.ink)
      .when(open, (el) => el.font_black())
      .cursor_pointer()
      .hover((el) => (open ? el : el.bg(k.hover)))
      .on_click(() => run("tab.select", { id: tab.id }))
      .on_mouse_down("middle", () => run("tab.close", { id: tab.id }))
      .when(Boolean(tab.status), (el) => el.child(dot(k, tab.status, 7)))
      .child(div().max_w(200).truncate().child(label));
  }

  render(_cx) {
    const k = tokens();
    const space = spaces().find((s) => s.active);
    const tabs = space?.tabs ?? [];
    const allPanes = panes();
    const byPane = new Map(agents().map((a) => [a.pane, a]));
    const open = tabs.findIndex((t) => t.active);
    // Keep the open tab among the shown ones.
    const start = Math.max(0, Math.min(open - SHOWN + 1, tabs.length - SHOWN));
    const shown = tabs.slice(start, start + SHOWN);
    const hidden = tabs.length - shown.length;
    return h_flex()
      .id("orcha-tabs")
      .size_full()
      .px(10)
      .gap(6)
      .items_center()
      .bg(k.frame)
      .border_b(2)
      .border_color(k.line)
      .children(shown.map((t) => this.tab(k, t, this.label(t, allPanes, byPane))))
      .when(hidden > 0, (el) =>
        el.child(
          div()
            .id("orcha-tabs-more")
            .px(8)
            .h(26)
            .flex()
            .items_center()
            .rounded(5)
            .border(2)
            .border_dashed()
            .border_color(k.dim)
            .text_size(12)
            .font_bold()
            .text_color(k.muted)
            .cursor_pointer()
            .on_click(() => run("app.palette"))
            .child(`+${hidden} ▾`),
        ),
      )
      .child(
        div()
          .id("orcha-tab-new")
          .size(26)
          .flex()
          .items_center()
          .justify_center()
          .rounded(5)
          .border(2)
          .border_color(k.line)
          .bg(k.card)
          .font_black()
          .text_color(k.ink)
          .cursor_pointer()
          .hover((el) => el.bg(k.hover))
          .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }))
          .child(icon("plus", 14, k.ink)),
      )
      .child(div().flex_1());
  }
}
