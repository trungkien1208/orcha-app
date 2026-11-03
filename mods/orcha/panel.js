// orcha's right panel: FUEL (the active account's plan limits), then the
// focused folder's BRANCH, CHANGES, HISTORY and WORKTREES. It also runs the
// low-fuel watch (handoff-watch.js).
//
// Git is read with one shell call every 3 s; FUEL from orcha's limits cache
// every 30 s. Rendering only draws the last answers.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { focused, spaces, exec, readTextFile, home, shared, setShared, openOverlay } from "herdr";
import { tokens, button, icon, fuelGauge, readable } from "./ui.js";
import { showSide } from "./sidetabs.js";
import HandoffWatch from "./handoff-watch.js";

// One call: branch line, changed files, totals, last commit, worktree count.
const GIT_SCRIPT = [
  'cd "$1" 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0',
  'echo "B $(git status --porcelain=v1 -b 2>/dev/null | head -n 1)"',
  "git status --porcelain=v1 2>/dev/null | head -n 30 | sed 's/^/F /'",
  'echo "S $(git diff --shortstat HEAD 2>/dev/null)"',
  "echo \"L $(git log -1 --format='%s%x09%cr' 2>/dev/null)\"",
  "echo \"W $(git worktree list --porcelain 2>/dev/null | grep -c '^worktree ')\"",
].join("\n");

// "## main...origin/main [ahead 2, behind 1]" → { name, ahead, behind }
function parseBranch(line) {
  const m = /^## (?:No commits yet on )?(\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(line ?? "");
  if (!m) return null;
  const ahead = /ahead (\d+)/.exec(m[3] ?? "")?.[1];
  const behind = /behind (\d+)/.exec(m[3] ?? "")?.[1];
  return { name: m[1], ahead: Number(ahead ?? 0), behind: Number(behind ?? 0) };
}

function parseGit(out) {
  const git = { branch: null, files: [], added: 0, removed: 0, last: null, worktrees: 0 };
  for (const line of out.split("\n")) {
    const kind = line.slice(0, 2);
    const rest = line.slice(2);
    if (kind === "B ") git.branch = parseBranch(rest);
    else if (kind === "F ") git.files.push({ code: rest.slice(0, 2).trim() || "M", path: rest.slice(3) });
    else if (kind === "S ") {
      git.added = Number(/(\d+) insertion/.exec(rest)?.[1] ?? 0);
      git.removed = Number(/(\d+) deletion/.exec(rest)?.[1] ?? 0);
    } else if (kind === "L " && rest.trim()) {
      const [subject, age] = rest.split("\t");
      git.last = { subject, age };
    } else if (kind === "W ") git.worktrees = Number(rest.trim() || 0);
  }
  return git;
}

