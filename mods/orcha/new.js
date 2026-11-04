// NEW, as in the terminal orcha: from + NEW (the sidebar) and the tab strip.
// First a shell or an installed agent in a new tab of the project in front,
// then New project…; that opens NEW PROJECT: another folder (the system's
// picker), a typed path, projects from other tools (import.js), the
// current project's folder again, or a new worktree.

import { svg, image, div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { spaces, knownAgents, run, exec, pickFolder, props, closeOverlay, openOverlay, shared, setShared } from "herdr";
import { tokens, drawMenu, expandHome, openWorktree } from "./ui.js";
import { location } from "./files.js";
import { openImport } from "./import.js";

// The agents each machine reported last time, shown at once while
// knownAgents() asks again. Herdr's new-menu keeps its own: read, never written.
const KNOWN = "orcha.knownAgents";
const cachedAgents = (machine) => shared(KNOWN)?.[machine ?? ""] ?? shared("new-menu.agents")?.[machine ?? ""] ?? [];

/** Opens NEW, on the agent page (or NEW PROJECT when no project is open). */
export function openNew() {
  const n = cachedAgents(spaces().find((s) => s.active)?.machine).filter((a) => a.installed).length;
  openOverlay({ mod: "orcha", props: { part: "new" }, kind: "popup", at: "pointer", frame: "none", width: 280, height: Math.min(520, Math.max(250, 120 + (n + 2) * 30)) });
}

/** A project in `folder`, on this computer. */
const openProject = (folder) => run("space.new", { folder, machine: "" });

/** NEW PROJECT › Another folder: the system's picker, then the project. Run
 *  by the header (orcha.new-project), which stays open while the picker is
 *  up: this popup closes when it loses focus. */
export async function browseProject() {
  const folder = await pickFolder({ prompt: "Open project" }).catch(() => null);
  if (folder) openProject(folder);
}

export default class New {
  constructor(cx) {
    this.space = spaces().find((s) => s.active) ?? null;
    this.page = this.space ? "agent" : "project";
    this.at = 0;
    this.typing = false;
    this.error = null;
    const machine = this.space?.machine ?? null;
    this.agents = cachedAgents(machine);
    this.path = InputState.new({ placeholder: "/path/to/project or ~/code/app" });
    this.path.on("submit", (_e, cx) => this.submitPath(cx));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    cx.spawn(async (cx) => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [machine ?? ""]: this.agents });
      } catch {
        // the cached list stays
      }
      cx.notify();
    });
  }

  // The shown page's rows: { glyph, label, hint, act }. `act` returning true
  // keeps the popup open (another page, the path field).
  rows(k) {
    const space = this.space;
    if (this.page === "agent") {
      const installed = this.agents.filter((a) => a.installed);
      return [
        { glyph: "terminal", label: "Shell", act: () => run("tab.new", { space: space?.id }) },
        ...installed.map((a, i) => ({
          glyph: a.tint ? svg(a.icon).size(14).text_color(k.ink) : image(a.icon).size(14),
          label: a.name,
          hint: i < 9 ? String(i + 1) : "",
          act: () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }),
        })),
        null,
        { glyph: "plus", label: "New project…", hint: "P", act: () => this.show("project") },
      ];
    }
    const rows = [
      { glyph: "search", label: "Another folder", hint: "BROWSE", act: () => run("orcha.new-project") },
      { glyph: "file", label: "Enter folder path", hint: "TYPE", act: () => this.startTyping() },
      { glyph: "history", label: "Import from Cursor, Claude…", hint: "I", act: () => openImport() },
    ];
    if (space?.folder) rows.push({ glyph: "git-fork", label: `${space.name}'s folder again`, act: () => run("space.new", { folder: space.folder, machine: space.machine ?? "" }) });
    if (space) rows.push({ glyph: "git-branch", label: "New worktree…", act: () => openWorktree(space.id, "new", location().cwd) });
    return rows;
  }

  show(page) {
    this.page = page;
    this.at = 0;
    return true;
  }

  startTyping() {
    this.typing = true;
    this.error = null;
    this.path.focus();
    return true;
  }

  submitPath(cx) {
    cx.spawn(async (cx) => {
      const path = expandHome((this.path.value() ?? "").trim());
      const found = path && (await exec("test", ["-d", path])).code === 0;
      this.error = !path ? "Type a folder" : found ? null : "No such folder";
      if (!found) return cx.notify();
      openProject(path);
      closeOverlay(props()?.overlay);
    });
  }

  choose(row, cx) {
    if (!row) return;
    if (row.act()) cx.notify();
    else closeOverlay(props()?.overlay);
  }

  key(e, cx) {
    if (this.typing) {
      if (e.key !== "escape") return;
      this.typing = false;
      this.handle.focus();
      return cx.notify();
    }
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    const rows = this.rows(tokens()).filter(Boolean);
    if (e.key === "escape") {
      if (this.page === "project" && this.space) this.show("agent");
      else return closeOverlay(props()?.overlay);
    } else if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % rows.length;
    else if (e.key === "up" || e.key === "k") this.at = (this.at + rows.length - 1) % rows.length;
    else if (e.key === "enter") return this.choose(rows[this.at], cx);
    else return this.choose(rows.find((r) => r.hint && r.hint === e.key.toUpperCase()), cx);
    cx.notify();
  }

  render(_cx) {
    const k = tokens();
    const title = this.page === "agent" ? `NEW · in ${this.space?.name ?? "a new project"}` : "NEW PROJECT";
    const rows = this.rows(k).map((r) => r && [r.glyph, r.label, (cx) => this.choose(r, cx) ?? true, false, r.hint]);
    return drawMenu(k, title, rows, { selected: this.typing ? -1 : this.at })
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .when(this.typing, (el) =>
        el.child(
          v_flex()
            .gap(4)
            .p(6)
            .child(Input.new(this.path).w_full().h(28).px(8).rounded(5).border(2).border_color(k.line).bg(k.paper).text_size(12.5).text_color(k.ink))
            .child(div().text_size(11).text_color(this.error ? k.red : k.dim).child(this.error ?? "↵ open · esc back")),
        ),
      );
  }
}
