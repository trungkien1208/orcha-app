// A pane's title bar (SPEC §2 "Main"): in the agent's color with its model
// and task (`✳ OPUS 5.5 · dark mode`), a plain bar for a shell; split, zoom
// and close on the right.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, agents, props, run } from "herdr";
import { tokens, agentColor, programIcon, ownTitle, modelOf, icon } from "./ui.js";

export default class Pane {
  constructor(_cx) {}

  button(k, fg, id, name, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(fg)
      .hover((s) => s.bg(k.line + "22"))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(icon(name, 13, fg));
  }

  render(_cx) {
    const k = tokens();
    const id = props()?.pane;
    const p = panes().find((x) => x.pane === id);
    if (!p) return div();
    const isAgent = Boolean(p.program?.agent);
    const agent = agents().find((a) => a.pane === id);
    const bg = isAgent ? agentColor(k, p.program) : k.card;
    const fg = isAgent ? k.chipText : k.ink;
    const task = isAgent ? agent?.title || ownTitle(p) : ownTitle(p) || p.program?.name || "shell";
    const name = isAgent ? modelOf(p).toUpperCase() : null;
    return h_flex()
      .id(`orcha-pane-${id}`)
      .size_full()
      .px(10)
      .gap(7)
      .items_center()
      .bg(bg)
      .border_b(2)
      .border_color(k.line)
      .text_size(12)
      .text_color(fg)
      .on_click(() => run("pane.focus", { pane: id }))
      .child(programIcon(p.program, 13, fg) ?? icon("terminal", 13, fg))
      .when(Boolean(name), (el) => el.child(div().font_black().child(name)))
      .when(Boolean(name && task), (el) => el.child(div().font_black().child("·")))
      .child(div().flex_1().truncate().when(p.focused, (el) => el.font_bold()).child(task ?? ""))
      .when(!isAgent && Boolean(p.cwd), (el) => el.child(div().max_w(240).truncate().text_color(k.dim).child(p.cwd.replace(/^\/Users\/[^/]+/, "~"))))
      .child(this.button(k, fg, `op-r-${id}`, "columns-2", "pane.split", { direction: "right", pane: id }))
      .child(this.button(k, fg, `op-d-${id}`, "rows-2", "pane.split", { direction: "down", pane: id }))
      .child(this.button(k, fg, `op-z-${id}`, p.zoomed ? "minimize-2" : "maximize-2", "pane.zoom", { pane: id }))
      .child(this.button(k, fg, `op-x-${id}`, "x", "pane.close", { pane: id }));
  }
}
