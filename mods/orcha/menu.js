// Right-click menus in orcha's look: a project's or a pane's (Menu, opened by
// orcha with props().target), and a terminal's (TerminalMenu, the layout's
// terminal_menu: Open and Copy for the link under the pointer or selected,
// Copy and Paste, then the pane's items, like any terminal).
// Closing actions sit last, in red.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, closeOverlay, openOverlay, panes, terminals, notify, hc, layout, settings } from "herdr";
import { tokens, icon, readable } from "./ui.js";
import { scanLinks, openLink, placeLinks, linkAt, transcriptLinks } from "./links.js";
import { projectRoot } from "./files.js";
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

// One menu: a title, if any, then rows of [icon, label, onClick, danger]; a
// null row is a line between groups.
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
    .when(Boolean(title), (el) => el.child(div().px(8).pt(3).pb(5).text_size(11).font_black().text_color(k.dim).truncate().child(title)))
    .children(
      rows.map((row, i) => {
        if (!row) return div().my(4).mx(4).h(1.5).bg(k.dim + "55");
        const [name, label, onClick, danger] = row;
        return h_flex()
          .id(`orcha-menu-${i}`)
          .h(30)
          .px(8)
          .gap(9)
          .items_center()
          .rounded(5)
          .text_color(danger ? readable(k, k.red) : k.ink)
          .hover((el) => el.bg(k.hover))
          // Closes once the action is done: opening a link takes a moment, and
          // a closed menu's tasks stop.
          .on_click((_e, cx) => {
            Promise.resolve(onClick(cx)).finally(close);
          })
          .child(icon(name, 14))
          .child(div().flex_1().min_w(0).truncate().font_semibold().child(label));
      }),
    );
}

export default class Menu {
  constructor(_cx) {}

  render(_cx) {
    const target = props()?.target;
    const rows = items(target).flatMap(([name, label, command, args, danger]) => [...(danger ? [null] : []), [name, label, () => (command ? run(command, args) : openOverlay(args.overlay)), danger]]);
    return drawMenu(tokens(), (target?.name ?? "").toUpperCase(), rows);
  }
}

// What is selected in the terminal: copied, read back, and the clipboard
// put back as it was (Herdr has no other way to read a selection). Null
// when nothing new was selected.
async function selection(cx, pane) {
  const before = cx.read_from_clipboard();
  run("pane.focus", { pane });
  run("terminal.copy");
  await new Promise((done) => cx.timer.after(60, done));
  const after = cx.read_from_clipboard();
  if (!after || after === before) return null;
  if (before !== undefined) cx.write_to_clipboard(before);
  return after.trim();
}

// The cell under a window point, for a pane alone in its tab: the layout says
// where its terminal is, and the terminal fills that place in rows and columns.
function cellAt(point, pane, size) {
  if (!point || !pane || !size.cols || !size.rows) return null;
  const alone = pane.zoomed || panes().filter((p) => p.tab === pane.tab).length === 1;
  if (!alone) return null;
  const tree = layout();
  // Layout sizes grow with the app's zoom; the pointer and the window do not.
  const zoom = settings().zoom ?? 1;
  const find = (node, id) => (node?.id === id ? node : (node?.children ?? []).map((c) => find(c, id)).find(Boolean) ?? null);
  const px = (id) => {
    const node = find(tree, id);
    return node && !node.hidden ? node.size?.px ?? 0 : 0;
  };
  const view = globalThis.window.viewport_size();
  const main = find(tree, "main");
  const work = find(tree, "work");
  const edge = find(tree, "frame")?.border?.width ?? 0;
  const [padY, padX] = tree.terminal_padding ?? [0, 0];
  const header = main?.content?.pane?.header?.height ?? 0;
  const side = (work?.padding?.[1] ?? 0) + edge + (main?.padding?.[1] ?? 0) + padX;
  const left = (px("sidebar") + side) * zoom;
  const right = view.width - (px("right") + side) * zoom;
  const top = (px("header") + (work?.padding?.[0] ?? 0) + edge + px("tabs") + header + padY) * zoom;
  const bottom = view.height - (px("status") + (work?.padding?.[0] ?? 0) + edge + px("frame-foot") + padY) * zoom;
  if (point.x < left || point.x > right || point.y < top || point.y > bottom) return null;
  return { row: Math.floor(((point.y - top) / (bottom - top)) * size.rows), col: Math.floor(((point.x - left) / (right - left)) * size.cols) };
}

