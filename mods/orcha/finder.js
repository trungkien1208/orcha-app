// FIND, a popup over everything (the header opens it from the keyboard):
//   FILE  ⌘O   a file of the project by name, opened in the viewer
//   TEXT  ⌘⇧F  text inside the project's files, opened at its lines
//   PANE  ⌘F   text in the pane you are in: a terminal's history, or the
//              file the viewer shows
//   LINKS ⌘L   web addresses and file paths the pane printed, opened by
//              type (links.js)
// Type, move with ↑↓, open with ↵, switch with Tab, close with Esc; in LINKS,
// ⌘C (or a row's copy button) copies a link.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, focused, panes, shared, setShared, notify } from "herdr";
import { tokens, raised, icon } from "./ui.js";
import { location, projectRoot, findFiles, findText, openFile } from "./files.js";
import { scanLinks, openLink, readTerminal, terminalCols, transcriptLinks, completeLinks } from "./links.js";

const MODES = [
  { id: "file", label: "FILE", key: "⌘O", hint: "Go to a file by name" },
  { id: "text", label: "TEXT", key: "⌘⇧F", hint: "Search text in this project" },
  { id: "pane", label: "PANE", key: "⌘F", hint: "Search what this pane shows" },
  { id: "links", label: "LINKS", key: "⌘L", hint: "Links and files this pane printed" },
];
const PANE_HITS = 200;

