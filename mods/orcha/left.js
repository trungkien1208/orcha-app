// The left side (SPEC §2 "Left sidebar", §3.1 PROCESS): + NEW and the menu,
// then the projects, then the running agents as trains.
//
// Read off the render path: one `ps` every 4 s for memory, and each Claude
// agent's newest transcript every 5 s for its model, its context and what it
// is doing (its station). Models, contexts and stations are shared with the
// other parts.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, run, exec, home, readTextFile, openOverlay, shared, setShared } from "herdr";
import {
  tokens,
  raised,
  dot,
  button,
  icon,
  programIcon,
  ownTitle,
  agentColor,
  modelLabel,
  modelOf,
  tokensShort,
  agentFacts,
  pill,
  projectTile,
  ago,
  RANK,
  agentTitle,
} from "./ui.js";
import { ICON_OVERLAY } from "./icon.js";

const GB = 1024 * 1024 * 1024;
// A context this big is worth a look (orcha_usage: HEAVY_CONTEXT_TOKENS).
const HEAVY_CONTEXT = 150_000;
const STATIONS = ["THINK", "CODE", "TEST", "DONE"];

const bytes = (n) => (n >= GB ? `${(n / GB).toFixed(1)}G` : `${Math.max(1, Math.round(n / (1024 * 1024)))}M`);

// Claude keeps a folder per project: the path with every character that is
// not a letter or a digit as `-` (so `LARK_AUTOMATION` is `LARK-AUTOMATION`).
const claudeDir = (cwd) => `${home()}/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, "-")}`;

// From the newest transcript: line 1 the model, line 2 the last tool call
// (with the start of a shell command), line 3 the last reply's token usage.
const TRANSCRIPT_SCRIPT = [
  'f=$(ls -t "$1"/*.jsonl 2>/dev/null | head -n 1); [ -n "$f" ] || exit 0',
  't=$(tail -c 262144 "$f")',
  "printf '%s' \"$t\" | grep -o '\"model\":\"claude-[a-z0-9.-]*' | tail -n 1 | cut -d'\"' -f4",
  "printf '%s\\n' \"$(printf '%s' \"$t\" | grep -o '\"type\":\"tool_use\",\"id\":\"[^\"]*\",\"name\":\"[A-Za-z_]*\"\\(,\"input\":{\"command\":\"[^\"]\\{0,120\\}\\)\\?' | tail -n 1)\"",
  "printf '%s' \"$t\" | grep -o '\"usage\":{[^}]*}' | tail -n 1",
].join("\n");

// Codex keeps its sessions by date; the newest one started in the folder:
// line 1 its size (or "same"), then the model (else config.toml's), the last
// tool call and the last turn's token usage in what was read.
const CODEX_SCRIPT = [
  'f=; for x in $(ls -t "$HOME"/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -n 40); do head -c 6000 "$x" | grep -qF "\\"cwd\\":\\"$1\\"" && { f=$x; break; }; done',
  'if [ -z "$f" ]; then sed -n \'s/^model *= *"\\(.*\\)"/\\1/p\' "$HOME/.codex/config.toml" 2>/dev/null | head -n 1; exit 0; fi',
  // $2 is its size last time: unchanged, say so; grown, read only what was
  // added (sessions reach tens of MB, mostly pictures).
  's=$(wc -c < "$f" | tr -d " "); [ "$s" = "$2" ] && { echo same; exit 0; }; echo "$s"',
  'from=1; [ -n "$2" ] && [ "$2" -lt "$s" ] && from=$(($2 + 1))',
  "tail -c +\"$from\" \"$f\" | LC_ALL=C grep -oE '\"model\":\"[^\"]*|\"name\":\"[a-z_]+\",\"input\":\".{0,250}|\"last_token_usage\":\\{[^}]*\\}' | awk '/^\"model/{m=$0} /^\"name/{t=$0} /^\"last_token/{u=$0} END{sub(/^\"model\":\"/,\"\",m); print m; print t; print u}'",
].join("\n");

const READING = /^(Read|Grep|Glob|LS|WebFetch|WebSearch|Task|Agent|TodoWrite|ToolSearch)$/;
const CHECKS = /\b(test|tests|jest|vitest|pytest|nextest|tsc|typecheck|lint|eslint|clippy|check)\b/;

