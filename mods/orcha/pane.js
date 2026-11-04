// A pane's title bar (SPEC §2 "Main"): in the agent's color with its model,
// its state and how long it has been in it, and its context
// (`OPUS 5.5  ● running 4m · 112k`); a teal bar for a shell. The task shows
// only when the tab is split: alone, the tab already names it. Split, zoom
// and close on the right.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, agents, props, run, shared, setShared } from "herdr";
import { tokens, agentColor, programIcon, ownTitle, modelOf, icon, agentFacts, stateColor, tokensShort, ago, WORD, agentTitle, closePane, shellBusy, portPill } from "./ui.js";
import { systemOpen } from "./links.js";

// Where this pane's title bar is in the window, learned when the pointer
// passes over it: the right-click menu finds the cell under the pointer in a
// split tab from it (menu.js). Shared only when it changed.
function remember(id, bounds) {
  if (!bounds) return;
  const b = { x: Math.round(bounds.x), y: Math.round(bounds.y), w: Math.round(bounds.width), h: Math.round(bounds.height) };
  const all = shared("orcha.paneBounds") ?? {};
  const was = all[id];
  if (was && was.x === b.x && was.y === b.y && was.w === b.w && was.h === b.h) return;
  setShared("orcha.paneBounds", { ...all, [id]: b });
}

export default class Pane {
  constructor(_cx) {
    this.since = null; // { status, at }: when its state last changed
  }

  // A dark chip on the agent's color: a state dot, the word (for a shell,
  // what it runs), how long.
  state(k, status, word = WORD[status] ?? "idle") {
    const now = Date.now();
    const key = `${status} ${word}`;
    if (!this.since || this.since.status !== key) this.since = { status: key, at: now };
    return h_flex()
      .flex_none()
      .h(18)
      .px(6)
      .gap(5)
      .items_center()
      .rounded(9)
      .bg(k.line)
      .text_size(11)
      .font_bold()
      .text_color(k.barText)
      .child(
        div()
          .size(7)
          .rounded(4)
          .bg(stateColor(k, status))
          .when(status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 })),
      )
      .child(`${word} ${ago(now - this.since.at)}`);
  }

  button(k, fg, id, name, act) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(fg)
      .hover((s) => s.bg(k.line + "22"))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        act();
      })
      .child(icon(name, 13, fg));
  }

  render(_cx) {
    const k = tokens();
    const id = props()?.pane;
    const all = panes();
    const p = all.find((x) => x.pane === id);
    if (!p) return div();
    const isAgent = Boolean(p.program?.agent);
    const agent = agents().find((a) => a.pane === id);
    // Agents in their color; a shell teal, as its tab.
    const bg = isAgent ? agentColor(k, p.program) : k.teal;
    const fg = k.chipText;
    const lone = !all.some((x) => x.tab === p.tab && x.pane !== id);
    const facts = agentFacts();
    const task = isAgent ? agentTitle(agent, p) : ownTitle(p) || p.program?.name || "shell";
    const name = isAgent ? modelOf(p, facts).toUpperCase() : null;
    const context = isAgent && p.terminal ? facts.contexts?.[p.terminal] : null;
    const showTask = !isAgent || !lone;
    const busy = shellBusy(p, facts);
    return h_flex()
      .id(`orcha-pane-${id}`)
      .size_full()
      .px(10)
      .gap(7)
      .items_center()
      .bg(bg)
      .border_b(2)
      .border_color(k.line)
      .text_size(12)
      .text_color(fg)
      .on_click(() => run("pane.focus", { pane: id }))
      .on_mouse_move((e) => remember(id, e.bounds))
      .child(programIcon(p.program, 13, fg) ?? icon("terminal", 13, fg))
      .when(Boolean(name), (el) => el.child(div().flex_none().font_black().child(name)))
      .when(isAgent, (el) => el.child(this.state(k, p.status ?? "idle")))
      .when(Boolean(busy), (el) => el.child(this.state(k, "working", busy.cmd)).children(busy.ports.slice(0, 3).map((port) => portPill(k, `op-port-${id}-${port}`, port, systemOpen))))
      .when(Boolean(context), (el) => el.child(h_flex().flex_none().gap(3).items_center().font_bold().child(icon("brain", 12, fg)).child(tokensShort(context))))
      .when(isAgent && showTask && Boolean(task), (el) => el.child(div().font_black().child("·")))
      .child(div().flex_1().min_w(0).truncate().when(p.focused, (el) => el.font_bold()).child(showTask ? task ?? "" : ""))
      .when(!isAgent && Boolean(p.cwd), (el) => el.child(div().max_w(240).truncate().text_color(k.chipText + "aa").child(p.cwd.replace(/^\/Users\/[^/]+/, "~"))))
      .child(this.button(k, fg, `op-r-${id}`, "columns-2", () => run("pane.split", { direction: "right", pane: id })))
      .child(this.button(k, fg, `op-d-${id}`, "rows-2", () => run("pane.split", { direction: "down", pane: id })))
      .child(this.button(k, fg, `op-z-${id}`, p.zoomed ? "minimize-2" : "maximize-2", () => run("pane.zoom", { pane: id })))
      .child(this.button(k, fg, `op-x-${id}`, "x", () => closePane(id)));
  }
}
