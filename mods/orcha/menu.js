// Right-click menus in orcha's look: a project's or a pane's (Menu, opened by
// orcha with props().target), and a terminal's (TerminalMenu, the layout's
// terminal_menu: Open what is selected, LINKS, then Herdr's pane items).
// Closing actions sit last, in red.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, closeOverlay, openOverlay, exec, panes, terminals, window, notify } from "herdr";
import { tokens, icon, readable } from "./ui.js";
import { scanLinks, openLink } from "./links.js";
import { projectRoot } from "./files.js";
import { openFinder } from "./header.js";
import { ICON_OVERLAY } from "./icon.js";

function items(target) {
  if (target?.kind === "project") {
    return [
      ["chevron-right", "Open", "space.select", { id: target.id }],
      ["plus", "New tab", "tab.new", { space: target.id }],
      ["settings", "Rename…", "space.rename", { id: target.id }],
      ["zap", "Set icon…", null, { overlay: { mod: "orcha", props: { part: "icon", target }, ...ICON_OVERLAY } }],
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

// One menu: a title, then rows of [icon, label, onClick, danger].
function drawMenu(k, title, rows) {
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
    .child(div().px(8).pt(3).pb(5).text_size(11).font_black().text_color(k.dim).truncate().child(title.toUpperCase()))
    .children(
      rows.map(([name, label, onClick, danger], i) =>
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
          // Closes once the action is done: opening a link takes a moment, and
          // a closed menu's tasks stop.
          .on_click(() => {
            Promise.resolve(onClick()).finally(close);
          })
          .child(icon(name, 14))
          .child(div().min_w(0).truncate().font_semibold().child(label)),
      ),
    );
}

export default class Menu {
  constructor(_cx) {}

  render(_cx) {
    const target = props()?.target;
    const rows = items(target).map(([name, label, command, args, danger]) => [name, label, () => (command ? run(command, args) : openOverlay(args.overlay)), danger]);
    return drawMenu(tokens(), target?.name ?? "", rows);
  }
}

// What is selected in the terminal, on macOS: copied, read back, and the
// clipboard put back as it was. Null when nothing new was selected.
async function selection(pane) {
  if (window()?.platform !== "macos") return null;
  const before = (await exec("pbpaste", [])).stdout;
  run("pane.focus", { pane });
  run("terminal.copy");
  await exec("sleep", ["0.12"]);
  const after = (await exec("pbpaste", [])).stdout;
  if (after === before) return null;
  await exec("sh", ["-c", 'printf %s "$1" | pbcopy', "orcha", before]);
  return after.trim();
}

export class TerminalMenu {
  constructor(cx) {
    this.link = null;
    const target = props()?.target ?? {};
    this.pane = panes().find((p) => p.pane === target.pane) ?? null;
    cx.spawn(async (cx) => {
      const text = await selection(target.pane);
      this.link = text ? scanLinks(text, 1)[0] ?? null : null;
      cx.notify();
    });
  }

  async open() {
    const cwd = this.pane?.cwd ?? null;
    const root = cwd ? await projectRoot(cwd, null) : null;
    const failed = await openLink(this.link, { cwd, root, on: null });
    if (failed) notify({ title: failed, level: "warning", timeout: 4000 });
  }

  render(_cx) {
    const k = tokens();
    const tg = props()?.target ?? {};
    const all = terminals();
    const term = all.find((t) => t.address === tg.terminal);
    const parent = term?.parent && all.find((t) => t.address === term.parent);
    const toProgram = term?.labels?.["herdr.right-click"] === "program";
    const short = (raw) => (raw.length > 26 ? `…${raw.slice(-25)}` : raw);
    const rows = [
      ...(this.link ? [[this.link.url ? "globe" : "file", `Open ${short(this.link.raw)}`, () => this.open()]] : []),
      ["globe", "Links in this pane…", () => openFinder("links")],
      ["columns-2", "Split right", () => run("pane.split", { direction: "right", pane: tg.pane })],
      ["rows-2", "Split down", () => run("pane.split", { direction: "down", pane: tg.pane })],
      ["maximize-2", "Zoom", () => run("pane.zoom", { pane: tg.pane })],
      ...(term
        ? [toProgram ? ["menu", "Use orcha's right-click menu", () => run("terminal.right_click", { terminal: term.address, to: "menu" })] : ["terminal", "Send right-clicks to pane", () => run("terminal.right_click", { terminal: term.address, to: "program" })]]
        : []),
      ...(parent ? [["arrow-down", `Send back to ${parent.name || parent.address}`, () => run("terminal.park", { terminal: term.address })]] : []),
      ["x", "Close pane", () => run("pane.close", { pane: tg.pane }), true],
    ];
    return drawMenu(k, this.pane?.title ?? term?.name ?? "terminal", rows);
  }
}