// The station a tool call puts an agent at: reading → THINK, editing or
// running → CODE, tests and checks → TEST.
function stationOf(toolLine) {
  const name = /"name":"([A-Za-z_]+)"/.exec(toolLine ?? "")?.[1];
  if (!name || READING.test(name)) return "THINK";
  if (name === "Bash") return CHECKS.test(/"command":"(.*)$/.exec(toolLine)?.[1] ?? "") ? "TEST" : "CODE";
  return "CODE";
}

// Codex's station, from the command its last tool call ran: an edit is CODE,
// checks are TEST, looking around (ls, cat, rg, git status) is THINK.
function codexStation(toolLine) {
  if (!toolLine) return "THINK";
  if (/apply_patch|write_file|\bcat\s*>|>\s*\S+\.\w+/.test(toolLine)) return "CODE";
  if (CHECKS.test(toolLine)) return "TEST";
  if (/\b(ls|cat|rg|grep|find|head|tail|sed -n|git (status|log|diff|show))\b/.test(toolLine)) return "THINK";
  return "CODE";
}

// The tokens a reply carried: fresh input plus what came from the cache.
function contextOf(usageLine) {
  const field = (name) => Number(new RegExp(`"${name}":(\\d+)`).exec(usageLine ?? "")?.[1] ?? 0);
  const used = field("input_tokens") + field("cache_creation_input_tokens") + field("cache_read_input_tokens");
  return used > 0 ? used : null;
}

// A per-viewer list kept between restarts (localStorage can be missing).
function stored(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]");
  } catch {
    return [];
  }
}
function keep(key, set) {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // only a convenience
  }
}

export default class Left {
  constructor(cx) {
    this.memory = new Map(); // terminal address → bytes
    this.changed = new Map(); // pane → { status, at }
    this.icons = {}; // project folder → emoji (orcha's project-icons.json)
    this.codex = new Map(); // folder → { size, lines }: the last Codex session read
    // Projects opened or closed by their chevron, kept in this browser-like
    // store: the open project shows its agents unless closed; others when opened.
    this.opened = new Set(stored("orcha.opened"));
    this.closed = new Set(stored("orcha.closed"));
    this.readIcons(cx);
    this.readMemory(cx);
    this.readTranscripts(cx);
    cx.timer.every(4000, (cx) => this.readMemory(cx));
    cx.timer.every(5000, (cx) => this.readTranscripts(cx));
    cx.timer.every(60000, (cx) => this.readIcons(cx));
  }

