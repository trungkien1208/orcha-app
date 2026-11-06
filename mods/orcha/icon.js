// PROJECT ICON: pick an emoji for a project (props().target: its id, folder
// and name). Groups of emoji with words to search them by, and a box to type
// or paste any other emoji. Saved per folder in Orcherd's project-icons.json
// (paths.js).

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, readTextFile, writeTextFile, home, setShared, notify } from "herdr";
import { tokens, raised, icon } from "./ui.js";
import { configFile, makeConfigDir } from "./paths.js";

/** How the picker opens, from a project's tile or its right-click menu. */
export const ICON_OVERLAY = { kind: "dialog", width: 560, height: 470, frame: "none" };

// [emoji, words to find it by]. The first group holds orcha_icons.rs ICONS.
const GROUPS = [
  ["Favorites", [
    ["🍵", "tea matcha orcha"], ["🐋", "whale orcha docker"], ["🚀", "rocket launch ship"], ["🧪", "test lab science"], ["📦", "package box npm"],
    ["🔧", "tool wrench fix"], ["🎨", "design art paint ui"], ["🔥", "fire hot"], ["⚡", "fast zap power"], ["🌱", "plant new grow"],
    ["🐛", "bug debug"], ["📱", "mobile phone app ios android"], ["🌐", "web globe site"], ["🤖", "robot bot ai agent"], ["💳", "card payment pay"],
    ["📊", "chart data analytics dashboard"], ["🎮", "game play"], ["🧠", "brain ai ml"], ["🗂", "folder files"], ["⭐", "star"],
  ]],
  ["Code", [
    ["💻", "laptop code dev"], ["🖥", "desktop computer"], ["⌨️", "keyboard"], ["🛠", "tools build"], ["⚙️", "gear settings config"],
    ["🧰", "toolbox kit"], ["🔌", "plugin plug api"], ["🧬", "dna core"], ["🗄", "database server storage"], ["☁️", "cloud"],
    ["🐳", "docker container"], ["🐍", "python snake"], ["🦀", "rust crab"], ["☕", "java coffee"], ["💎", "ruby gem"],
    ["🐘", "php elephant postgres"], ["🦊", "gitlab fox firefox"], ["🐙", "github octopus"], ["📡", "network signal api"], ["🛰", "satellite remote"],
    ["🔐", "security auth lock"], ["🔑", "key auth secret"], ["🧯", "incident fire"], ["🚧", "wip construction"], ["📜", "script docs"],
  ]],
  ["Product", [
    ["🛒", "shop cart store ecommerce"], ["🏪", "store shop"], ["📈", "growth up stats"], ["📉", "down stats"], ["🗺", "map plan roadmap"],
    ["📅", "calendar date schedule"], ["⏰", "clock alarm time"], ["📣", "marketing announce"], ["💬", "chat message"], ["📧", "email mail"],
    ["🔔", "notification bell"], ["🔍", "search find"], ["🧭", "compass navigation"], ["🎯", "target goal"], ["🏁", "finish flag"],
    ["🧾", "receipt invoice"], ["📝", "note docs write"], ["📚", "books docs learn"], ["🎓", "school education"], ["🏷", "tag label"],
  ]],
  ["Work", [
    ["💼", "work business"], ["🏢", "office company"], ["🏦", "bank finance"], ["💰", "money"], ["💵", "dollar cash"],
    ["🪙", "coin crypto"], ["🧮", "calculator accounting"], ["📋", "clipboard tasks"], ["✅", "done check todo"], ["🤝", "deal partner client"],
    ["👥", "team people users"], ["🧑‍💻", "developer"], ["🏗", "build construction"], ["🚚", "delivery truck logistics"], ["📮", "post mailbox"],
  ]],
  ["Health", [
    ["🏥", "hospital health"], ["💊", "pill medicine pharmacy"], ["🩺", "doctor stethoscope"], ["❤️", "heart love health"], ["🧘", "yoga calm"],
    ["🏃", "run fitness"], ["🥗", "food salad diet"], ["🍎", "apple food"], ["🦷", "tooth dental"], ["👶", "baby kids"],
  ]],
  ["Places", [
    ["🏠", "home house"], ["🏡", "garden home"], ["🏰", "castle"], ["🗼", "tower"], ["🏝", "island travel"],
    ["✈️", "plane travel flight"], ["🚗", "car"], ["🚲", "bike"], ["🚉", "train station"], ["🗽", "city"],
    ["🌍", "earth world"], ["🌙", "moon night"], ["☀️", "sun day"], ["🌈", "rainbow"], ["❄️", "snow cold"],
  ]],
  ["Nature", [
    ["🌲", "tree forest"], ["🌵", "cactus desert"], ["🌸", "flower blossom"], ["🍀", "clover luck"], ["🍁", "leaf autumn"],
    ["🌊", "wave sea ocean"], ["🐶", "dog"], ["🐱", "cat"], ["🦉", "owl"], ["🐝", "bee"],
    ["🦋", "butterfly"], ["🐢", "turtle slow"], ["🦄", "unicorn"], ["🐉", "dragon"], ["🦈", "shark"],
  ]],
  ["Fun", [
    ["🎵", "music song"], ["🎬", "movie film video"], ["📷", "camera photo"], ["🎧", "headphones audio"], ["🎲", "dice random"],
    ["🧩", "puzzle"], ["🎁", "gift"], ["🎉", "party"], ["🏆", "trophy win"], ["🍕", "pizza"],
    ["🍔", "burger"], ["🍣", "sushi"], ["🍩", "donut"], ["🍺", "beer"], ["👾", "alien retro game"],
    ["👻", "ghost"], ["💀", "skull"], ["🌀", "cyclone"], ["🪄", "magic"], ["💡", "idea light"],
  ]],
];

