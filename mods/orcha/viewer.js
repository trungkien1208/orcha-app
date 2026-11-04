// The file viewer, a pane beside your work (opened from FILES, files.js):
// the file read-only with its colors and line numbers. Opened from a TEXT
// search, the lines holding the text are listed on top. It follows the last
// file opened (shared "orcha.view"), so one viewer serves a whole tab.
// Markdown shows as a page (PREVIEW) or as text (SOURCE); its links open
// in the browser, or here for a file next to it.
// Opened from a link with a line (`file.rs:42`), that line and the two
// around it are listed on top, as Herdr's editor can't scroll to a line.
// ⌘F (or the search button) opens a find bar: the file then shows as plain
// lines (a list orcha can scroll), every match in yellow, and ↵ / ⇧↵ go to
// the next and previous one.

import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView, InputState, Input, v_virtual_list, VirtualListScrollHandle, Scrollbar } from "gpui-base";
import { readTextFile, shared, setShared, settings, panes, focused, exec } from "herdr";

import { tokens, icon, closePane } from "./ui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MAX = 400000;
const MARKDOWN = /\.(md|markdown|mdx)$/i;
const ROW = 19;
const FIND = "orcha_viewer_find";

// Herdr's editor takes ⌘F for a search of its own that does nothing here,
// before any key handler hears it. A binding in the editor's own key context,
// made later, comes first: the viewer answers it, anywhere else it falls
// through to what ⌘F did before.
let bound = false;
const bindFind = (cx) => {
  if (bound) return;
  bound = true;
  cx.bind_keys([{ keystroke: "cmd-f", action: FIND, context: "Input" }]);
};

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Shows another file: the same shared value FILES and FIND write.
function setView(root, path, on) {
  setShared("orcha.view", { root, path, on: on ?? null, query: null, line: null, seq: Date.now() });
}

export default class Viewer {
  constructor(cx) {
    this.seq = null;
    this.code = null;
    this.error = null;
    this.hits = [];
    this.markdown = null; // a Markdown file's text, shown as a page
    this.source = false; // ...or as text
    this.lines = [];
    this.finding = false;
    this.matches = []; // indexes of the lines holding the text
    this.cur = 0; // the match shown
    this.lower = []; // the lines in lower case, for searching
    this.scroll = VirtualListScrollHandle.new();
    bindFind(cx);
    this.findSeq = shared("orcha.viewerFind")?.seq ?? null;
    this.find = InputState.new({ placeholder: "Find in this file" });
    this.find.on("change", (_e, cx) => {
      this.search(this.find.value());
      cx.notify();
    });
    this.find.on("submit", (e, cx) => {
      this.step(e.shift ? -1 : 1);
      cx.notify();
    });
    this.load(cx);
  }

  // The lines holding `query`, any case; shows the first one.
  search(query) {
    const q = (query ?? "").toLowerCase();
    this.query = q;
    this.matches = [];
    this.cur = 0;
    if (!q) return;
    this.lower.forEach((line, i) => {
      if (line.includes(q)) this.matches.push(i);
    });
    this.show();
  }

  // The next (1) or previous (-1) match, round the end.
  step(by) {
    const n = this.matches.length;
    if (!n) return;
    this.cur = (this.cur + by + n) % n;
    this.show();
  }

  show() {
    if (this.matches.length) this.scroll.scroll_to_item(this.matches[this.cur], "center");
  }

  openFind(query) {
    this.finding = true;
    if (query != null) this.find.set_value(query);
    this.search(this.find.value());
    this.find.focus();
  }

  closeFind() {
    this.finding = false;
    this.query = "";
    this.matches = [];
  }

  // ⌘F in this viewer (header.js): the newest ask for this pane.
  watchFind() {
    const ask = shared("orcha.viewerFind");
    if (!ask || ask.seq === this.findSeq) return;
    this.findSeq = ask.seq;
    const me = panes().find((p) => p.mod === "orcha" && p.tab === focused()?.tab);
    if (me && me.pane === ask.pane) this.openFind();
  }