async function readJson(path) {
  try {
    const text = await readTextFile(path);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export default class Panel {
  constructor(cx) {
    this.folder = null;
    this.git = null;
    this.fuel = null;
    this.history = false;
    this.worktrees = false;
    this.readGit(cx);
    this.readFuel(cx);
    cx.timer.every(3000, (cx) => this.readGit(cx));
    cx.timer.every(30000, (cx) => this.readFuel(cx));
    this.watch = new HandoffWatch();
    cx.timer.every(60000, (cx) => this.watch.check(cx));
  }

  currentFolder() {
    return focused()?.cwd ?? spaces().find((s) => s.active)?.folder ?? null;
  }

  readGit(cx) {
    cx.spawn(async (cx) => {
      const folder = this.currentFolder();
      if (!folder) return;
      const r = await exec("sh", ["-c", GIT_SCRIPT, "sh", folder]);
      this.folder = folder;
      this.git = r.code === 0 && r.stdout.trim() ? parseGit(r.stdout) : null;
      // The status bar shows the same summary; told only when it changes.
      const g = this.git;
      const summary = g ? { branch: g.branch?.name ?? null, files: g.files.length, added: g.added, removed: g.removed } : null;
      if (JSON.stringify(summary) !== JSON.stringify(shared("orcha.git") ?? null)) setShared("orcha.git", summary);
      cx.notify();
    });
  }

  // The Claude account orcha has active, its email and both limits.
  readFuel(cx) {
    cx.spawn(async (cx) => {
      const id = (await readTextFile(`${home()}/.config/orcha/claude-active`))?.trim();
      if (!id) return;
      const config = await readJson(`${home()}/.config/orcha/config.json`);
      const limits = await readJson(`${home()}/.cache/orcha/limits/${id}.json`);
      const account = (config?.accounts ?? []).find((a) => a.id === id);
      this.fuel = { label: account?.label ?? id, email: account?.email ?? null, limits };
      cx.notify();
    });
  }

  // A section: icon and title (a chevron when it folds), then its rows.
  // `onClick` makes the whole section a button.
  section(t, name, title, children, { fold, onClick } = {}) {
    const open = !fold || fold.open;
    const head = h_flex()
      .h(24)
      .items_center()
      .gap(6)
      .text_size(11)
      .font_black()
      .text_color(t.ink)
      .when(Boolean(fold), (el) => el.child(icon(fold?.open ? "chevron-down" : "chevron-right", 13, t.dim)))
      .child(icon(name, 14, t.ink))
      .child(div().flex_1().child(title))
      .when(Boolean(onClick), (el) => el.child(icon("chevron-right", 13, t.dim)));
    const header = fold
      ? head
          .id(`fold-${title}`)
          .cursor_pointer()
          .on_click((_e, cx) => {
            fold.toggle();
            cx.notify();
          })
      : head;
    return v_flex()
      .id(`section-${title}`)
      .px(12)
      .py(10)
      .gap(5)
      .border_b(2)
      .border_color(t.line)
      .when(Boolean(onClick), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(onClick))
      .child(header)
      .when(open, (el) => el.children(children));
  }

  render(_cx) {
    const t = tokens();
    const sections = [];
    if (this.fuel) {
      const rows = [
        h_flex()
          .gap(6)
          .items_baseline()
          .child(div().text_size(12.5).font_bold().text_color(t.ink).child(this.fuel.label))
          .when(Boolean(this.fuel.email), (el) => el.child(div().flex_1().truncate().text_size(11).text_color(t.dim).child(this.fuel.email))),
      ];
      const session = fuelGauge(t, "5H", this.fuel.limits?.session);
      const weekly = fuelGauge(t, "WEEK", this.fuel.limits?.weekly);
      if (session) rows.push(session);
      if (weekly) rows.push(weekly);
      sections.push(
        this.section(t, "fuel", "FUEL", rows, {
          onClick: () => openOverlay({ mod: "orcha", props: { part: "accounts" }, kind: "dialog", width: 560, frame: "none" }),
        }),
      );
    }
    const git = this.git;
    if (!git) {
      sections.push(this.section(t, "git-branch", "BRANCH", [div().text_size(12).text_color(t.dim).child("not a git folder")]));
    } else {
      const b = git.branch;
      const branchRows = [div().text_size(12.5).font_bold().truncate().text_color(t.ink).child(b?.name ?? "detached")];
      if (b && (b.ahead || b.behind)) {
        branchRows.push(
          h_flex()
            .gap(8)
            .text_size(12)
            .when(b.ahead > 0, (el) => el.child(h_flex().gap(3).items_center().child(icon("arrow-up", 12, readable(t, t.done))).child(div().text_color(readable(t, t.done)).child(`${b.ahead} to push`))))
            .when(b.behind > 0, (el) => el.child(h_flex().gap(3).items_center().child(icon("arrow-down", 12, t.ansi4)).child(div().text_color(t.ansi4).child(`${b.behind} to pull`)))),
        );
      }
      // ⌘E / ⌘G: the project in the IDE or the Git app (orcha's extras script).
      const openIn = (app) => exec("sh", ["-c", 'HERDR_ACTIVE_PANE_CWD="$1" "$2" "$3"', "sh", this.folder, `${home()}/.orcha/scripts/open-in.sh`, app]);
      branchRows.push(
        h_flex()
          .gap(6)
          .pt(4)
          .child(button(t, "orcha-ide", h_flex().gap(5).items_center().child(icon("code-xml", 13)).child("IDE").child(div().text_color(t.dim).child("⌘E")), () => openIn("ide"), { small: true }))
          .child(button(t, "orcha-git", h_flex().gap(5).items_center().child(icon("git-merge", 13)).child("Git").child(div().text_color(t.dim).child("⌘G")), () => openIn("git"), { small: true })),
      );
      sections.push(this.section(t, "git-branch", "BRANCH", branchRows));

      const codeColor = (code) => readable(t, code.includes("D") ? t.blocked : code.includes("A") || code === "??" ? t.done : t.working);
      const changeRows = git.files.length
        ? [
            h_flex()
              .gap(8)
              .text_size(12)
              .child(div().text_color(t.muted).child(git.files.length === 1 ? "1 file" : `${git.files.length} files`))
              .child(div().font_bold().text_color(readable(t, t.done)).child(`+${git.added}`))
              .child(div().font_bold().text_color(readable(t, t.blocked)).child(`−${git.removed}`)),
            ...git.files.slice(0, 12).map((f) =>
              h_flex()
                .id(`change-${f.path}`)
                .gap(8)
                .rounded(3)
                .cursor_pointer()
                .hover((s) => s.bg(t.hover))
                .on_click(() => showSide("files"))
                .text_size(12)
                .child(div().w(16).font_bold().text_color(codeColor(f.code)).child(f.code === "??" ? "A" : f.code[0]))
                .child(div().flex_1().truncate().text_color(t.foreground).child(f.path)),
            ),
          ]
        : [div().text_size(12).text_color(t.dim).child("nothing changed")];
      sections.push(this.section(t, "file-diff", "CHANGES", changeRows));

      if (git.last) {
        sections.push(
          this.section(t, "history", "HISTORY", [div().text_size(12).truncate().text_color(t.foreground).child(git.last.subject), div().text_size(11.5).text_color(t.dim).child(git.last.age)], {
            fold: { open: this.history, toggle: () => (this.history = !this.history) },
          }),
        );
      }
      sections.push(
        this.section(t, "git-fork", `WORKTREES · ${git.worktrees}`, [div().text_size(12).text_color(t.muted).child(git.worktrees > 1 ? `${git.worktrees} checkouts of this repo` : "only this checkout")], {
          fold: { open: this.worktrees, toggle: () => (this.worktrees = !this.worktrees) },
        }),
      );
    }
    // One thin-bordered box, sections split by lines, no shadow (SPEC §2).
    return v_flex()
      .id("orcha-panel")
      .size_full()
      .p(10)
      .bg(t.paper)
      .child(v_flex().rounded(6).border(2).border_color(t.line).bg(t.card).overflow_hidden().overflow_y_scrollbar().children(sections));
  }
}
