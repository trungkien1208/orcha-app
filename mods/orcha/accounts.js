// ACCOUNTS (SPEC §3.2), opened from FUEL: one row per account with its plan
// limits. The Claude account in use has the heavy border, the yellow edge
// and IN USE; the one with the most fuel left is BEST and gets the raised
// green USE. Using an account makes every new Claude chat use it (orcha's
// `limits.py activate`).
//
// Read from orcha's own files (config.json, the limits cache): opening the
// popup asks nothing of the network. `r` refreshes through `limits.py json`.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, notify } from "herdr";
import { readAccounts, activateAccount, refreshFuel } from "./accounts-data.js";
import { tokens, raised, chip, button, icon, fuelGauge } from "./ui.js";

const left = (entry) => (Array.isArray(entry) ? Math.max(0, Math.min(100, Math.round(100 - Number(entry[0])))) : null);

export default class Accounts {
  constructor(cx) {
    this.list = [];
    this.active = null;
    this.at = 0;
    this.busy = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.load(cx);
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
      const fuel = Math.min(left(a.limits.session) ?? 100, left(a.limits.weekly) ?? 100);
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
        notify({ title: `New Claude chats use ${account.label ?? account.id}`, level: "success", timeout: 4000 });
      } else {
        notify({ title: "The account was not switched", body: failed, level: "error" });
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
    const action = a.kind !== "claude"
      ? null
      : inUse
        ? chip(k, "IN USE", k.ink, k.paper)
        : this.busy === a.id
          ? div().text_size(11.5).text_color(k.dim).child("switching…")
          : button(k, `use-${a.id}`, isBest ? "USE ↵" : "USE", (_e, cx) => this.use(a, cx), { primary: isBest, small: true });
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
          .children(gauges.length ? gauges : [div().text_size(11.5).text_color(k.dim).child("no fuel read yet")]),
      )
      .when(Boolean(action), (el) => el.child(action));
    return body;
  }

  key(e, cx) {
    const n = this.list.length;
    if (e.key === "escape") return this.close();
    if (!n) return;
    if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % n;
    else if (e.key === "up" || e.key === "k") this.at = (this.at + n - 1) % n;
    else if (e.key === "enter") this.use(this.list[this.at], cx);
    else if (e.key === "r") this.refresh(cx);
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
          .child(div().flex_1().truncate().text_size(12).text_color(k.muted).child("new Claude chats use the account in use"))
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
          .children(this.list.length ? this.list.map((a, i) => this.row(k, a, i, best, cx)) : [div().p(12).text_color(k.dim).child("No accounts yet: add them with orcha setup.")]),
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
          .child(keyHint("r", this.busy === "refresh" ? "refreshing…" : "refresh"))
          .child(div().flex_1())
          .child(keyHint("esc", "close")),
      );
    return raised(k, box, 5, 8);
  }
}
