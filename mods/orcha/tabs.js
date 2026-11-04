// Tabs in the main frame's top edge (SPEC §2 "Main"), as folder tabs: every
// tab the same shape and height, sitting flush on the panes below, no lines.
// The open one takes its agent's color (Claude yellow, Codex green, Cursor
// blue), the same as the pane's title bar, so the two read as one folder;
// the others are plain cards with their agent's icon in its color. Each: an
// icon, its name, a state dot (yellow running, red needs you, green done).
// A shell's tab is teal, like its title bar. More than six fold into `+N`;
// the green + NEW tab opens a new one.
//
// The line around the pane with the keyboard takes that pane's color too.
// Herdr has one such color per layout, so it is set again when focus moves to
// a pane of another color.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, run, focused, layout } from "herdr";
import { tokens, icon, agentTitle, programIcon, stateColor, agentColor, closeTab, agentFacts, shellBusy } from "./ui.js";
import { openNew } from "./new.js";

const SHOWN = 6;

export default class Tabs {
  constructor(_cx) {}

  // A tab someone named keeps its name; else what its agent works on, else
  // the folder it is in, else its program, else its number. Herdr names a tab
  // after the agent it opens ("Codex", "Claude Code"): that is no name.
  label(tab, lead, byPane) {
    const program = lead?.program?.name?.toLowerCase();
    if (tab.named && tab.name.toLowerCase() !== program) return tab.name;
    return agentTitle(byPane.get(lead?.pane), lead) || lead?.cwd?.split("/").pop() || lead?.program?.name || tab.name;
  }

  // The focus line in `color`: the layout's tab block, changed in a copy.
  setFocusColor(color) {
    const tree = JSON.parse(JSON.stringify(layout()));
    const set = (node) => {
      const pane = node.content?.tab === "active" ? node.content.pane : null;
      if (pane) {
        const changed = pane.focus?.color !== color;
        pane.focus = { ...pane.focus, color };
        return changed;
      }
      return (node.children ?? []).reduce((any, child) => set(child) || any, false);
    };
    if (set(tree)) run("layout.set", { layout: tree });
  }

  followFocus(k, allPanes, cx) {
    const id = focused()?.pane;
    const pane = id ? allPanes.find((p) => p.pane === id) : null;
    if (!pane) return;
    const color = pane.program?.agent ? agentColor(k, pane.program) : k.teal;
    if (color === this.focusColor) return;
    this.focusColor = color;
    // Commands wait until the frame is drawn.
    cx.timer.after(0, () => this.setFocusColor(color));
  }

  // The tabs' shape: one height, round at the top, flat on the panes.
  shape(el) {
    return el.h(30).flex_none().items_center().rounded_t(7);
  }

  // `busy`: a shell in it runs something (a server, a build): a running dot.
  tab(k, tab, label, lead, busy) {
    const open = tab.active;
    const status = tab.status && tab.status !== "idle" ? tab.status : busy ? "working" : null;
    const color = lead?.program?.agent ? agentColor(k, lead.program) : k.teal;
    const fg = open ? k.chipText : k.muted;
    return this.shape(h_flex())
      .id(`orcha-tab-${tab.id}`)

      .flex_shrink(1)
      .min_w(0)
      .pl(10)
      .pr(status ? 9 : 12)
      .gap(7)
      .bg(open ? color : k.ink + "17")
      .text_size(12)
      .text_color(fg)
      .when(open, (el) => el.font_black())
      .cursor_pointer()
      .hover((el) => (open ? el : el.text_color(k.ink).bg(k.ink + "26")))
      .on_click(() => run("tab.select", { id: tab.id }))
      .on_mouse_down("middle", () => closeTab(tab.id))
      .child(programIcon(lead?.program, 13, open ? fg : color) ?? icon("terminal", 13, open ? fg : color))
      .child(div().min_w(0).max_w(open ? 260 : 170).truncate().child(label))
      .when(Boolean(status), (el) =>
        el.child(
          // A dark button with the state's color inside: reads on any fill.
          div()
            .size(10)
            .flex()
            .flex_none()
            .items_center()
            .justify_center()
            .rounded(5)
            .bg(k.line)
            .child(
              div()
                .size(6)
                .rounded(3)
                .bg(stateColor(k, status))
                .when(status === "blocked", (d) => d.loop("opacity", { from: 0.35, to: 1, period: 900 })),
            ),
        ),
      );
  }

  // The agent a tab is about, else its first pane.
  lead(tab, allPanes) {
    const mine = allPanes.filter((p) => p.tab === tab.id);
    return mine.find((p) => p.program?.agent) ?? mine[0] ?? null;
  }

  render(cx) {
    const k = tokens();
    const space = spaces().find((s) => s.active);
    const tabs = space?.tabs ?? [];
    const allPanes = panes();
    this.followFocus(k, allPanes, cx);
    const byPane = new Map(agents().map((a) => [a.pane, a]));
    const facts = agentFacts();
    const open = tabs.findIndex((t) => t.active);
    // Keep the open tab among the shown ones.
    const start = Math.max(0, Math.min(open - SHOWN + 1, tabs.length - SHOWN));
    const shown = tabs.slice(start, start + SHOWN);
    const hidden = tabs.length - shown.length;
    return h_flex()
      .id("orcha-tabs")
      .size_full()
      // The panes' side margin: the first tab's edge runs straight down
      // into the pane's, like a folder.
      .px(4)
      .gap(4)
      .items_end()
      .bg(k.frame)
      .children(
        shown.map((t) => {
          const lead = this.lead(t, allPanes);
          const busy = allPanes.some((p) => p.tab === t.id && shellBusy(p, facts));
          return this.tab(k, t, this.label(t, lead, byPane), lead, busy);
        }),
      )
      .when(hidden > 0, (el) =>
        el.child(
          this.shape(h_flex())
            .id("orcha-tabs-more")
            .px(10)
            .bg(k.ink + "17")
            .text_size(12)
            .font_black()
            .text_color(k.muted)
            .cursor_pointer()
            .hover((s) => s.text_color(k.ink))
            .tooltip("More tabs")
            .on_click(() => run("app.palette"))
            .child(`+${hidden}`),
        ),
      )
      .child(
        this.shape(h_flex())
          .id("orcha-tab-new")
          .px(10)
          .gap(5)
          .bg(k.green)
          .text_size(11.5)
          .font_black()
          .text_color(k.chipText)
          .cursor_pointer()
          .hover((s) => s.opacity(0.85))
          .tooltip("Open a new tab: an agent or a shell")
          .on_click(() => openNew())
          .child(icon("plus", 13, k.chipText))
          .child("NEW"),
      )
      .child(div().flex_1());
  }
}
