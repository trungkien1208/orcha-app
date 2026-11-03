// Links in what agents print: web addresses and file paths, found in a
// terminal's text, then opened the way orcha in the terminal opens a
// Ctrl+clicked path (file_paths.rs): a folder in the file manager; a picture,
// PDF, web page or other document in the system's app; code and text in the
// viewer beside your work, or in the editor when [orcha.open_with] says so
// for that file type ("system", "folder", "editor", "editor:<command>").
// Relative paths are the pane's, else the project's; a bare name is looked
// for in the project.

import { exec, window, home, hc } from "herdr";
import { readTable } from "./config.js";
import { openFile } from "./files.js";

// file_paths.rs opens_in_system_app.
const SYSTEM_APP = new Set(
  "png jpg jpeg gif webp bmp tif tiff ico heic avif pdf doc docx xls xlsx ppt pptx odt ods odp pages numbers key rtf epub html htm mp4 mov m4v avi mkv webm mp3 wav m4a aac flac ogg zip tar gz tgz 7z rar dmg pkg msi".split(" "),
);

const URL_RE = /\bhttps?:\/\/[^\s<>"'`|\]]+/g;
const PATH_RE = /^(~|\.{1,2})?\/?[\w@.+-]+(\/[\w@.+-]+)*\/?(:\d+){0,2}$/;
// One-letter extensions only for real ones (.c .h .m .r .s .v .d), so "e.g" is no file.
const HAS_EXT = /\.([A-Za-z][A-Za-z0-9]{1,7}|[chmrsvd])(:\d+){0,2}$/;
const NOT_A_PATH = /^\d+(\.\d+)*(:\d+)*$|^\.+$|@.*\./;

/** How much of a terminal's history is read for links (`hc read` gives only
 *  the screen by default). */
export const HISTORY_LINES = "3000";

/** A terminal's screen and recent history, as text. */
export async function readTerminal(address) {
  return (await hc(["read", "--lines", HISTORY_LINES, address])).stdout ?? "";
}

/** The newest Claude conversation in `cwd` (Claude keeps one folder of them
 *  per project; orcha links every account's to ~/.claude's), or null. */
export async function claudeTranscript(cwd) {
  const dir = `${home()}/.claude/projects/${cwd.replace(/[/.]/g, "-")}`;
  const r = await exec("sh", ["-c", 'ls -t "$1"/*.jsonl 2>/dev/null | head -n 1', "orcha", dir]);
  return r.stdout.trim() || null;
}

// [label](target) in what Claude wrote: a web address, or a path with an
// optional :line or #L line.
const MD_LINK = /\[([^\]\n]{1,120})\]\(([^)\s]+)\)/g;

/** Links Claude wrote in the latest part of its conversation in `cwd`, as
 *  markdown: the screen shows only their labels (terminal hyperlinks).
 *  Newest first, with { label }. */
