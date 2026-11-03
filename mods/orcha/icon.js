// PROJECT ICON: pick an emoji for a project (props().target: its id, folder
// and name). Saved per folder in orcha's project-icons.json, the same file
// the terminal orcha reads, so both show the same icon.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, readTextFile, writeTextFile, home, setShared, notify } from "herdr";
import { tokens, raised, icon } from "./ui.js";

// orcha_icons.rs ICONS, ten a row.
const ICONS = [
  "🍵", "🐋", "🚀", "🧪", "📦", "🔧", "🎨", "🔥", "⚡", "🌱",
  "🐛", "📱", "🌐", "🤖", "💳", "📊", "🎮", "🧠", "🗂", "⭐",
  "🏥", "🛒", "🔒", "📝", "🎵", "📷", "🧾", "🏠", "🌀", "🧩",
];

const FILE = () => `${home()}/.config/orcha/project-icons.json`;

export default class Icon {
  constructor(cx) {
    this.current = null;
    this.saving = false;
    cx.spawn(async (cx) => {
      try {
        this.current = JSON.parse((await readTextFile(FILE())) ?? "{}")[props()?.target?.folder] ?? null;
      } catch {
        this.current = null;
      }
      cx.notify();
    });
  }

  // Writes only if the file did not change since it was read.
  pick(emoji, cx) {
    const folder = props()?.target?.folder;
    if (!folder || this.saving) return;
    this.saving = true;
    cx.spawn(async () => {
      const before = await readTextFile(FILE());
      let icons = {};
      try {
        icons = JSON.parse(before ?? "{}");
      } catch {
        icons = {};
      }
      if (emoji) icons[folder] = emoji;
      else delete icons[folder];
      try {
        await writeTextFile(FILE(), `${JSON.stringify(icons, null, 2)}\n`, before);
        setShared("orcha.iconsRev", Date.now());
      } catch (err) {
        notify({ title: "The icon was not saved", body: String(err), level: "error" });
      }
      closeOverlay(props()?.overlay);
    });
  }

  render(cx) {
    const k = tokens();
    const target = props()?.target ?? {};
    const rows = [0, 1, 2].map((r) =>
      h_flex()
        .gap(6)
        .children(
          ICONS.slice(r * 10, r * 10 + 10).map((e, i) =>
            div()
              .id(`icon-${r}-${i}`)
              .size(38)
              .flex()
              .items_center()
              .justify_center()
              .rounded(7)
              .border(e === this.current ? 2.5 : 1.5)
              .border_color(e === this.current ? k.line : k.dim + "66")
              .bg(e === this.current ? k.yellow : k.card)
              .text_size(20)
              .cursor_pointer()
              .hover((s) => s.bg(k.hover).border_color(k.line))
              .on_click((_e, cx) => this.pick(e, cx))
              .child(e),
          ),
        ),
    );
    const box = v_flex()
      .id("orcha-icon")
      .rounded(8)
      .border(3)
      .border_color(k.line)
      .bg(k.paper)
      .overflow_hidden()
      .child(
        h_flex()
          .px(14)
          .h(46)
          .gap(10)
          .items_center()
          .bg(k.card)
          .border_b(2.5)
          .border_color(k.line)
          .child(div().font_black().text_size(14).text_color(k.ink).child("PROJECT ICON"))
          .child(div().flex_1().truncate().text_size(12).text_color(k.muted).child(target.name ?? ""))
          .child(
            div()
              .id("icon-close")
              .p(4)
              .rounded(5)
              .border(2)
              .border_color(k.line)
              .cursor_pointer()
              .hover((s) => s.bg(k.hover))
              .on_click(() => closeOverlay(props()?.overlay))
              .child(icon("x", 14, k.ink)),
          ),
      )
      .child(v_flex().p(14).gap(6).children(rows))
      .child(
        h_flex()
          .px(14)
          .h(38)
          .items_center()
          .bg(k.card)
          .border_t(2.5)
          .border_color(k.line)
          .text_size(11.5)
          .child(div().text_color(k.muted).child("click an icon"))
          .child(div().flex_1())
          .child(
            div()
              .id("icon-none")
              .text_color(k.muted)
              .cursor_pointer()
              .hover((s) => s.text_color(k.ink))
              .on_click((_e, cx) => this.pick(null, cx))
              .child("no icon"),
          ),
      );
    return raised(k, box, 5, 8);
  }
}
