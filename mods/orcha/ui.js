// orcha's neo-brutal look (docs/orcha/SPEC.md §1) on top of the shown theme:
// thick near-black lines, flat fills, a hard offset shadow on the few raised
// things, and color only for an agent, a state or the brand.

import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, shared } from "herdr";

function luminance(hex) {
  const n = parseInt((hex ?? "#000000").slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** The theme's colors plus orcha's tokens. */
export function tokens() {
  const t = theme();
  const dark = luminance(t.chrome ?? t.background) < 0.5;
  return {
    ...t,
    dark,
    paper: t.chrome,
    card: t.surface,
    frame: t.raised,
    ink: t.foreground,
    // Lines stay near-black in both appearances.
    line: dark ? "#0b0a09" : "#111111",
    shadow: dark ? "#000000" : "#111111",
    chipText: "#111111",
    pink: t.accent,
    yellow: t.working,
    green: t.done,
    red: t.blocked,
    // SPEC §1 tokens: bright fills that do not follow the terminal palette.
    blue: dark ? "#7f9bff" : "#6c8cff",
    teal: dark ? "#6fd0d6" : "#5cc4cb",
    bar: dark ? "#0b0a09" : "#111111",
    barText: dark ? t.foreground : t.chrome,
  };
}

export const RANK = { blocked: 4, working: 3, done: 2, idle: 1 };
export const WORD = { blocked: "needs you", working: "running", done: "done" };

export const stateColor = (k, status) => ({ blocked: k.red, working: k.yellow, done: k.green })[status] ?? k.dim;

/** Claude yellow, Codex green, Cursor blue, anything else pink. */
export function agentColor(k, program) {
  const key = program?.key ?? "";
  if (key.includes("claude")) return k.yellow;
  if (key.includes("codex")) return k.green;
  if (key.includes("cursor")) return k.blue;
  return k.pink;
}

/** A hard offset shadow behind `el`. Only for raised things. */
export function raised(k, el, offset = 3, radius = 6) {
  return div()
    .relative()
    .mr(offset)
    .mb(offset)
    .child(div().absolute().top(offset).left(offset).size_full().rounded(radius).bg(k.shadow))
    .child(el.relative());
}

/** A flat chip: bold dark text on a color. */
export function chip(k, text, bg, fg = k.chipText) {
  return div().px(6).h(18).flex().flex_none().items_center().rounded(4).bg(bg).text_size(11).font_black().text_color(fg).child(text);
}

/** A state dot: filled for running, needs you and done; a ring when idle. */
export function dot(k, status, size = 8) {
  const d = div().size(size).flex_none().rounded(size / 2);
  return RANK[status] && status !== "idle" ? d.bg(stateColor(k, status)).border(1).border_color(k.line) : d.border(1.5).border_color(k.dim);
}

/** The primary action: green, raised. Others: an outline. */
export function button(k, id, label, onClick, { primary = false, small = false } = {}) {
  const el = div()
    .id(id)
    .px(small ? 7 : 10)
    .h(small ? 22 : 28)
    .flex()
    .flex_none()
    .items_center()
    .justify_center()
    .gap(5)
    .rounded(5)
    .border(2)
    .border_color(k.line)
    .bg(primary ? k.green : k.card)
    .text_size(small ? 11.5 : 12.5)
    .font_black()
    .text_color(primary ? k.chipText : k.ink)
    .cursor_pointer()
    .hover((s) => s.bg(primary ? k.green : k.hover))
    .on_click((e, cx) => {
      cx.stop_propagation();
      onClick(e, cx);
    })
    .child(label);
  return primary ? raised(k, el, 2, 5) : el;
}

/** The app's icon for a program: a tinted glyph or a picture. */
export function programIcon(program, size, color) {
  if (!program?.icon) return null;
  return program.tint ? svg(program.icon).size(size).flex_none().text_color(color) : image(program.icon).w(size).h(size).flex_none();
}

/** A terminal's own title, unless it is only its address (`t1`, `t1f`). */
export function ownTitle(pane) {
  return /^([\w-]+\/)?t[0-9a-f]+$/.test(pane?.title ?? "") ? null : pane?.title || null;
}

/** What orcha read about agents (models by folder, stations by terminal). */
export function agentFacts() {
  return shared("orcha.agents") ?? { models: {}, stations: {} };
}

/** "claude-opus-5-5" → "Opus 5.5"; anything else as it is. */
export function modelLabel(id) {
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id ?? "");
  if (!m) return id || null;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}

/** The model an agent pane runs, else its program's name. */
export function modelOf(pane) {
  return agentFacts().models[pane?.cwd ?? ""] ?? pane?.program?.name ?? "agent";
}

export const row = () => h_flex().items_center();

/** A count chip colored by its state ("2 running"), or nothing for zero. */
export function countChip(k, n, status) {
  if (!n) return null;
  return h_flex().gap(5).items_center().child(chip(k, String(n), stateColor(k, status))).child(div().text_size(11.5).text_color(k.barText).child(WORD[status]));
}

/** One of orcha's icons (Phosphor Bold, icons/LICENSE), tinted with `color`. */
export function icon(name, size = 14, color) {
  const el = svg(`mods/orcha/icons/${name}.svg`).size(size).flex_none();
  return color ? el.text_color(color) : el;
}

/** "251k", "1.2M": a token count in a few letters. */
export function tokensShort(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

/** The tree's connector for a row: a trunk, with a branch into the row. */
export function connector(k, last, focused) {
  const color = focused ? k.yellow : k.dim;
  return div()
    .relative()
    .w(14)
    .h_full()
    .flex_none()
    .child(div().absolute().left(5).top(0).w(focused ? 2.5 : 1.5).h(last ? "50%" : "100%").bg(color))
    .child(div().absolute().left(5).top("50%").w(8).h(focused ? 2.5 : 1.5).bg(color));
}

/** The trunk alone, beside an agent's detail lines. */
export function trunk(k, last) {
  return div().relative().w(14).h_full().flex_none().when(!last, (el) => el.child(div().absolute().left(5).top(0).w(1.5).h_full().bg(k.dim)));
}

// Mixes `hex` toward black by `amount` (0..1).
function darken(hex, amount) {
  const n = parseInt((hex ?? "#000000").slice(1, 7), 16);
  const mix = (c) => Math.round(c * (1 - amount));
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** A state or agent color for text: as it is on dark paper, darker on light
 *  paper so it reads (brutal.rs `readable`). Fills keep the bright color. */
export function readable(k, color) {
  return k.dark ? color : darken(color, 0.45);
}

/** A soft pill: the color's tint behind its readable text. */
export function pill(k, children, color) {
  return h_flex()
    .h(20)
    .px(7)
    .gap(4)
    .flex_none()
    .items_center()
    .rounded(10)
    .bg(color + (k.dark ? "2e" : "40"))
    .text_size(11)
    .font_bold()
    .text_color(readable(k, color))
    .children(Array.isArray(children) ? children : [children]);
}

/** A project's tile: its emoji on a card, else its first letter on a color
 *  picked from its name, so each project keeps its own. */
export function projectTile(k, name, emoji, size = 28) {
  const tile = div().size(size).flex().flex_none().items_center().justify_center().rounded(7).border(2).border_color(k.line);
  if (emoji) return tile.bg(k.card).text_size(size * 0.55).child(emoji);
  const hues = [k.yellow, k.green, k.pink, k.blue, k.teal, k.red];
  let h = 0;
  for (const c of name ?? "") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return tile
    .bg(hues[h % hues.length])
    .text_size(size * 0.45)
    .font_black()
    .text_color(k.chipText)
    .child((name?.match(/[\p{L}\p{N}]/u)?.[0] ?? name?.[0] ?? "?").toUpperCase());
}

/** "3m", "2h05": a duration in a few letters. */
export function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 24 * 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 1440)}d`;
}

/** The percent of a plan limit left (0–100), from orcha's cache pair
 *  [percent used, reset at], or null. */
export function fuelLeft(entry) {
  return Array.isArray(entry) && !Number.isNaN(Number(entry[0])) ? Math.max(0, Math.min(100, Math.round(100 - Number(entry[0])))) : null;
}

/** A plan limit as ten segments over the full width, the percent left, and
 *  when it resets ("resets in 3h 06m · 00:52"). `entry` is orcha's cache
 *  pair [percent used, reset at (unix seconds)]. */
export function fuelGauge(k, name, entry) {
  const left = fuelLeft(entry);
  if (left == null) return null;
  const color = left > 50 ? k.green : left >= 20 ? k.yellow : k.red;
  const filled = Math.round(left / 10);
  const at = Number(entry[1]) * 1000;
  const mins = Math.round((at - Date.now()) / 60000);
  let reset = null;
  if (Number.isFinite(mins) && mins > 0) {
    const when = new Date(at);
    const sameDay = when.toDateString() === new Date().toDateString();
    const clock = `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    const day = sameDay ? clock : `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][when.getDay()]} ${clock}`;
    const span = mins < 60 ? `${mins}m` : mins < 48 * 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m` : `${Math.round(mins / 1440)}d`;
    reset = `resets in ${span} · ${day}`;
  }
  return v_flex()
    .w_full()
    .gap(3)
    .child(
      h_flex()
        .w_full()
        .gap(8)
        .items_center()
        .child(div().w(44).flex_none().text_size(11.5).font_black().text_color(k.muted).child(name))
        .child(h_flex().flex_1().gap(3).children(Array.from({ length: 10 }, (_, i) => div().flex_1().h(12).rounded(2).border(1.5).border_color(k.line).bg(i < filled ? color : k.raised))))
        .child(div().w(38).flex_none().text_right().text_size(12).font_black().text_color(readable(k, color)).child(`${left}%`)),
    )
    .when(Boolean(reset), (el) => el.child(div().pl(52).text_size(11).text_color(k.dim).child(reset)));
}
