// ACCOUNTS (SPEC §3.2), opened from FUEL or the header: one row per account
// with its plan limits. The Claude account in use has the heavy border, the
// yellow edge and IN USE; the one with the most fuel left is BEST and gets
// the raised green USE. Using an account moves every Claude chat to it
// (orcha's `limits.py activate`). HAND OFF moves the focused agent's chat to
// an account (Settings › Hand-off says how); + ADD ACCOUNT adds a Claude
// account and opens its sign-in.
//
// Read from orcha's own files (config.json, the limits cache): opening the
// popup asks nothing of the network. `r` refreshes through `limits.py json`.

import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, notify } from "herdr";
import { readAccounts, activateAccount, refreshFuel, addAccount, signIn, handOff, restartOn, readHandoff, focusedAgent, canHandOffTo } from "./accounts-data.js";
import { tokens, raised, chip, button, icon, fuelGauge, fuelLeft } from "./ui.js";

export default class Accounts {
  constructor(cx) {
    this.list = [];
    this.active = null;
    this.at = 0;
    this.busy = null;
    this.choosing = null; // account id whose hand-off choices show
    this.adding = false;
    this.mode = "ask";
    this.nameInput = InputState.new({ placeholder: "name, like personal or work" });
    this.nameInput.on("submit", (_e, cx) => this.add(cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.load(cx);
    cx.spawn(async (cx) => {
      this.mode = (await readHandoff()).switch_mode;
      cx.notify();
    });
  }

  load(cx) {
    cx.spawn(async (cx) => {
      const { list, active } = await readAccounts();
      this.list = list;
      this.active = active;
      const current = list.findIndex((a) => a.id === active);
      if (current >= 0 && this.at === 0) this.at = current;
      cx.notify();
    });
  }

  // The Claude account with the most fuel left, by its tighter limit.
  best() {
    let best = null;
    let most = -1;
    for (const a of this.list) {
      if (a.kind !== "claude") continue;
      const fuel = Math.min(fuelLeft(a.limits.session) ?? 100, fuelLeft(a.limits.weekly) ?? 100);
      if (fuel > most) {
        most = fuel;
        best = a.id;
      }
    }
    return best;
  }

  close() {
    closeOverlay(props()?.overlay);
  }

  use(account, cx) {
    if (account.kind !== "claude" || account.id === this.active || this.busy) return;
    this.busy = account.id;
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = await activateAccount(account.id);
      this.busy = null;
      if (!failed) {
        this.active = account.id;
        notify({ title: `Claude chats use ${account.label ?? account.id} now`, body: "Running chats move within half a minute.", level: "success", timeout: 4000 });
      } else {
        notify({ title: "The account was not switched", body: failed, level: "error" });
      }
      cx.notify();
    });
  }

