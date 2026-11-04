// orcha's status bar: a near-black bar with the project as a pink chip, what
// the focused agent works on, its branch and changes, then how many agents
// run, need you or finished, and the clock.

import { div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, panes, focused, shared, run } from "herdr";
import { tokens, chip, countChip, icon, agentFacts, tokensShort, agentTitle } from "./ui.js";

const clock = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
};

function elapsed(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 60) return `${Math.max(1, m)}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

export default class Status {
  constructor(cx) {
    this.since = {}; // pane → { status, at }: when its state last changed
    cx.timer.every(20000, (cx) => cx.notify());
  }

  // How long the focused agent has been in its current state.
  stateAge(pane) {
    if (!pane) return null;
    const now = Date.now();
    const seen = this.since[pane.pane];
    if (!seen || seen.status !== pane.status) this.since[pane.pane] = { status: pane.status, at: now };
    return now - this.since[pane.pane].at;
  }

  // The open agent's health (tabs.rs render_pane_usage): a face card, then
  // its context and RAM, bold and colored.
  health(k, pane) {
    const facts = agentFacts();
    const context = facts.contexts?.[pane.terminal] ?? null;
    const mb = facts.memory?.[pane.terminal] ?? null;
    const [face, word, color] =
      mb != null && mb >= 2048 ? ["😵", "very heavy", k.red]
      : mb != null && mb >= 1024 ? ["😐", "heavy on RAM", k.yellow]
      : context != null && context >= 150_000 ? ["😐", "context filling up", k.yellow]
      : ["🙂", "fine", k.green];
    const num = (value, c) => div().font_black().text_color(c).child(value);
    const parts = [chip(k, `${face} ${word}`, color)];
    if (context != null) parts.push(h_flex().gap(4).items_center().child(icon("brain", 12, k.barText + "99")).child(num(tokensShort(context), context >= 150_000 ? k.yellow : k.green)));
    if (mb != null) parts.push(h_flex().gap(4).items_center().child(icon("cpu", 12, k.barText + "99")).child(num(mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`, mb >= 2048 ? k.red : mb >= 1024 ? k.yellow : k.green)));
    return parts;
  }

  // Herdr's RAM in all (the window, herdr-core and every terminal under it).
  herdr(k, { app, all }) {
    const size = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)}G` : `${mb}M`);
    const color = all >= 8192 ? k.red : all >= 4096 ? k.yellow : k.barText;
    return h_flex()
      .id("orcha-herdr-ram")
      .gap(4)
      .items_center()
      .tooltip(`Herdr ${size(all)} in all: the window ${size(app)}, every terminal and agent ${size(all - app)}`)
      .child(icon("cpu", 12, k.barText + "99"))
      .child(div().text_color(k.barText + "99").child("Herdr"))
      .child(div().font_black().text_color(color).child(size(all)));
  }

  render(_cx) {
    const k = tokens();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const count = (status) => list.filter((a) => a.status === status).length;
    const here = focused();
    const pane = panes().find((p) => p.pane === here?.pane);
    const agent = list.find((a) => a.pane === here?.pane);
    const task = agentTitle(agent, pane) || pane?.program?.name || "";
    const git = shared("orcha.git");
    const quiet = (text) => div().text_color(k.barText + "99").child(text);
    const facts = agentFacts();
    return h_flex()
      .id("orcha-status")
      .size_full()
      .px(12)
      .gap(12)
      .items_center()
      .bg(k.bar)
      .text_size(12)
      .text_color(k.barText)
      .when(Boolean(space), (el) => el.child(chip(k, space.name.toUpperCase(), k.pink).border(1.5).border_color(k.barText + "55")))
      .when(Boolean(task), (el) => el.child(div().max_w(360).truncate().font_bold().child(task)))
      .when(git?.files > 0, (el) =>
        el.child(
          h_flex()
            .gap(6)
            .child(quiet(git.files === 1 ? "1 file" : `${git.files} files`))
            .child(div().text_color(k.green).child(`+${git.added}`))
            .child(div().text_color(k.red).child(`−${git.removed}`)),
        ),
      )
      .when(Boolean(pane?.program?.agent), (el) => el.children(this.health(k, pane)))
      .child(div().flex_1())
      .when(Boolean(facts.herdr?.all), (el) => el.child(this.herdr(k, facts.herdr)))
      .children([countChip(k, count("blocked"), "blocked"), countChip(k, count("working"), "working"), countChip(k, count("done"), "done")].filter(Boolean))
      .when(Boolean(pane?.program?.agent), (el) => el.child(h_flex().gap(4).items_center().child(icon("clock", 12, k.barText + "99")).child(quiet(elapsed(this.stateAge(pane))))))
      .child(div().font_black().child(clock()));
  }
}
