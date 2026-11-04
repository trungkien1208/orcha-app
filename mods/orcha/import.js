// IMPORT PROJECTS (NEW PROJECT › Import…): folders people already worked
// in with Cursor, VS Code, Windsurf, Claude Code or Codex, newest first,
// picked several at a time. Each project shows once: a worktree counts as its
// main repo, paths are compared as the disk spells them, and projects orcha
// already has are left out, checked again when they are added.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, run, exec, home, props, closeOverlay, openOverlay, notify } from "herdr";
import { tokens, raised, icon } from "./ui.js";

/** Opens IMPORT PROJECTS. */
export function openImport() {
  openOverlay({ mod: "orcha", props: { part: "import" }, kind: "dialog", width: 560, height: 480, frame: "none" });
}

// Prints {have, rows: [{folder, sources}]} for the folders it is given (the
// projects orcha has); "roots <folder>…" prints those folders as project paths.
const SCAN = `import functools, glob, json, os, re, sqlite3, sys
from urllib.parse import unquote

HOME = os.path.realpath(os.path.expanduser("~"))
SKIP = ("/tmp", "/private", "/var", "/Volumes", "/System", "/Applications", HOME + "/Library", HOME + "/Downloads", HOME + "/Documents/Codex", HOME + "/Documents/ChatGPT")

@functools.cache
def names(d):
    try:
        return set(os.listdir(d))
    except OSError:
        return None

def canon(p):
    """The path as the disk spells it: macOS folders ignore case, so
    ~/project and ~/Project are one project."""
    out = "/"
    for part in p.strip("/").split("/"):
        here = names(out)
        if here is None:
            return p
        out = os.path.join(out, part if part in here else next((n for n in here if n.casefold() == part.casefold()), part))
    return out

@functools.cache
def root(path, need_git):
    """The project a folder is in: its git top (a worktree's main repo), or
    the folder itself when git is not needed. None for junk."""
    try:
        p = os.path.realpath(os.path.expanduser(path))
    except (OSError, ValueError):
        return None
    if not os.path.isdir(p):
        return None
    p = canon(p)
    top, d = None, p
    while d not in ("/", HOME):
        g = os.path.join(d, ".git")
        if os.path.isdir(g):
            top = d
            break
        if os.path.isfile(g):
            try:
                gitdir = open(g).read().strip().removeprefix("gitdir:").strip()
            except OSError:
                gitdir = ""
            main = gitdir.split("/.git/worktrees/")[0] if "/.git/worktrees/" in gitdir else None
            top = canon(os.path.realpath(main)) if main and os.path.isdir(main) else d
            break
        d = os.path.dirname(d)
    if top is None and need_git:
        return None
    top = top or p
    if top in ("/", HOME) or top.startswith(SKIP):
        return None
    if top.startswith(HOME + "/") and any(part.startswith(".") for part in top[len(HOME) + 1:].split("/")):
        return None
    return top

# roots <folder>…: each folder as a project path, to compare with.
if sys.argv[1:2] == ["roots"]:
    print(json.dumps([root(p, False) for p in sys.argv[2:]]))
    sys.exit()

found = {}

def add(path, source, at, need_git=True):
    r = root(path, need_git)
    if not r:
        return
    e = found.setdefault(r, {"folder": r, "sources": [], "at": 0})
    if source not in e["sources"]:
        e["sources"].append(source)
    e["at"] = max(e["at"], at)

# Editors keep a newest-first list of opened folders.
for app, label in (("Cursor", "Cursor"), ("Code", "VS Code"), ("Windsurf", "Windsurf")):
    db = os.path.join(HOME, "Library/Application Support", app, "User/globalStorage/state.vscdb")
    if not os.path.exists(db):
        continue
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True)
        row = con.execute("select value from ItemTable where key='history.recentlyOpenedPathsList'").fetchone()
        con.close()
        entries = json.loads(row[0]).get("entries", []) if row else []
    except Exception:
        continue
    at = os.path.getmtime(db)
    for i, e in enumerate(entries):
        uri = e.get("folderUri") or ""
        if uri.startswith("file://"):
            add(unquote(uri[7:]), label, at - i * 60, need_git=False)

CWD = re.compile(r'"cwd"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"')

def first_cwd(path):
    """The first "cwd" in a transcript, read 16 KB at a time up to 256 KB:
    its lines can be huge, and it is nearly always in the first bit."""
    try:
        with open(path, "rb") as f:
            text = ""
            for _ in range(16):
                chunk = f.read(16384)
                if not chunk:
                    break
                text += chunk.decode("utf-8", "ignore")
                m = CWD.search(text)
                if m:
                    return json.loads('"' + m.group(1) + '"')
    except (OSError, ValueError):
        pass
    return None

# Claude Code: one folder per project, its newest conversation says where.
for d in glob.glob(os.path.join(HOME, ".claude/projects/*/")):
    files = glob.glob(d + "*.jsonl")
    if files:
        newest = max(files, key=os.path.getmtime)
        cwd = first_cwd(newest)
        if cwd:
            add(cwd, "Claude", os.path.getmtime(newest))

# Codex: sessions by date; the first line says where.
files = glob.glob(os.path.join(HOME, ".codex/sessions/**/*.jsonl"), recursive=True)
for f in sorted(files, key=os.path.getmtime, reverse=True)[:400]:
    cwd = first_cwd(f)
    if cwd:
        add(cwd, "Codex", os.path.getmtime(f))

# Projects orcha already has, as the same kind of path: never offered again.
have = sorted({r for r in (root(p, False) for p in sys.argv[1:]) if r})
rows = sorted((e for r, e in found.items() if r not in have), key=lambda e: -e["at"])[:80]
print(json.dumps({"have": have, "rows": [{"folder": e["folder"], "sources": e["sources"]} for e in rows]}))
`;