export default class Finder {
  constructor(cx) {
    this.mode = MODES.some((m) => m.id === props()?.mode) ? props().mode : "file";
    this.query = "";
    this.results = [];
    this.at = 0;
    this.cache = {};
    // Where we search: the pane that had focus when FIND opened.
    const f = focused();
    this.from = f?.pane ? panes().find((p) => p.pane === f.pane) ?? null : null;
    const { cwd, on } = location();
    this.on = on;
    this.root = cwd;
    cx.spawn(async (cx) => {
      if (cwd) this.root = await projectRoot(cwd, on);
      if (this.mode === "file" || this.mode === "links") this.search(cx);
      cx.notify();
    });
    this.input = InputState.new({ placeholder: this.placeholder() });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      const asked = (this.asked = (this.asked ?? 0) + 1);
      cx.timer.after(this.mode === "file" ? 60 : 200, (cx) => {
        if (asked === this.asked) this.search(cx);
      });
    });
    this.input.on("submit", (_e, cx) => this.open(this.results[this.at], cx));
    this.input.focus();
    cx.timer.after(120, () => this.input.focus());
  }

  placeholder() {
    if (this.mode === "pane") return this.from?.mod === "orcha" ? "Find in this file" : "Find in this terminal's history";
    return MODES.find((m) => m.id === this.mode).hint;
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  switchTo(mode, cx) {
    this.mode = mode;
    this.results = [];
    this.at = 0;
    this.search(cx);
    this.input.focus();
    cx.notify();
  }

  search(cx) {
    const query = this.query.trim();
    const mode = this.mode;
    if (!query && mode !== "file" && mode !== "links") {
      this.results = [];
      cx.notify();
      return;
    }
    cx.spawn(async (cx) => {
      let results = [];
      if (mode === "file") results = this.root ? await findFiles(this.root, this.on, query, this.cache) : [];
      else if (mode === "text") results = this.root ? await findText(this.root, this.on, query) : [];
      else if (mode === "links") results = await this.findLinks(query);
      else results = await this.findInPane(query);
      if (query !== this.query.trim() || mode !== this.mode) return;
      this.results = results;
      this.at = 0;
      cx.notify();
    });
  }

  // The pane's links, read once per FIND, filtered by what is typed: what
  // Claude wrote as markdown links (the screen shows only their labels),
  // then what the screen and history show.
  async findLinks(query) {
    if (!this.from?.terminal) return [];
    if (!this.links) {
      const claude = this.from.program?.key?.includes("claude");
      const written = claude ? await transcriptLinks(this.from.cwd) : [];
      const [text, cols] = await Promise.all([readTerminal(this.from.terminal), terminalCols(this.from.terminal)]);
      const found = scanLinks(text, 300, cols);
      const shown = claude ? await completeLinks(found, this.from.cwd) : found;
      const seen = new Set(written.map((l) => l.raw));
      this.links = [...written, ...shown.filter((l) => !seen.has(l.raw))];
    }
    const q = query.toLowerCase();
    return q ? this.links.filter((l) => `${l.label ?? ""} ${l.raw}`.toLowerCase().includes(q)) : this.links;
  }

  async findInPane(query) {
    const q = query.toLowerCase();
    if (this.from?.mod === "orcha") {
      // The viewer: open the same file again, its lines with the text on top.
      const view = shared("orcha.view");
      return view ? [{ viewer: true, path: view.path, text: `Show the lines with “${query}” in ${view.path.split("/").pop()}` }] : [];
    }
    if (!this.from?.terminal) return [];
    const lines = (await readTerminal(this.from.terminal)).split("\n");
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < PANE_HITS; i -= 1) {
      if (lines[i].toLowerCase().includes(q)) out.push({ line: i + 1, text: lines[i].trim().slice(0, 240), before: (lines[i - 1] ?? "").trim().slice(0, 240) });
    }
    return out;
  }

  open(r, cx) {
    if (!r) return;
    if (this.mode === "links") {
      cx.spawn(async () => {
        const failed = await openLink(r, { cwd: this.from?.cwd ?? this.root, root: this.root, on: this.on });
        if (failed) notify({ title: failed, level: "warning", timeout: 4000 });
        else this.close();
      });
      return;
    }
    if (this.mode === "file") openFile(this.root, r.path, this.on);
    else if (this.mode === "text") openFile(this.root, r.path, this.on, this.query.trim());
    else if (r.viewer) {
      const view = shared("orcha.view");
      if (view) setShared("orcha.view", { ...view, query: this.query.trim(), seq: Date.now() });
    } else return; // a terminal line: nothing to open
    this.close();
  }

  copy(r, cx) {
    if (!r) return;
    cx.write_to_clipboard(r.raw);
    notify({ title: `Copied ${r.raw.length > 48 ? `…${r.raw.slice(-47)}` : r.raw}`, level: "success", timeout: 2000 });
  }

  key(e, cx) {
    const n = this.results.length;
    if (e.key === "escape") return this.close();
    if (this.mode === "links" && e.key === "c" && e.modifiers?.platform) {
      this.copy(this.results[this.at], cx);
      cx.stop_propagation();
      return;
    }
    if (e.key === "tab") {
      const i = MODES.findIndex((m) => m.id === this.mode);
      this.switchTo(MODES[(i + (e.modifiers?.shift ? MODES.length - 1 : 1)) % MODES.length].id, cx);
    } else if (e.key === "down" && n) this.at = (this.at + 1) % n;
    else if (e.key === "up" && n) this.at = (this.at + n - 1) % n;
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(k, r, i) {
    const on = i === this.at;
    const base = h_flex()
      .id(`find-${i}`)
      .flex_none()
      .px(10)
      .py(5)
      .gap(8)
      .items_center()
      .rounded(5)
      .border(2)
      .border_color(on ? k.line : "#00000000")
      .bg(on ? k.yellow : "#00000000")
      .cursor_pointer()
      .hover((s) => (on ? s : s.bg(k.hover)))
      .on_click((_e, cx) => {
        this.at = i;
        this.open(r, cx);
      });
    const fg = on ? k.chipText : k.ink;
    const dim = on ? k.chipText : k.dim;
    if (this.mode === "links") {
      return base
        .child(icon(r.url ? "globe" : /\/$/.test(r.raw) ? "folder" : "file", 14, fg))
        .when(Boolean(r.label), (el) => el.child(div().flex_none().max_w(220).truncate().font_bold().text_color(fg).child(r.label)))
        .child(div().flex_1().min_w(0).truncate().text_color(r.label ? dim : fg).when(on && !r.label, (el) => el.font_bold()).child(r.raw))
        .child(div().flex_none().text_size(10.5).text_color(dim).child(r.url ? "web" : r.line ? `line ${r.line}` : ""))
        .child(
          div()
            .id(`find-copy-${i}`)
            .flex_none()
            .p(3)
            .rounded(4)
            .cursor_pointer()
            .hover((s) => s.bg(k.line + "22"))
            .tooltip("Copy (⌘C)")
            .on_click((_e, cx) => {
              cx.stop_propagation();
              this.copy(r, cx);
            })
            .child(icon("copy", 13, fg)),
        );
    }
    if (this.mode === "pane" && !r.viewer) {
      return base
        .child(div().w(44).flex_none().text_right().text_size(11).font_bold().text_color(dim).child(String(r.line)))
        .child(v_flex().flex_1().min_w(0).child(div().truncate().text_size(11).text_color(dim).child(r.before || " ")).child(div().truncate().text_color(fg).child(r.text)));
    }
    if (r.viewer) return base.child(icon("search", 14, fg)).child(div().flex_1().truncate().text_color(fg).child(r.text));
    const slash = r.path.lastIndexOf("/");
    return base
      .child(icon("file", 14, fg))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(
            h_flex()
              .gap(6)
              .items_baseline()
              .child(div().flex_none().font_black().text_color(fg).child(r.path.slice(slash + 1)))
              .when(r.line != null, (el) => el.child(div().flex_none().text_size(11).text_color(dim).child(`:${r.line}`)))
              .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(dim).child(slash >= 0 ? r.path.slice(0, slash) : "")),
          )
          .when(Boolean(r.text), (el) => el.child(div().truncate().text_size(11.5).text_color(on ? k.chipText : k.muted).child(r.text))),
      );
  }

  render(cx) {
    const k = tokens();
    const tabs = h_flex()
      .gap(4)
      .children(
        MODES.map((m) => {
          const on = m.id === this.mode;
          return h_flex()
            .id(`find-mode-${m.id}`)
            .h(24)
            .px(8)
            .gap(5)
            .items_center()
            .rounded(4)
            .border(2)
            .border_color(on ? k.line : "#00000000")
            .bg(on ? k.ink : "#00000000")
            .text_size(11)
            .font_black()
            .text_color(on ? k.paper : k.muted)
            .cursor_pointer()
            .on_click((_e, cx) => this.switchTo(m.id, cx))
            .child(m.label)
            .child(div().text_size(10).text_color(on ? k.paper : k.dim).child(m.key));
        }),
      );
    const empty =
      this.mode === "file" && !this.root
        ? "Click into a project first."
        : (this.mode === "pane" || this.mode === "links") && !this.from
          ? "Click into a terminal or the viewer first."
          : this.mode === "links" && !this.query.trim()
            ? "No links or file paths in this pane yet."
          : this.query.trim()
            ? "Nothing found."
            : this.mode === "file"
              ? "Reading the project…"
              : "Type to search.";
    const box = v_flex()
      .id("orcha-finder")
      .w(640)
      .h(460)
      .rounded(8)
      .border(3)
      .border_color(k.line)
      .bg(k.paper)
      .overflow_hidden()
      .on_key_down((e, cx) => this.key(e, cx))
      .child(
        h_flex()
          .flex_none()
          .h(48)
          .px(12)
          .gap(8)
          .items_center()
          .bg(k.card)
          .border_b(2.5)
          .border_color(k.line)
          .child(icon("search", 16, k.ink))
          .child(Input.new(this.input).flex_1().min_w(0).h(30).text_size(14).text_color(k.ink))
          .child(tabs),
      )
      .child(
        v_flex()
          .id("find-results")
          .flex_1()
          .min_h(0)
          .p(8)
          .gap(2)
          .overflow_y_scrollbar()
          .text_size(12.5)
          .children(this.results.map((r, i) => this.row(k, r, i)))
          .when(!this.results.length, (el) => el.child(div().p(10).text_color(k.dim).child(empty))),
      )
      .child(
        h_flex()
          .flex_none()
          .h(32)
          .px(12)
          .gap(14)
          .items_center()
          .bg(k.card)
          .border_t(2.5)
          .border_color(k.line)
          .text_size(11)
          .text_color(k.muted)
          .child(this.mode === "pane" && this.from?.terminal ? "newest first" : this.mode === "links" ? "↵ open · ⌘C copy" : "↵ open")
          .child("↑↓ move")
          .child("tab switch")
          .child(div().flex_1())
          .child(div().truncate().text_color(k.dim).child(this.mode === "pane" || this.mode === "links" ? this.from?.title ?? "" : this.root?.split("/").pop() ?? ""))
          .child("esc close"),
      );
    return raised(k, box, 5, 8);
  }
}