export class TerminalMenu {
  constructor(cx) {
    this.ready = false; // shown once known what it holds, so its rows don't jump
    this.link = null; // the link selected or under the pointer
    this.selected = null;
    const target = props()?.target ?? {};
    this.pane = panes().find((p) => p.pane === target.pane) ?? null;
    // Where the right-click was, before the pointer moves on.
    const point = globalThis.window.mouse_position();
    cx.spawn(async (cx) => {
      this.selected = await selection(cx, target.pane);
      const chosen = this.selected ? scanLinks(this.selected, 1)[0] ?? null : null;
      this.link = chosen ?? (target.terminal ? await this.linkUnder(target.terminal, point) : null);
      this.ready = true;
      cx.notify();
    });
  }

  // The link under the right-click: as the screen shows it, else one Claude
  // wrote whose label is there.
  async linkUnder(terminal, point) {
    const [screen, info] = await Promise.all([hc(["read", "--json", terminal]), hc(["get", "--json", terminal])]);
    let text = "";
    let size = {};
    try {
      text = JSON.parse(screen.stdout).text ?? "";
      size = JSON.parse(info.stdout);
    } catch {
      return null;
    }
    const cell = cellAt(point, this.pane, size);
    if (!cell) return null;
    const shown = linkAt(placeLinks(text, size.cols), cell);
    if (shown || !this.pane?.program?.key?.includes("claude")) return shown;
    return linkAt(placeLinks(text, size.cols, await transcriptLinks(this.pane.cwd)), cell);
  }

  async open(link) {
    const cwd = this.pane?.cwd ?? null;
    const root = cwd ? await projectRoot(cwd, null) : null;
    const failed = await openLink(link, { cwd, root, on: null });
    if (failed) notify({ title: failed, level: "warning", timeout: 4000 });
  }

  render(_cx) {
    if (!this.ready) return div();
    const k = tokens();
    const tg = props()?.target ?? {};
    const all = terminals();
    const term = all.find((t) => t.address === tg.terminal);
    const parent = term?.parent && all.find((t) => t.address === term.parent);
    const toProgram = term?.labels?.["herdr.right-click"] === "program";
    const link = this.link;
    const kind = link?.url ? "link" : "file";
    const rows = [
      ...(link
        ? [
            [link.url ? "globe" : "file", `Open ${kind}`, () => this.open(link)],
            ["copy", link.url ? "Copy link" : "Copy path", (cx) => cx.write_to_clipboard(link.raw)],
            null,
          ]
        : []),
      ...(this.selected ? [["copy", "Copy", (cx) => cx.write_to_clipboard(this.selected)]] : []),
      ["paste", "Paste", () => run("terminal.paste")],
      null,
      ["columns-2", "Split right", () => run("pane.split", { direction: "right", pane: tg.pane })],
      ["rows-2", "Split down", () => run("pane.split", { direction: "down", pane: tg.pane })],
      ["maximize-2", this.pane?.zoomed ? "Unzoom" : "Zoom", () => run("pane.zoom", { pane: tg.pane })],
      ...(toProgram ? [["menu", "Use this menu on right-click", () => run("terminal.right_click", { terminal: term.address, to: "menu" })]] : []),
      ...(parent ? [["arrow-down", `Send back to ${parent.name || parent.address}`, () => run("terminal.park", { terminal: term.address })]] : []),
      null,
      ["x", "Close pane", () => run("pane.close", { pane: tg.pane }), true],
    ];
    return drawMenu(k, link ? link.label ?? link.raw : null, rows);
  }
}
