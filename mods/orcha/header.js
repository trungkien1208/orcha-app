// The header, one row over the whole window (SPEC §2 "Header"): the raised
// ORCHA chip, then counts as colored pills (projects, running, needs you),
// a search box in the middle that opens FIND, and square buttons for the
// command palette, ACCOUNTS and settings. macOS keeps its window buttons at the left, so it
// leaves them room. Dragging it moves the window.
//
// The header is the one copy of orcha that listens for its keys (keys.json,
// layout:orcha): orcha.settings (⌘,), orcha.find-file (⌘O), orcha.find-text (⌘⇧F),
// orcha.find-pane (⌘F), orcha.find-link (⌘L) open FIND (finder.js).

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, run, window, openOverlay, nextCommand } from "herdr";
import { tokens, chip, raised, icon, pill } from "./ui.js";

// A square icon button with a hard shadow, like the other raised things.
function square(k, id, name, tip, onClick) {
  const el = div()
    .id(id)
    .size(28)
    .flex()
    .items_center()
    .justify_center()
    .rounded(6)
    .border(2)
    .border_color(k.line)
    .bg(k.card)
    .cursor_pointer()
    .hover((s) => s.bg(k.hover))
    .tooltip(tip)
    .on_click((_e, cx) => {
      cx.stop_propagation();
      onClick();
    })
    .child(icon(name, 15, k.ink));
  return raised(k, el, 2, 6);
}

/** Opens SETTINGS: Herdr's settings with orcha's on top (settings.js). */
export function openSettings() {
  openOverlay({ mod: "orcha", props: { part: "settings" }, kind: "dialog", width: 900, height: 620 });
}

/** Opens FIND on one of its tabs: "file", "text", "pane" or "links". */
export function openFinder(mode) {
  openOverlay({ mod: "orcha", props: { part: "finder", mode }, kind: "dialog", width: 650, height: 470, frame: "none" });
}

export default class Header {
  constructor(cx) {
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        const mode = { "find-file": "file", "find-text": "text", "find-pane": "pane", "find-link": "links" }[command];
        if (mode) openFinder(mode);
        else if (command === "settings") openSettings();
      }
    });
  }

  render(_cx) {
    const k = tokens();
    const projects = spaces().length;
    const list = agents();
    const working = list.filter((a) => a.status === "working").length;
    const needs = list.filter((a) => a.status === "blocked").length;
    const mac = window()?.platform === "macos";
    const search = raised(
      k,
      h_flex()
        .id("orcha-search")
        .w_full()
        .h(28)
        .px(10)
        .gap(8)
        .items_center()
        .rounded(6)
        .border(2)
        .border_color(k.line)
        .bg(k.card)
        .cursor_pointer()
        .hover((s) => s.bg(k.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          openFinder("file");
        })
        .child(icon("search", 14, k.muted))
        .child(div().flex_1().truncate().text_size(12).text_color(k.muted).child("Search files and text"))
        .child(chip(k, "⌘O", k.raised, k.dim).border(1.5).border_color(k.dim))
        .child(chip(k, "⌘⇧F", k.raised, k.dim).border(1.5).border_color(k.dim)),
      2,
      6,
    );
    return h_flex()
      .id("orcha-header")
      .size_full()
      .pl(mac ? 84 : 14)
      .pr(12)
      .gap(10)
      .items_center()
      .bg(k.paper)
      .border_b(2.5)
      .border_color(k.line)
      .child(raised(k, chip(k, "🐋 ORCHA", k.pink).h(26).px(10).text_size(13).border(2).border_color(k.line), 2, 5))
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(pill(k, `${projects} projects`, k.dim))
          .when(working > 0, (el) => el.child(pill(k, `${working} running`, k.yellow)))
          .when(needs > 0, (el) => el.child(pill(k, `${needs} needs you`, k.red).loop("opacity", { from: 0.55, to: 1, period: 1200 }))),
      )
      .child(div().flex_1())
      .child(div().w(340).flex_shrink(1).min_w(160).child(search))
      .child(div().flex_1())
      .child(square(k, "orcha-palette", "command", "Commands (⌘⇧P)", () => run("app.palette")))
      .child(square(k, "orcha-accounts", "user-round", "Accounts", () => openOverlay({ mod: "orcha", props: { part: "accounts" }, kind: "dialog", width: 560, frame: "none" })))
      .child(square(k, "orcha-settings", "settings", "Settings (⌘,)", openSettings));
  }
}