export async function transcriptLinks(cwd, max = 200) {
  const file = cwd && (await claudeTranscript(cwd));
  if (!file) return [];
  const r = await exec("tail", ["-n", "400", file]);
  const out = [];
  const seen = new Set();
  const lines = r.stdout.split("\n").reverse();
  for (const line of lines) {
    if (!line.includes('"assistant"') || !line.includes("](")) continue;
    let text = "";
    try {
      const msg = JSON.parse(line).message;
      text = (Array.isArray(msg?.content) ? msg.content : []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    } catch {
      continue;
    }
    const found = [...text.matchAll(MD_LINK)];
    for (const [, label, target] of found) {
      if (seen.has(target) || out.length >= max) continue;
      seen.add(target);
      if (/^https?:\/\//.test(target)) out.push({ raw: target, label, url: true });
      else {
        const m = /^(.*?)(?:#L(\d+)|:(\d+))?(?:-L?\d+)?$/.exec(target);
        out.push({ raw: target, label, path: m[1], line: Number(m[2] ?? m[3]) || null });
      }
    }
  }
  return out;
}

/** The links in `text`, newest (lowest on screen) first, each once:
 *  { raw, url } for a web address, { raw, path, line } for a file path. */
export function scanLinks(text, max = 300) {
  const out = [];
  const seen = new Set();
  const add = (link) => {
    if (seen.has(link.raw) || out.length >= max) return;
    seen.add(link.raw);
    out.push(link);
  };
  const lines = (text ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let line = lines[i];
    for (const m of line.match(URL_RE) ?? []) add({ raw: m.replace(/[.,;:!?)]+$/, ""), url: true });
    line = line.replace(URL_RE, " ");
    for (let token of line.split(/[^\w@.+\-/~:]+/)) {
      token = token.replace(/^:+/, "").replace(/[.,;:]+$/, "");
      if (token.length < 3 || !PATH_RE.test(token) || NOT_A_PATH.test(token)) continue;
      if (!token.includes("/") && !HAS_EXT.test(token)) continue;
      const m = /^(.*?)(?::(\d+))?(?::\d+)?$/.exec(token);
      add({ raw: token, path: m[1], line: m[2] ? Number(m[2]) : null });
    }
  }
  return out;
}

// Finds a printed path: as written, in the pane's folder, in the project,
// else a file of that name (or ending in that path) in the project.
const RESOLVE = `
p=$1; cwd=$2; root=$3
case $p in "~"*) p="$HOME\${p#\\~}";; esac
hit() { if [ -d "$1" ]; then echo "d $1"; exit 0; elif [ -e "$1" ]; then echo "f $1"; exit 0; fi; }
case $p in /*) hit "$p";; *) hit "$cwd/$p"; [ -n "$root" ] && hit "$root/$p";; esac
[ -n "$root" ] || exit 1
p=\${p#./}
if command -v rg >/dev/null 2>&1; then f=$(cd "$root" && rg --files --hidden -g '!.git' -g "**/$p" 2>/dev/null | head -n 1)
else f=$(cd "$root" && find . -path "*/$p" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -n 1); fi
[ -n "$f" ] && hit "$root/\${f#./}"
exit 1`;

/** Where a printed path is: { path, dir } or null. */
async function resolvePath(raw, cwd, root, on) {
  const r = await exec("sh", ["-c", RESOLVE, "orcha", raw, cwd ?? "", root ?? ""], { on });
  const m = /^([df]) (.+)$/.exec(r.stdout.trim());
  return r.code === 0 && m ? { dir: m[1] === "d", path: m[2] } : null;
}

/** Hands `target` (a path or a web address) to the system's app for it. */
function systemOpen(target, reveal = false) {
  const platform = window()?.platform;
  if (platform === "macos") return exec("open", reveal ? ["-R", target] : [target]);
  if (platform === "windows") return exec("explorer", [reveal ? `/select,${target}` : target]);
  return exec("xdg-open", [reveal ? target.replace(/\/[^/]*$/, "") : target]);
}

// The editor at a line (platform/macos.rs OrchaOpenTarget::File), or the
// person's own command with {path}, $P and $L.
function openInEditor(path, line, command) {
  const script = command
    ? command.replace(/\{path\}/g, '"$P"')
    : 'for c in cursor code; do command -v "$c" >/dev/null 2>&1 && exec "$c" -g "$P:$L"; done; command -v zed >/dev/null 2>&1 && exec zed "$P:$L"; open "$P"';
  return exec("sh", ["-c", `P="$1" L="$2"; ${script}`, "orcha", path, String(line ?? 1)]);
}

/** Opens a link: a web address in the browser, a path the way its type and
 *  [orcha.open_with] say. Null, or why it could not. */
export async function openLink(link, { cwd, root, on }) {
  if (link.url) {
    systemOpen(link.raw);
    return null;
  }
  const found = await resolvePath(link.path, cwd, root, on);
  if (!found) return `can't find ${link.path}`;
  const slash = found.path.lastIndexOf("/");
  const viewer = () => openFile(found.path.slice(0, slash) || "/", found.path.slice(slash + 1), on, null, link.line);
  // Another machine's files: only the viewer can show them here.
  if (on) return found.dir ? `${link.path} is a folder on ${on}` : (viewer(), null);
  if (found.dir) {
    systemOpen(found.path);
    return null;
  }
  const ext = /\.([A-Za-z0-9]+)$/.exec(found.path)?.[1]?.toLowerCase() ?? "";
  const choice = (await readTable("orcha.open_with"))[ext] ?? (SYSTEM_APP.has(ext) ? "system" : "viewer");
  if (choice === "system") systemOpen(found.path);
  else if (choice === "folder") systemOpen(found.path, true);
  else if (choice === "editor") openInEditor(found.path, link.line);
  else if (typeof choice === "string" && choice.startsWith("editor:")) openInEditor(found.path, link.line, choice.slice(7));
  else viewer();
  return null;
}