const scan = async (args) => {
  const r = await exec("python3", ["-I", "-c", SCAN, ...args]);
  if (r.code !== 0) throw new Error((r.stderr || "python3 failed").trim().split("\n").pop());
  return JSON.parse(r.stdout);
};

// The folders of this computer's projects.
const localFolders = () => spaces().filter((s) => !s.machine && s.folder).map((s) => s.folder);

const short = (path) => (path.startsWith(`${home()}/`) ? `~${path.slice(home().length)}` : path);

export default class Import {
  constructor(cx) {
    this.rows = null;
    this.error = null;
    this.picked = new Set();
    this.at = 0;
    this.busy = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    cx.spawn(async (cx) => {
      try {
        this.rows = (await scan(localFolders())).rows;
      } catch (err) {
        this.error = String(err.message ?? err);
        this.rows = [];
      }
      cx.notify();
    });
  }

  toggle(folder) {
    if (this.picked.has(folder)) this.picked.delete(folder);
    else this.picked.add(folder);
  }

  // Adds the picked projects (or the selected one), each once, none orcha
  // has by now.
  add(cx) {
    if (this.busy || !this.rows?.length) return;
    const chosen = this.picked.size ? this.rows.filter((r) => this.picked.has(r.folder)) : [this.rows[this.at]];
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      let have;
      try {
        have = new Set(await scan(["roots", ...localFolders()]));
      } catch {
        have = new Set(localFolders());
      }
      let added = 0;
      for (const { folder } of chosen) {
        if (have.has(folder)) continue;
        run("space.new", { folder, machine: "" });
        have.add(folder);
        added += 1;
      }
      const skipped = chosen.length - added;
      notify({
        title: added ? `Added ${added} project${added > 1 ? "s" : ""}` : "Nothing new to add",
        body: skipped ? `${skipped} already in orcha, not added twice.` : undefined,
        level: added ? "success" : "info",
        timeout: 4000,
      });
      closeOverlay(props()?.overlay);
    });
  }

  key(e, cx) {
    if (e.modifiers?.control || e.modifiers?.platform || e.modifiers?.alt) return;
    const n = this.rows?.length ?? 0;
    if (e.key === "escape") return closeOverlay(props()?.overlay);
    if (e.key === "enter") return this.add(cx);
    if (!n) return;
    if (e.key === "down" || e.key === "j") this.at = (this.at + 1) % n;
    else if (e.key === "up" || e.key === "k") this.at = (this.at + n - 1) % n;
    else if (e.key === "space") this.toggle(this.rows[this.at].folder);
    else if (e.key === "a") {
      if (this.picked.size === n) this.picked.clear();
      else this.rows.forEach((r) => this.picked.add(r.folder));
    } else return;
    cx.stop_propagation();
    cx.notify();
  }

  row(k, r, i) {
    const on = this.picked.has(r.folder);
    const box = div()
      .w(15)
      .h(15)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(3)
      .border(2)
      .border_color(k.line)
      .bg(on ? k.yellow : k.paper)
      .text_size(10)
      .font_black()
      .text_color(k.chipText)
      .when(on, (el) => el.child("✓"));
    return h_flex()
      .id(`import-${i}`)
      .h(40)
      .px(8)
      .gap(10)
      .flex_none()
      .items_center()
      .rounded(5)
      .cursor_pointer()
      .when(i === this.at, (el) => el.bg(k.hover))
      .hover((el) => el.bg(k.hover))
      .on_click((_e, cx) => {
        this.at = i;
        this.toggle(r.folder);
        cx.notify();
      })
      .child(box)
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().font_semibold().text_color(k.ink).child(r.folder.split("/").pop()))
          .child(div().truncate().text_size(11).text_color(k.dim).child(short(r.folder))),
      )
      .child(div().flex_none().text_size(10).font_black().text_color(k.muted).child(r.sources.join(" · ").toUpperCase()));
  }

  render(_cx) {
    const k = tokens();
    const n = this.picked.size;
    const empty = this.error ? `Could not read them: ${this.error}` : this.rows ? "Nothing new: orcha already has every project found." : "Looking in Cursor, VS Code, Claude and Codex…";
    const addButton = div()
      .id("import-add")
      .px(12)
      .py(4)
      .rounded(5)
      .border(2)
      .border_color(k.line)
      .bg(n ? k.yellow : k.card)
      .cursor_pointer()
      .text_size(12)
      .font_black()
      .text_color(n ? k.chipText : k.muted)
      .on_click((_e, cx) => this.add(cx))
      .child(this.busy ? "adding…" : n ? `ADD ${n}` : "ADD");
    const box = v_flex()
      .id("orcha-import")
      .track_focus(this.handle)
      .w(550)
      .h(470)
      .rounded(8)
      .border(3)
      .border_color(k.line)
      .bg(k.paper)
      .overflow_hidden()
      .on_key_down((e, cx) => this.key(e, cx))
      .child(
        v_flex()
          .flex_none()
          .px(14)
          .py(10)
          .gap(2)
          .bg(k.card)
          .border_b(2.5)
          .border_color(k.line)
          .child(h_flex().gap(8).items_center().child(icon("history", 15, k.ink)).child(div().text_size(12.5).font_black().text_color(k.ink).child("IMPORT PROJECTS")))
          .child(div().text_size(11.5).text_color(k.muted).child("Folders you opened in Cursor, VS Code or Windsurf, or worked in with Claude Code or Codex.")),
      )
      .child(
        v_flex()
          .id("import-rows")
          .flex_1()
          .min_h(0)
          .p(6)
          .gap(2)
          .overflow_y_scrollbar()
          .text_size(12.5)
          .children((this.rows ?? []).map((r, i) => this.row(k, r, i)))
          .when(!this.rows?.length, (el) => el.child(div().p(10).text_color(this.error ? k.red : k.dim).child(empty))),
      )
      .child(
        h_flex()
          .flex_none()
          .h(40)
          .px(12)
          .gap(14)
          .items_center()
          .bg(k.card)
          .border_t(2.5)
          .border_color(k.line)
          .text_size(11)
          .text_color(k.muted)
          .child("space pick")
          .child("a all")
          .child("↵ add")
          .child("esc close")
          .child(div().flex_1())
          .child(addButton),
      );
    return raised(k, box, 5, 8);
  }
}