  readIcons(cx) {
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(`${home()}/.config/orcha/project-icons.json`);
        this.icons = text ? JSON.parse(text) : {};
      } catch {
        this.icons = {};
      }
      cx.notify();
    });
  }

  // One pass over the process table: each terminal's shell and everything under it.
  readMemory(cx) {
    cx.spawn(async (cx) => {
      const live = terminals().filter((t) => t.state === "live" && t.pid);
      if (!live.length) return;
      const r = await exec("ps", ["-axo", "pid=,ppid=,rss="]);
      if (r.code !== 0) return;
      const rss = new Map();
      const kids = new Map();
      for (const line of r.stdout.split("\n")) {
        const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
        if (!pid) continue;
        rss.set(pid, kb * 1024);
        if (!kids.has(ppid)) kids.set(ppid, []);
        kids.get(ppid).push(pid);
      }
      const memory = new Map();
      for (const t of live) {
        let total = 0;
        const seen = new Set();
        const next = [t.pid];
        while (next.length) {
          const pid = next.pop();
          if (seen.has(pid)) continue;
          seen.add(pid);
          total += rss.get(pid) ?? 0;
          next.push(...(kids.get(pid) ?? []));
        }
        memory.set(t.address, total);
      }
      this.memory = memory;
      this.publish({ memory: Object.fromEntries([...memory].map(([t, b]) => [t, Math.round(b / (10 * 1024 * 1024)) * 10])) });
      cx.notify();
    });
  }

  // Models by folder; contexts and stations by terminal. Shared only when
  // something changed.
  // Models, contexts and stations by terminal: Claude's from its newest
  // conversation in the folder, Codex's from its newest session there.
  readTranscripts(cx) {
    cx.spawn(async (cx) => {
      const live = panes().filter((p) => p.cwd && p.terminal);
      const models = {};
      const contexts = {};
      const stations = {};
      // `lines(cwd)` gives [model, last tool call, last usage], or null.
      const read = async (kind, lines, station, context) => {
        const mine = live.filter((p) => p.program?.key?.includes(kind));
        for (const cwd of new Set(mine.map((p) => p.cwd))) {
          const got = await lines(cwd);
          if (!got) continue;
          const [model, tool, usage] = got;
          const label = modelLabel(model?.trim());
          const used = context(usage);
          for (const p of mine.filter((p) => p.cwd === cwd)) {
            if (label) models[p.terminal] = label;
            if (tool !== undefined) stations[p.terminal] = station(tool);
            if (used) contexts[p.terminal] = used;
          }
        }
      };
      const claude = async (cwd) => {
        const r = await exec("sh", ["-c", TRANSCRIPT_SCRIPT, "sh", claudeDir(cwd)]);
        return r.code === 0 ? r.stdout.split("\n") : null;
      };
      // Codex sessions are big: read again only when the file grew.
      const codex = async (cwd) => {
        const seen = this.codex.get(cwd);
        const r = await exec("sh", ["-c", CODEX_SCRIPT, "sh", cwd, seen?.size ?? ""]);
        if (r.code !== 0) return seen?.lines ?? null;
        const out = r.stdout.split("\n");
        if (out[0] === "same") return seen?.lines ?? null;
        // No session in the folder: config.toml's model alone.
        if (!/^\d+$/.test(out[0])) return [out[0]];
        // What the new part did not say, the earlier part did.
        const lines = out.slice(1, 4).map((line, i) => line || seen?.lines?.[i] || "");
        this.codex.set(cwd, { size: out[0], lines });
        return lines;
      };
      await read("claude", claude, stationOf, contextOf);
      await read("codex", codex, codexStation, (usage) => Number(/"input_tokens":(\d+)/.exec(usage ?? "")?.[1] ?? 0) || null);
      this.publish({ models, contexts, stations });
      cx.notify();
    });
  }

  // Shares what was read (memory in MB, to the nearest 10) only when it changed.
  publish(part) {
    const facts = { ...(shared("orcha.agents") ?? {}), ...part };
    if (JSON.stringify(facts) !== JSON.stringify(shared("orcha.agents") ?? null)) setShared("orcha.agents", facts);
  }

  top(k) {
    return h_flex()
      .gap(8)
      .px(2)
      .pt(4)
      .pb(12)
      .child(
        div()
          .flex_1()
          .child(
            button(k, "orcha-new", h_flex().gap(6).items_center().child(icon("plus", 15)).child("NEW"), () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 }), {
              primary: true,
            }),
          ),
      )
      .child(button(k, "orcha-menu", icon("menu", 16), () => run("app.palette")));
  }

  // Right-click: the menu for a project or a pane, where the pointer is.
  menu(target) {
    return (_e, cx) => {
      cx.stop_propagation();
      openOverlay({ mod: "orcha", props: { part: "menu", target }, kind: "popup", at: "pointer", frame: "none", width: 230, height: target.kind === "project" ? 222 : 220 });
    };
  }

  // How long a pane has been in its state; stamped when it changes.
  since(pane) {
    const now = Date.now();
    const seen = this.changed.get(pane.pane);
    if (!seen || seen.status !== pane.status) this.changed.set(pane.pane, { status: pane.status, at: now });
    return now - this.changed.get(pane.pane).at;
  }

  // An agent: its avatar in the agent's color, what it works on, its model and
  // how long it has been like this, then context and RAM as colored pills.
  agentCard(k, pane, agent) {
    const facts = agentFacts();
    const color = agentColor(k, pane.program);
    const title = agentTitle(agent, pane) || pane.program?.name;
    const context = pane.terminal ? facts.contexts?.[pane.terminal] : null;
    const mem = pane.terminal ? this.memory.get(pane.terminal) : null;
    const status = pane.status ?? "idle";
    const health = [];
    if (context) health.push(pill(k, [icon("brain", 11), `${tokensShort(context)} context`], context >= HEAVY_CONTEXT ? k.yellow : k.green));
    if (mem) health.push(pill(k, [icon("cpu", 11), `${bytes(mem)} RAM`], mem >= 2 * GB ? k.red : mem >= GB ? k.yellow : k.green));
    const statePill = status === "blocked" ? pill(k, "needs you", k.red) : status === "working" ? pill(k, "running", k.yellow) : status === "done" ? pill(k, "done", k.green) : null;
    return h_flex()
      .id(`pane-${pane.pane}`)
      .gap(10)
      .p(8)
      .items_start()
      .rounded(7)
      .border(pane.focused ? 2 : 0)
      .border_color(k.line)
      .when(pane.focused, (el) => el.bg(k.paper))
      .hover((el) => (pane.focused ? el : el.bg(k.hover)))
      .on_click(() => run("pane.focus", { pane: pane.pane }))
      .on_mouse_down("right", this.menu({ kind: "pane", pane: pane.pane, tab: pane.tab, terminal: pane.terminal, name: title }))
      .child(
        div()
          .relative()
          .size(30)
          .flex()
          .flex_none()
          .items_center()
          .justify_center()
          .rounded(15)
          .border(2)
          .border_color(k.line)
          .bg(color)
          .child(programIcon(pane.program, 16, k.chipText) ?? icon("zap", 15, k.chipText))
          .child(div().absolute().bottom(-2).right(-2).child(dot(k, status, 10))),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .gap(3)
          .child(
            h_flex()
              .gap(6)
              .items_center()
              .child(div().flex_1().min_w(0).truncate().font_bold().text_color(k.ink).child(title))
              .when(Boolean(statePill), (el) => el.child(statePill)),
          )
          .child(div().text_size(11.5).text_color(k.muted).child(`${modelOf(pane)} · ${ago(this.since(pane))}`))
          .when(health.length > 0, (el) => el.child(h_flex().gap(5).pt(2).children(health))),
      );
  }

  // A shell: one quiet row.
  shellRow(k, pane) {
    const title = ownTitle(pane) || pane.program?.name || "Shell";
    return h_flex()
      .id(`pane-${pane.pane}`)
      .h(30)
      .px(8)
      .gap(8)
      .items_center()
      .rounded(7)
      .border(pane.focused ? 2 : 0)
      .border_color(k.line)
      .when(pane.focused, (el) => el.bg(k.paper))
      .hover((el) => (pane.focused ? el : el.bg(k.hover)))
      .on_click(() => run("pane.focus", { pane: pane.pane }))
      .on_mouse_down("right", this.menu({ kind: "pane", pane: pane.pane, tab: pane.tab, terminal: pane.terminal, name: title }))
      .child(div().size(30).flex().flex_none().items_center().justify_center().child(icon("terminal", 15, k.muted)))
      .child(div().flex_1().truncate().text_size(12.5).text_color(k.ink).when(pane.focused, (el) => el.font_bold()).child(title));
  }

  // A project: its tile, its name, its branch and agents, and how it is doing.
  expanded(space) {
    return space.active ? !this.closed.has(space.id) : this.opened.has(space.id);
  }

  // The chevron: shows or hides a project's agents without switching to it.
  toggle(space, cx) {
    const open = this.expanded(space);
    const set = space.active ? this.closed : this.opened;
    if (open === space.active) set.add(space.id);
    else set.delete(space.id);
    keep("orcha.opened", this.opened);
    keep("orcha.closed", this.closed);
    cx.notify();
  }

  projectRow(k, space, mine) {
    const agentPanes = mine.filter((p) => p.program?.agent);
    const rank = Math.max(0, ...mine.map((p) => RANK[p.status] ?? 0));
    const word = Object.keys(RANK).find((s) => RANK[s] === rank);
    const sub = [space.branch, agentPanes.length ? `${agentPanes.length} agent${agentPanes.length > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
    const state =
      word === "blocked" ? pill(k, "needs you", k.red) : word === "working" ? pill(k, "running", k.yellow) : agentPanes.length ? h_flex().gap(3).children(agentPanes.map((p) => dot(k, p.status ?? "idle", 8))) : null;
    return h_flex()
      .id(`project-${space.id}`)
      .gap(10)
      .px(8)
      .py(6)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(!space.active, (el) => el.hover((s) => s.bg(k.hover)))
      .on_click(() => run("space.select", { id: space.id }))
      .on_mouse_down("right", this.menu({ kind: "project", id: space.id, name: space.name, folder: space.folder }))
      .child(
        div()
          .id(`tile-${space.id}`)
          .rounded(7)
          .hover((s) => s.opacity(0.8))
          .on_click((_e, cx) => {
            cx.stop_propagation();
            openOverlay({ mod: "orcha", props: { part: "icon", target: { id: space.id, folder: space.folder, name: space.name } }, ...ICON_OVERLAY });
          })
          .child(projectTile(k, space.name, this.icons[space.folder])),
      )
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().text_size(13.5).text_color(k.ink).when(space.active, (el) => el.font_black()).when(!space.active, (el) => el.font_semibold()).child(space.name))
          .when(Boolean(sub), (el) => el.child(div().truncate().text_size(11.5).text_color(k.muted).child(sub))),
      )
      .when(Boolean(state), (el) => el.child(state))
      .child(
        div()
          .id(`fold-${space.id}`)
          .flex_none()
          .p(3)
          .rounded(4)
          .cursor_pointer()
          .hover((s) => s.bg(k.hover))
          .tooltip(this.expanded(space) ? "Hide its agents" : "Show its agents")
          .on_click((_e, cx) => {
            cx.stop_propagation();
            this.toggle(space, cx);
          })
          .child(icon(this.expanded(space) ? "chevron-down" : "chevron-right", 13, k.dim)),
      );
  }

  // An expanded project: a raised card, its agents as cards, its shells as
  // rows; the selected one has the yellow edge. Others: one row each.
  project(k, space, mine, byPane) {
    const head = this.projectRow(k, space, mine);
    if (!this.expanded(space)) return head;
    const agentsHere = mine.filter((p) => p.program?.agent);
    const shells = mine.filter((p) => !p.program?.agent);
    const card = v_flex()
      .relative()
      .rounded(9)
      .border(2.5)
      .border_color(k.line)
      .bg(k.card)
      .overflow_hidden()
      .child(div().absolute().top(0).left(0).w(5).h_full().bg(space.active ? k.yellow : k.dim + "66"))
      .child(head.pl(12))
      .child(
        v_flex()
          .pl(12)
          .pr(6)
          .pb(8)
          .gap(4)
          .children(agentsHere.map((p) => this.agentCard(k, p, byPane.get(p.pane))))
          .children(shells.map((p) => this.shellRow(k, p))),
      );
    return raised(k, card, 4, 9);
  }

  // A metro line of the four stations. The train runs on the leg between
  // the stop it reached and the next one: the rail behind it filled in ink,
  // a small engine in the agent's color chugging forward with puffs of
  // smoke behind, the next stop blinking. When the agent moves on, the rail
  // grows and the engine glides to the next leg. At DONE it parks under the
  // flag. Everything moves natively, no redraws from here.
  metro(k, at, color, key = "depot") {
    const pct = (x) => `${(x / 3) * 100}%`;
    const moving = at >= 0 && at < 3;
    const head = at >= 3 ? 3 : at + 0.5;
    const puff = (left, top, size, period) =>
      div().absolute().left(left).top(top).size(size).rounded(size / 2).bg(k.dim).loop("opacity", { from: 0, to: 0.8, period });
    const body = h_flex()
      .relative()
      .size_full()
      .justify_center()
      .items_center()
      .rounded(4)
      .border(2)
      .border_color(k.line)
      .bg(color)
      .child(icon("train-front", 9, k.chipText))
      .when(moving, (el) => el.loop("top", { from: 0, to: -1.5, period: 420 }));
    const engine = div()
      .absolute()
      .top(-6)
      .right(-11)
      .w(22)
      .h(15)
      .child(
        div()
          .relative()
          .size_full()
          .when(moving, (el) => el.loop("left", { from: -3, to: 2, period: 1400 }))
          .when(moving, (el) => el.child(puff(-7, 1, 5, 700)).child(puff(-13, -2, 4, 900)).child(puff(-18, -4, 3, 1100)))
          .child(body),
      );
    // DONE is a little checkered flag.
    const flag = (done) =>
      v_flex()
        .size(10)
        .rounded(2)
        .border(1.5)
        .border_color(k.line)
        .overflow_hidden()
        .children(
          [0, 1].map((r) =>
            h_flex()
              .flex_1()
              .children([0, 1].map((c) => div().flex_1().bg((r + c) % 2 ? (done ? color : k.card) : k.ink))),
          ),
        );
    return div()
      .relative()
      .flex_1()
      .h(22)
      .child(div().absolute().top(10).left(0).w_full().h(3).rounded(2).bg(k.dim + "66"))
      .children(
        [0, 1, 2, 3].map((i) => {
          const next = moving && i === at + 1;
          const base = div().absolute().top(6.5).left(pct(i)).ml(-5);
          if (i === 3) return base.child(flag(at >= 3)).when(next, (el) => el.loop("opacity", { from: 0.4, to: 1, period: 900 }));
          return base
            .size(10)
            .rounded(5)
            .border(2)
            .border_color(next ? color : k.line)
            .bg(i <= at ? k.ink : k.card)
            .when(next, (el) => el.loop("opacity", { from: 0.35, to: 1, period: 900 }));
        }),
      )
      .when(at >= 0, (el) =>
        el.child(
          div()
            .id(`rail-${key}`)
            .absolute()
            .top(10)
            .left(0)
            .w(pct(head))
            .h(3)
            .rounded(2)
            .bg(k.ink)
            .transition("width", { duration: 900, easing: "ease-in-out" })
            .child(engine),
        ),
      );
  }

  // PROCESS (SPEC §3.1): a fixed card at the foot of the sidebar. Each running
  // agent is a train on its own line, labelled by its model.
  process(k, allPanes) {
    if (shared("orcha.process") === "off") return null;
    const running = allPanes.filter((p) => p.program?.agent && p.status === "working");
    const stations = agentFacts().stations ?? {};
    const lane = (pane) => {
      const color = agentColor(k, pane.program);
      const at = Math.max(0, STATIONS.indexOf(stations[pane.terminal] ?? "THINK"));
      return h_flex()
        .id(`train-${pane.pane}`)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .on_click(() => run("pane.focus", { pane: pane.pane }))
        .child(
          h_flex()
            .w(96)
            .flex_none()
            .h(24)
            .px(6)
            .gap(5)
            .items_center()
            .rounded(5)
            .border(2)
            .border_color(k.line)
            .bg(color)
            .child(programIcon(pane.program, 13, k.chipText) ?? icon("train-front", 13, k.chipText))
            .child(div().flex_1().truncate().text_size(10.5).font_black().text_color(k.chipText).child(modelOf(pane).toUpperCase())),
        )
        .child(this.metro(k, at, color, pane.pane));
    };
    // Station names under the line: first at its start, last at its end.
    const labels = h_flex()
      .pl(106)
      .justify_between()
      .text_size(9)
      .font_black()
      .text_color(k.dim)
      .children(STATIONS.map((s) => div().child(s)));
    const body = running.length
      ? v_flex().gap(8).children(running.map(lane)).child(labels)
      : v_flex()
          .gap(6)
          .child(h_flex().gap(10).items_center().child(h_flex().w(96).flex_none().gap(5).items_center().child(icon("train-front", 15, k.dim)).child(div().text_size(10.5).font_black().text_color(k.dim).child("DEPOT"))).child(this.metro(k, -1, k.dim)))
          .child(labels)
          .child(div().pt(2).text_size(11.5).text_color(k.muted).child("No trains running. They leave the depot when an agent starts working."));
    const card = v_flex()
      .gap(10)
      .p(12)
      .rounded(9)
      .border(2.5)
      .border_color(k.line)
      .bg(k.card)
      .child(
        h_flex()
          .gap(7)
          .items_center()
          .child(icon("train-front", 15, k.ink))
          .child(div().flex_1().text_size(12).font_black().text_color(k.ink).child("PROCESS"))
          .when(running.length > 0, (el) => el.child(pill(k, `${running.length} running`, k.yellow))),
      )
      .child(body);
    return div().px(2).pt(10).flex_none().child(raised(k, card, 4, 9));
  }

  render(cx) {
    const k = tokens();
    const rev = shared("orcha.iconsRev") ?? 0;
    if (rev !== this.iconsRev) {
      this.iconsRev = rev;
      this.readIcons(cx);
    }
    const allPanes = panes();
    const byPane = new Map(agents().map((a) => [a.pane, a]));
    const list = spaces();
    const projects = list.map((space) => {
      const tabIds = new Set(space.tabs.map((tab) => tab.id));
      return this.project(k, space, allPanes.filter((p) => tabIds.has(p.tab)), byPane);
    });
    const trains = this.process(k, allPanes);
    return v_flex()
      .id("orcha-left")
      .size_full()
      .px(10)
      .py(8)
      .bg(k.paper)
      .text_size(13)
      .child(this.top(k))
      .child(div().px(4).pb(6).text_size(11).font_black().text_color(k.dim).child(`PROJECTS · ${list.length}`))
      .child(v_flex().id("orcha-projects").flex_1().min_h(0).gap(4).overflow_y_scrollbar().children(projects))
      .when(Boolean(trains), (el) => el.child(trains));
  }
}