  load(cx) {
    const view = shared("orcha.view");
    if (!view || view.seq === this.seq) return;
    this.seq = view.seq;
    this.view = view;
    this.code?.release();
    this.code = null;
    this.error = null;
    this.hits = [];
    this.lines = [];
    this.lower = [];
    this.markdown = null;
    this.source = Boolean(view.query || view.line);
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${view.root}/${view.path}`, { on: view.on });
        if (this.seq !== view.seq) return;
        if (text === null) this.error = "This file is no longer there.";
        else if (text.includes("\0")) this.error = "A binary file: nothing to read here.";
        else {
          const k = tokens();
          if (MARKDOWN.test(view.path)) this.markdown = text.length > MAX ? text.slice(0, MAX) : text;
          const ext = view.path.includes(".") ? view.path.split(".").pop() : "txt";
          this.code = EditorState.new({
            language: LANG[ext] ?? ext,
            readonly: true,
            value: text.length > MAX ? `${text.slice(0, MAX)}\n… (the rest is cut off)` : text,
            font_family: settings().font_family,
            font_size: 12.5,
            syntax: { keyword: k.ansi5, string: k.ansi2, comment: k.dim, function: k.ansi4, type: k.ansi3, number: k.ansi1, constant: k.ansi6 },
          });
          const lines = text.split("\n");
          this.lines = lines;
          this.lower = lines.map((l) => l.toLowerCase());
          if (view.query) this.openFind(view.query);
          else if (this.finding) this.search(this.find.value());
          else if (view.line) {
            for (let n = Math.max(1, view.line - 2); n <= Math.min(lines.length, view.line + 2); n += 1) {
              this.hits.push({ line: n, text: lines[n - 1].slice(0, 200), here: n === view.line });
            }
          }
        }
      } catch {
        if (this.seq === view.seq) this.error = "This file can't be read (too big, binary or locked).";
      } finally {
        cx.notify();
      }
    });
  }

  // A link in a Markdown page: the web in the browser, a file beside this one here.
  openLink(url) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
      if (/^(https?|mailto):/i.test(url)) exec("open", [url]);
      return;
    }
    const target = url.replace(/#.*$/, "");
    if (!target) return;
    const here = this.view.path.includes("/") ? this.view.path.replace(/\/[^/]*$/, "") : "";
    const parts = [];
    for (const part of `${target.startsWith("/") ? "" : here}/${target}`.split("/")) {
      if (part === "..") parts.pop();
      else if (part && part !== ".") parts.push(part);
    }
    const root = target.startsWith("/") ? "" : this.view.root;
    setView(root, parts.join("/"), this.view.on);
  }

  stepButton(k, glyph, by, tip) {
    return div()
      .id(`viewer-find-${glyph}`)
      .flex_none()
      .p(2)
      .rounded(4)
      .border(2)
      .border_color(k.line)
      .cursor_pointer()
      .hover((s) => s.bg(k.hover))
      .tooltip(tip)
      .on_click((_e, cx) => {
        this.step(by);
        cx.notify();
      })
      .child(icon(`arrow-${glyph}`, 11, k.ink));
  }

  // The file as plain lines while finding: Herdr's editor can't scroll to a
  // line, this list can. Every match in yellow, the shown one's line marked.
  findView(k) {
    // On the shown text itself: lower case can change a string's length.
    const re = new RegExp(escapeRe(this.query), "gi");
    const shown = this.matches[this.cur];
    const row = (i) => {
      const text = this.lines[i].replaceAll("\t", "    ").slice(0, 2000);
      const parts = [];
      let from = 0;
      for (const m of text.matchAll(re)) {
        if (m.index > from) parts.push(div().flex_none().child(text.slice(from, m.index)));
        parts.push(div().flex_none().rounded(2).bg(k.yellow).text_color(k.chipText).child(m[0]));
        from = m.index + m[0].length;
      }
      if (from < text.length) parts.push(div().flex_none().child(text.slice(from)));
      return h_flex()
        .h(ROW)
        .gap(12)
        .items_center()
        .whitespace_nowrap()
        .overflow_hidden()
        .when(i === shown, (el) => el.bg(k.yellow + "33"))
        .child(div().w(44).flex_none().text_right().text_color(i === shown ? k.ink : k.dim).child(String(i + 1)))
        .child(h_flex().flex_1().min_w(0).overflow_hidden().text_color(k.foreground).children(parts));
    };
    return div()
      .relative()
      .flex_1()
      .min_h(0)
      .font_family(settings().font_family)
      .text_size(12.5)
      .child(
        v_virtual_list("viewer-lines", this.lines.length, ROW, (i) => String(i), (range) => {
          const out = [];
          for (let i = range.start; i < range.end; i += 1) out.push(row(i));
          return out;
        })
          .track_scroll(this.scroll)
          .size_full(),
      )
      .child(Scrollbar.vertical("viewer-lines").absolute().inset_0());
  }

  close() {
    const tab = focused()?.tab;
    const me = panes().find((p) => p.mod === "orcha" && p.tab === tab);
    if (me) closePane(me.pane);
  }

  render(cx) {
    this.load(cx);
    this.watchFind();
    const k = tokens();
    const path = this.view?.path ?? "";
    const slash = path.lastIndexOf("/");
    const head = h_flex()
      .flex_none()
      .h(34)
      .px(10)
      .gap(7)
      .items_center()
      .bg(k.card)
      .border_b(2)
      .border_color(k.line)
      .child(icon("file", 14, k.ink))
      .child(div().flex_none().font_black().text_color(k.ink).child(path.slice(slash + 1) || "no file"))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(k.dim).child(slash >= 0 ? path.slice(0, slash) : ""))
      .when(this.markdown != null, (el) =>
        el.child(
          div()
            .id("viewer-mode")
            .flex_none()
            .px(7)
            .h(20)
            .flex()
            .items_center()
            .rounded(4)
            .border(2)
            .border_color(k.line)
            .bg(k.paper)
            .text_size(10.5)
            .font_black()
            .text_color(k.ink)
            .cursor_pointer()
            .hover((s) => s.bg(k.hover))
            .tooltip(this.source ? "Show it as a page" : "Show its text")
            .on_click((_e, cx) => {
              this.source = !this.source;
              cx.notify();
            })
            .child(this.source ? "PREVIEW" : "SOURCE"),
        ),
      )
      .child(
        div()
          .id("viewer-find")
          .p(3)
          .rounded(4)
          .border(2)
          .border_color(k.line)
          .bg(this.finding ? k.yellow : "#00000000")
          .cursor_pointer()
          .hover((s) => s.bg(k.hover))
          .tooltip("Find in this file  ⌘F")
          .on_click((_e, cx) => {
            if (this.finding) this.closeFind();
            else this.openFind();
            cx.notify();
          })
          .child(icon("search", 12, k.ink)),
      )
      .child(
        div()
          .id("viewer-close")
          .p(3)
          .rounded(4)
          .border(2)
          .border_color(k.line)
          .cursor_pointer()
          .hover((s) => s.bg(k.hover))
          .tooltip("Close the viewer")
          .on_click(() => this.close())
          .child(icon("x", 12, k.ink)),
      );
    const hits = this.hits.length && !this.finding
      ? v_flex()
          .id("viewer-hits")
          .flex_none()
          .max_h(150)
          .overflow_y_scrollbar()
          .px(10)
          .py(6)
          .gap(2)
          .bg(k.yellow + "22")
          .border_b(2)
          .border_color(k.line)
          .child(div().text_size(10.5).font_black().text_color(k.muted).child(`line ${this.view.line}`))
          .children(
            this.hits.map((h) =>
              h_flex()
                .gap(8)
                .text_size(11.5)
                .child(div().w(42).flex_none().text_right().font_bold().text_color(h.here ? k.ink : k.dim).child(String(h.line)))
                .child(div().flex_1().min_w(0).truncate().text_color(h.here ? k.ink : k.foreground).when(Boolean(h.here), (el) => el.font_bold()).child(h.text)),
            ),
          )
      : null;
    // What is typed, the count, and how to close.
    const findBar = this.finding
      ? h_flex()
          .flex_none()
          .h(34)
          .px(10)
          .gap(8)
          .items_center()
          .bg(k.card)
          .border_b(2)
          .border_color(k.line)
          .on_key_down((e, cx) => {
            if (e.key !== "escape") return;
            this.closeFind();
            cx.stop_propagation();
            cx.notify();
          })
          .child(icon("search", 13, k.dim))
          .child(Input.new(this.find).flex_1().min_w(0).h(24).px(6).rounded(4).border(2).border_color(k.line).bg(k.paper).text_size(12.5).text_color(k.ink))
          .child(
            div()
              .flex_none()
              .text_size(11)
              .font_black()
              .text_color(this.query && !this.matches.length ? k.red : k.muted)
              .child(!this.query ? "esc close" : this.matches.length ? `${this.cur + 1}/${this.matches.length}` : "not found"),
          )
          .child(this.stepButton(k, "up", -1, "Previous  ⇧↵"))
          .child(this.stepButton(k, "down", 1, "Next  ↵"))
      : null;
    return v_flex()
      .id("orcha-viewer")
      .size_full()
      .min_h(0)
      .bg(k.background)
      .text_size(12.5)
      // ⌘F from inside the code (bindFind); from elsewhere it comes
      // through header.js.
      .on_action(FIND, (_e, cx) => {
        this.openFind();
        cx.notify();
      })
      .child(head)
      .when(Boolean(findBar), (el) => el.child(findBar))
      .when(Boolean(hits), (el) => el.child(hits))
      .child(
        this.finding && this.query && this.lines.length
          ? this.findView(k)
          : this.markdown != null && !this.source
          ? div()
              .id("viewer-page")
              .flex_1()
              .min_h(0)
              .overflow_y_scrollbar()
              .px(22)
              .py(16)
              .text_size(13.5)
              .text_color(k.foreground)
              .child(TextView.markdown(`md-${this.seq}`, this.markdown).selectable(true).on_link_click((url) => this.openLink(url)))
          : this.code
            ? Editor.new(this.code).flex_1().min_h(0)
            : div().p(12).text_color(k.dim).child(this.error ?? (this.view ? "Opening…" : "Pick a file in FILES.")),
      );
  }
}
