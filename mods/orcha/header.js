// The header, one row over the whole window (SPEC §2 "Header"): the pink
// ORCHA chip, how many projects and agents, and `⌘, settings`. macOS keeps
// its window buttons at the left, so it leaves them room. Dragging it moves
// the window.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, run, window } from "herdr";
import { tokens, chip, raised, button, icon } from "./ui.js";

export default class Header {
  constructor(_cx) {}

  render(_cx) {
    const k = tokens();
    const projects = spaces().length;
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;
    const mac = window()?.platform === "macos";
    return h_flex()
      .id("orcha-header")
      .size_full()
      .pl(mac ? 84 : 14)
      .pr(12)
      .gap(12)
      .items_center()
      .bg(k.paper)
      .border_b(2.5)
      .border_color(k.line)
      .child(raised(k, chip(k, "🐋 ORCHA", k.pink).h(24).px(9).text_size(12.5).border(2).border_color(k.line), 2, 4))
      .child(div().text_size(12).text_color(k.muted).child(`${projects} projects · ${list.length} agents`))
      .when(needs > 0, (el) => el.child(chip(k, `${needs} NEEDS YOU`, k.red)))
      .child(div().flex_1())
      .child(button(k, "orcha-palette", h_flex().gap(5).items_center().child(icon("search", 13)).child("commands").child(div().text_color(k.dim).child("⌘⇧P")), () => run("app.palette"), { small: true }))
      // orcha's settings: Herdr's page with orcha's sections on top (⌘,).
      .child(button(k, "orcha-settings", h_flex().gap(5).items_center().child(icon("settings", 13)).child("settings").child(div().text_color(k.dim).child("⌘,")), () => run("mod.open", { name: "orcha" }), { small: true }));
  }
}