  add(cx) {
    if (this.busy) return;
    const name = this.nameInput.value();
    this.busy = "add";
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = await addAccount(name);
      this.busy = null;
      if (failed) notify({ title: "The account was not added", body: failed, level: "error" });
      else {
        this.adding = false;
        this.nameInput.set_value("");
        notify({ title: "Sign in beside your work", body: "When it says you're in, press Enter there.", level: "success", timeout: 6000 });
        this.close();
      }
      this.load(cx);
    });
  }

  // HAND OFF: how the chat moves. Claude to Claude has three ways (orcha's
  // switch_mode); anything else continues in a new pane with notes.
  handOff(account, how, cx) {
    const from = focusedAgent();
    const claudeToClaude = account.kind === "claude" && from?.program?.key?.includes("claude");
    const way = claudeToClaude ? how ?? (this.mode === "ask" ? null : this.mode) : "new_pane";
    if (!way) {
      this.choosing = this.choosing === account.id ? null : account.id;
      cx.notify();
      return;
    }
    if (way === "keep") return this.use(account, cx);
    this.busy = account.id;
    this.choosing = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const failed = way === "restart" ? await restartOn(account) : await handOff(account);
      this.busy = null;
      if (failed) notify({ title: "The chat did not move", body: failed, level: "error" });
      else {
        notify({ title: `The chat moves to ${account.label ?? account.id}`, body: way === "restart" ? "Same pane, restarted on the account." : "A new agent opens beside the old one and sums up first.", level: "success", timeout: 5000 });
        this.close();
      }
      cx.notify();
    });
  }

  refresh(cx) {
    if (this.busy) return;
    this.busy = "refresh";
    cx.notify();
    cx.spawn(async (cx) => {
      await refreshFuel();
      this.busy = null;
      this.load(cx);
    });
  }

  row(k, a, i, best, cx) {
    const inUse = a.kind === "claude" && a.id === this.active;
    const isBest = a.id === best && !inUse;
    const cursor = i === this.at;
    const kindColor = a.kind === "claude" ? k.yellow : a.kind === "codex" ? k.green : a.kind === "cursor" ? k.blue : k.pink;
    const gauges = [
      fuelGauge(k, "5H", a.limits.session),
      fuelGauge(k, "WEEK", a.limits.weekly),
      fuelGauge(k, "MONTH", a.limits.monthly),
    ].filter(Boolean);
    const from = focusedAgent();
    const busy = this.busy === a.id;
    const use = a.kind !== "claude"
      ? null
      : inUse
        ? chip(k, "IN USE", k.ink, k.paper)
        : button(k, `use-${a.id}`, isBest ? "USE ↵" : "USE", (_e, cx) => this.use(a, cx), { primary: isBest, small: true });
    const hand = from && canHandOffTo(a.kind) && !inUse ? button(k, `hand-${a.id}`, h_flex().gap(4).items_center().child(icon("handoff", 12, k.ink)).child("HAND OFF"), (_e, cx) => this.handOff(a, null, cx), { small: true }) : null;
    const sign = !gauges.length ? button(k, `sign-${a.id}`, "SIGN IN", () => { signIn(a.id); this.close(); }, { small: true }) : null;
    const action = busy
      ? div().text_size(11.5).text_color(k.dim).child("moving…")
      : v_flex().gap(5).items_end().when(Boolean(use), (el) => el.child(use)).when(Boolean(hand), (el) => el.child(hand)).when(Boolean(sign), (el) => el.child(sign));
    const choices = this.choosing === a.id
      ? h_flex()
          .gap(6)
          .pt(4)
          .items_center()
          .child(div().text_size(11.5).text_color(k.muted).child("Move the chat:"))
          .child(button(k, `keep-${a.id}`, "KEEP RUNNING", (_e, cx) => this.handOff(a, "keep", cx), { small: true, primary: true }))
          .child(button(k, `restart-${a.id}`, "RESTART", (_e, cx) => this.handOff(a, "restart", cx), { small: true }))
          .child(button(k, `pane-${a.id}`, "NEW PANE", (_e, cx) => this.handOff(a, "new_pane", cx), { small: true }))
      : null;
    const body = h_flex()
      .id(`account-${a.id}`)
      .flex_none()
      .relative()
      .gap(12)
      .p(10)
      .pl(inUse ? 16 : 12)
      .items_start()
      .rounded(6)
      .border(inUse || cursor ? 2.5 : 1.5)
      .border_color(inUse || cursor ? k.line : k.dim + "88")
      .bg(inUse || cursor ? k.card : k.paper)
      .overflow_hidden()
      .on_click((_e, cx) => {
        this.at = i;
        cx.notify();
      })
      .when(inUse, (el) => el.child(div().absolute().top(0).left(0).w(5).h_full().bg(k.yellow)))
      .child(chip(k, (a.kind ?? "agent").toUpperCase(), kindColor).border(1.5).border_color(k.line))
      .child(
        v_flex()
          .flex_1()
          .gap(4)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().font_black().text_color(k.ink).child(a.label ?? a.id))
              .when(isBest, (el) => el.child(chip(k, "BEST", k.green))),
          )
          .when(Boolean(a.email), (el) => el.child(div().text_size(11.5).text_color(k.dim).child(a.email)))
          .when(Boolean(a.limits.note), (el) => el.child(div().text_size(11).text_color(k.dim).child(a.limits.note)))
          .children(gauges.length ? gauges : [div().text_size(11.5).text_color(k.dim).child("no fuel read yet: sign in, then refresh")])
          .when(Boolean(choices), (el) => el.child(choices)),
      )
      .child(action);
    return body;
  }

  // + ADD ACCOUNT, then a name box and ADD once clicked.
  addRow(k) {
    if (!this.adding) {
      return h_flex()
        .id("account-add")
        .flex_none()
        .h(40)
        .gap(6)
        .justify_center()
        .items_center()
        .rounded(6)
        .border(2)
        .border_dashed()
        .border_color(k.dim)
        .text_size(12)
        .font_black()
        .text_color(k.muted)
        .cursor_pointer()
        .hover((s) => s.bg(k.hover).text_color(k.ink))
        .on_click((_e, cx) => {
          this.adding = true;
          this.nameInput.focus();
          cx.notify();
        })
        .child(icon("user-plus", 14))
        .child("ADD ACCOUNT");
    }
    return h_flex()
      .flex_none()
      .gap(8)
      .p(8)
      .items_center()
      .rounded(6)
      .border(2.5)
      .border_color(k.line)
      .bg(k.card)
      .child(chip(k, "CLAUDE", k.yellow).border(1.5).border_color(k.line))
      .child(Input.new(this.nameInput).flex_1().min_w(0).h(28).px(8).rounded(5).border(2).border_color(k.line).bg(k.paper).text_size(12.5).text_color(k.ink))
      .child(this.busy === "add" ? div().text_size(11.5).text_color(k.dim).child("adding…") : button(k, "account-add-go", "ADD ↵", (_e, cx) => this.add(cx), { primary: true, small: true }));
  }

  key(e, cx) {
    const n = this.list.length;
    if (this.adding) {
      if (e.key !== "escape") return;
      this.adding = false;
      this.handle.focus();
      cx.notify();
      return;
    }
    if (e.key === "escape") return this.close();
    if (e.key === "a") {
      this.adding = true;
      this.nameInput.focus();
      cx.notify();
      return;
    }
    if (!n) return;
    if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % n;
    else if (e.key === "up" || e.key === "k") this.at = (this.at + n - 1) % n;
    else if (e.key === "enter") this.use(this.list[this.at], cx);
    else if (e.key === "r") this.refresh(cx);
    else if (e.key === "h" && canHandOffTo(this.list[this.at]?.kind)) this.handOff(this.list[this.at], null, cx);
    else return;
    cx.notify();
  }

  render(cx) {
    const k = tokens();
    const best = this.best();
    const keyHint = (key, what) => h_flex().gap(4).items_center().child(div().font_black().text_color(k.ink).child(key)).child(div().text_color(k.muted).child(what));
    const box = v_flex()
      .id("orcha-accounts")
      .w(560)
      .h(640)
      .rounded(8)
      .border(3)
      .border_color(k.line)
      .bg(k.paper)
      .overflow_hidden()
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(
        h_flex()
          .flex_none()
          .px(14)
          .h(48)
          .gap(10)
          .items_center()
          .bg(k.card)
          .border_b(2.5)
          .border_color(k.line)
          .child(icon("fuel", 18, k.ink))
          .child(div().font_black().text_size(14).text_color(k.ink).child("ACCOUNTS"))
          .child(div().flex_1().truncate().text_size(12).text_color(k.muted).child("Claude chats use the account in use"))
          .child(
            div()
              .id("accounts-close")
              .p(4)
              .rounded(5)
              .border(2)
              .border_color(k.line)
              .cursor_pointer()
              .hover((s) => s.bg(k.hover))
              .on_click(() => this.close())
              .child(icon("x", 14, k.ink)),
          ),
      )
      .child(
        v_flex()
          .id("accounts-list")
          .flex_1()
          .min_h(0)
          .p(12)
          .gap(8)
          .overflow_y_scrollbar()
          .children(this.list.length ? this.list.map((a, i) => this.row(k, a, i, best, cx)) : [div().p(12).text_color(k.dim).child("No accounts yet. Add your first one below.")])
          .child(this.addRow(k)),
      )
      .child(
        h_flex()
          .flex_none()
          .px(14)
          .h(38)
          .gap(14)
          .items_center()
          .bg(k.card)
          .border_t(2.5)
          .border_color(k.line)
          .text_size(11.5)
          .child(keyHint("↵", "use"))
          .child(keyHint("↑↓", "move"))
          .child(keyHint("h", "hand off"))
          .child(keyHint("a", "add"))
          .child(keyHint("r", this.busy === "refresh" ? "refreshing…" : "refresh"))
          .child(div().flex_1())
          .child(keyHint("esc", "close")),
      );
    return raised(k, box, 5, 8);
  }
}