const FILE = () => configFile("project-icons.json");
const PER_ROW = 10;

export default class Icon {
  constructor(cx) {
    this.current = null;
    this.saving = false;
    this.group = 0;
    this.query = "";
    this.search = InputState.new({ placeholder: "Search (bug, shop, game…) or paste any emoji" });
    this.search.on("change", (_e, cx) => {
      this.query = this.search.value().trim();
      cx.notify();
    });
    this.search.on("submit", () => {
      const first = this.typedEmoji() ?? this.shown()[0]?.[0];
      if (first) this.pick(first);
    });
    cx.timer.after(120, () => this.search.focus());
    cx.spawn(async (cx) => {
      try {
        this.current = JSON.parse((await readTextFile(FILE())) ?? "{}")[props()?.target?.folder] ?? null;
      } catch {
        this.current = null;
      }
      cx.notify();
    });
  }

  // What is typed, when it is an emoji (pasted) rather than a word.
  typedEmoji() {
    return /\p{Extended_Pictographic}/u.test(this.query) && this.query.length <= 16 ? this.query : null;
  }

  // The emoji shown: the open group, or every one whose words match.
  shown() {
    const q = this.query.toLowerCase();
    if (!q || this.typedEmoji()) return GROUPS[this.group][1];
    const seen = new Set();
    return GROUPS.flatMap(([, list]) => list).filter(([e, words]) => words.includes(q) && !seen.has(e) && seen.add(e));
  }

  // Writes only if the file did not change since it was read.
  pick(emoji) {
    const folder = props()?.target?.folder;
    if (!folder || this.saving) return;
    this.saving = true;
    (async () => {
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
        await makeConfigDir();
        await writeTextFile(FILE(), `${JSON.stringify(icons, null, 2)}\n`, before);
        setShared("orcha.iconsRev", Date.now());
      } catch (err) {
        notify({ title: "The icon was not saved", body: String(err), level: "error" });
      }
      closeOverlay(props()?.overlay);
    })();
  }

  tile(k, e, id) {
    const on = e === this.current;
    return div()
      .id(id)
      .size(40)
      .flex()
      .flex_none()
      .items_center()
      .justify_center()
      .rounded(7)
      .border(on ? 2.5 : 1.5)
      .border_color(on ? k.line : k.dim + "55")
      .bg(on ? k.yellow : k.card)
      .text_size(21)
      .cursor_pointer()
      .hover((s) => s.bg(k.hover).border_color(k.line))
      .on_click(() => this.pick(e))
      .child(e);
  }

  render(_cx) {
    const k = tokens();
    const target = props()?.target ?? {};
    const list = this.shown();
    const typed = this.typedEmoji();
    const rows = [];
    for (let i = 0; i < list.length; i += PER_ROW) rows.push(h_flex().gap(6).children(list.slice(i, i + PER_ROW).map(([e], j) => this.tile(k, e, `icon-${i + j}`))));
    const groups = h_flex()
      .id("icon-groups")
      .gap(4)
      .overflow_x_scrollbar()
      .children(
        GROUPS.map(([name], i) => {
          const on = i === this.group && !this.query;
          return div()
            .id(`icon-group-${i}`)
            .flex_none()
            .px(9)
            .h(24)
            .flex()
            .items_center()
            .rounded(5)
            .border(2)
            .border_color(on ? k.line : "#00000000")
            .bg(on ? k.ink : k.ink + "17")
            .text_size(11)
            .font_black()
            .text_color(on ? k.paper : k.muted)
            .cursor_pointer()
            .on_click((_e, cx) => {
              this.group = i;
              this.search.set_value("");
              this.query = "";
              cx.notify();
            })
            .child(name.toUpperCase());
        }),
      );
    const box = v_flex()
      .id("orcha-icon")
      .w(ICON_OVERLAY.width - 10)
      .h(ICON_OVERLAY.height - 10)
      .rounded(8)
      .border(3)
      .border_color(k.line)
      .bg(k.paper)
      .overflow_hidden()
      .child(
        h_flex()
          .flex_none()
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
      .child(
        v_flex()
          .flex_none()
          .px(14)
          .pt(12)
          .gap(10)
          .child(
            h_flex()
              .h(32)
              .px(9)
              .gap(7)
              .items_center()
              .rounded(6)
              .border(2)
              .border_color(k.line)
              .bg(k.card)
              .child(icon("search", 14, k.muted))
              .child(Input.new(this.search).flex_1().min_w(0).h(28).text_size(12.5).text_color(k.ink)),
          )
          .child(groups),
      )
      .child(
        v_flex()
          .id("icon-grid")
          .flex_1()
          .min_h(0)
          .px(14)
          .py(10)
          .gap(6)
          .overflow_y_scrollbar()
          .when(Boolean(typed), (el) => el.child(h_flex().gap(10).items_center().child(this.tile(k, typed, "icon-typed")).child(div().text_size(12).text_color(k.muted).child("↵ use this one"))))
          .children(rows)
          .when(!list.length && !typed, (el) => el.child(div().text_size(12).text_color(k.dim).child("No emoji by that word. Paste any emoji instead."))),
      )
      .child(
        h_flex()
          .flex_none()
          .px(14)
          .h(36)
          .items_center()
          .bg(k.card)
          .border_t(2.5)
          .border_color(k.line)
          .text_size(11.5)
          .child(div().text_color(k.muted).child("click an icon · ↵ picks the first"))
          .child(div().flex_1())
          .child(
            div()
              .id("icon-none")
              .text_color(k.muted)
              .cursor_pointer()
              .hover((s) => s.text_color(k.ink))
              .on_click(() => this.pick(null))
              .child("no icon"),
          ),
      );
    return raised(k, box, 5, 8);
  }
}
