// The file viewer, a pane beside your work (opened from FILES, files.js):
// the file read-only with its colors and line numbers. Opened from a TEXT
// search, the lines holding the text are listed on top. It follows the last
// file opened (shared "orcha.view"), so one viewer serves a whole tab.
// Markdown shows as a page (PREVIEW) or as text (SOURCE); its links open
// in the browser, or here for a file next to it.
// Opened from a link with a line (`file.rs:42`), that line and the two
// around it are listed on top, as Herdr's editor can't scroll to a line.

import { div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, TextView } from "gpui-base";
import { readTextFile, shared, setShared, settings, panes, focused, exec } from "herdr";

import { tokens, icon, closePane } from "./ui.js";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const MAX = 400000;
const MARKDOWN = /\.(md|markdown|mdx)$/i;
const HITS = 40;

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
    this.load(cx);
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
          if (view.query) {
            const q = view.query.toLowerCase();
            for (let i = 0; i < lines.length && this.hits.length < HITS; i += 1) {
              if (lines[i].toLowerCase().includes(q)) this.hits.push({ line: i + 1, text: lines[i].trim().slice(0, 200) });
            }
          } else if (view.line) {
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

  close() {
    const tab = focused()?.tab;
    const me = panes().find((p) => p.mod === "orcha" && p.tab === tab);
    if (me) closePane(me.pane);
  }

  render(cx) {
    this.load(cx);
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
    const hits = this.hits.length
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
          .child(div().text_size(10.5).font_black().text_color(k.muted).child(this.view.query ? `“${this.view.query}” · ${this.hits.length === HITS ? `${HITS}+` : this.hits.length} line${this.hits.length === 1 ? "" : "s"}` : `line ${this.view.line}`))
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
    return v_flex()
      .id("orcha-viewer")
      .size_full()
      .min_h(0)
      .bg(k.background)
      .text_size(12.5)
      .child(head)
      .when(Boolean(hits), (el) => el.child(hits))
      .child(
        this.markdown != null && !this.source
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
