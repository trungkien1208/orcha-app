// The right-click menu of a project or a pane (props().target), drawn in
// orcha's look. Closing actions sit last, in red.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, closeOverlay, openOverlay } from "herdr";
import { tokens, icon, readable } from "./ui.js";

function items(target) {
  if (target?.kind === "project") {
    return [
      ["chevron-right", "Open", "space.select", { id: target.id }],
      ["plus", "New tab", "tab.new", { space: target.id }],
      ["settings", "Rename…", "space.rename", { id: target.id }],
      ["zap", "Set icon…", null, { overlay: { mod: "orcha", props: { part: "icon", target }, kind: "dialog", width: 470, height: 260, frame: "none" } }],
      ["x", "Close project", "space.close", { id: target.id }, true],
    ];
  }
  return [
    ["chevron-right", "Focus", "pane.focus", { pane: target?.pane }],
    ["settings", "Rename tab…", "tab.rename", { id: target?.tab }],
    ["columns-2", "Split right", "pane.split", { direction: "right", pane: target?.pane }],
    ["maximize-2", "Zoom", "pane.zoom", { pane: target?.pane }],
    ["x", "Close pane", "pane.close", { pane: target?.pane }, true],
  ];
}

export default class Menu {
  constructor(_cx) {}

  render(_cx) {
    const k = tokens();
    const target = props()?.target;
    const close = () => closeOverlay(props()?.overlay);
    return v_flex()
      .id("orcha-menu")
      .w_full()
      .p(5)
      .rounded(8)
      .border(2.5)
      .border_color(k.line)
      .bg(k.card)
      .text_size(12.5)
      .child(div().px(8).pt(3).pb(5).text_size(11).font_black().text_color(k.dim).truncate().child((target?.name ?? "").toUpperCase()))
      .children(
        items(target).map(([name, label, command, args, danger], i) =>
          h_flex()
            .id(`orcha-menu-${i}`)
            .h(30)
            .px(8)
            .gap(9)
            .items_center()
            .rounded(5)
            .text_color(danger ? readable(k, k.red) : k.ink)
            .when(Boolean(danger), (el) => el.mt(i ? 4 : 0).border_t(1.5).border_color(k.dim + "55").rounded_t(0))
            .hover((el) => el.bg(k.hover))
            .on_click(() => {
              close();
              if (command) run(command, args);
              else if (args.overlay) openOverlay(args.overlay);
            })
            .child(icon(name, 14))
            .child(div().font_semibold().child(label)),
        ),
      );
  }
}
