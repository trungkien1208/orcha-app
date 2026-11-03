// orcha's accounts and their fuel, read from orcha's own files (config.json
// and the limits cache), and what can be done with them: use one, add one,
// hand a chat to one. Shared by ACCOUNTS, Settings › Accounts, Settings ›
// Hand-off and the low-fuel watch in the right panel.
//
// Signing in and switching go through orcha's extras (`limits.py`), so the
// Keychain and the shared account folders stay orcha's business.

import { readTextFile, writeTextFile, exec, hc, home, run, focused, agents, panes } from "herdr";
import { readTable, writeKey } from "./config.js";

const LIMITS = () => `${home()}/.orcha/scripts/limits.py`;
const CONFIG = () => `${home()}/.config/orcha/config.json`;

async function readJson(path) {
  try {
    const text = await readTextFile(path);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

const lastLine = (r, fallback) => (r.stderr || r.stdout || fallback).trim().split("\n").pop();
const pause = (seconds) => exec("sleep", [String(seconds)]);

/** Every account with its cached limits, and the Claude account in use. */
export async function readAccounts() {
  const config = await readJson(CONFIG());
  const active = (await readTextFile(`${home()}/.config/orcha/claude-active`))?.trim() ?? null;
  const list = [];
  for (const account of config?.accounts ?? []) {
    list.push({ ...account, limits: (await readJson(`${home()}/.cache/orcha/limits/${account.id}.json`)) ?? {} });
  }
  return { list, active };
}

/** Makes `id` the Claude account every Claude chat uses: new ones, and the
 *  running ones within half a minute, without a restart. Null, or why it failed. */
export async function activateAccount(id) {
  const r = await exec("python3", ["-I", LIMITS(), "activate", id]);
  return r.code === 0 ? null : lastLine(r, "limits.py failed");
}

/** Reads every account's fuel again (network), into the cache. */
export async function refreshFuel() {
  await exec("python3", ["-I", LIMITS(), "json"]);
}

/** "Personal Mac" → "personal-mac" (orcha's account_slug). */
export function accountSlug(name) {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Opens a pane beside the focused one that signs `id` in (orcha's
 *  `limits.py login`: the account's own folder, its email filled in). */
export function signIn(id) {
  run("pane.split", { direction: "right", argv: ["python3", "-I", LIMITS(), "login", id] });
}

/** Adds the Claude account `name` to orcha's config.json (as orcha's
 *  add_to_config does) and opens its sign-in. Null, or why it failed. */
export async function addAccount(name) {
  const slug = accountSlug(name);
  if (!slug) return "Give it a name, like personal or work.";
  const id = `claude-${slug}`;
  const before = await readTextFile(CONFIG());
  let config;
  try {
    config = before ? JSON.parse(before) : {};
  } catch {
    return "orcha's config.json could not be read.";
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) return "orcha's config.json is not an object.";
  const list = (config.accounts ??= []);
  if (!Array.isArray(list)) return "accounts in config.json is not a list.";
  if (list.some((a) => a?.id === id || a?.id?.replace(/^claude-/, "") === slug)) return `${id} is already an account.`;
  list.push({ id, kind: "claude", label: `Claude · ${slug}`, email: "", dir: `~/.ai-accounts/claude/${slug}` });
  try {
    await writeTextFile(CONFIG(), `${JSON.stringify(config, null, 2)}\n`, before);
  } catch {
    return "config.json changed meanwhile. Try again.";
  }
  signIn(id);
  return null;
}

// Hand-off settings ------------------------------------------------------
// In orcha's config.toml under [orcha], shared with orcha in the terminal
// (config/model.rs OrchaConfig).

export const HANDOFF_DEFAULTS = {
  low_fuel_percent: 10,
  checklist_percent: 0,
  checklist_file: ".orcha/handoff.md",
  auto_handoff_percent: 0,
  switch_mode: "ask",
};

/** The hand-off settings, orcha's defaults filled in. */
export async function readHandoff() {
  const table = await readTable("orcha");
  const out = { ...HANDOFF_DEFAULTS };
  for (const key of Object.keys(HANDOFF_DEFAULTS)) if (key in table) out[key] = table[key];
  return out;
}

/** Sets one hand-off setting. Null, or why it failed. */
export function writeHandoff(key, value) {
  return key in HANDOFF_DEFAULTS ? writeKey("orcha", key, value) : Promise.resolve(`unknown setting ${key}`);
}

// Hand-off ---------------------------------------------------------------
// orcha_handoff.rs, the app's way: the old agent is asked nothing, so it
// works when it is out of fuel. Notes say what the work is, the folder's git
// state and where the old conversation is; the new agent opens beside the
// old one, reads them, sums up and waits for a go.

const AGENT_RUN = { claude: "claude", codex: "codex", cursor: "cursor-agent" };

/** The kinds a chat can be handed to. */
export const canHandOffTo = (kind) => kind in AGENT_RUN;

/** The agent pane people are looking at, or null. */
export function focusedAgent() {
  const f = focused();
  if (!f?.pane) return null;
  const pane = panes().find((p) => p.pane === f.pane);
  if (!pane?.program?.agent) return null;
  const agent = agents().find((a) => a.pane === f.pane);
  return { pane: f.pane, terminal: agent?.address ?? f.terminal, cwd: pane.cwd || f.cwd, program: pane.program, title: agent?.title ?? pane.title ?? "" };
}

const sh = (script, ...args) => exec("sh", ["-c", script, "orcha", ...args]);

// The newest Claude conversation in `cwd` (Claude keeps one folder of them
// per project; orcha links every account's to ~/.claude's).
async function claudeTranscript(cwd) {
  const dir = `${home()}/.claude/projects/${cwd.replace(/[/.]/g, "-")}`;
  const r = await sh('ls -t "$1"/*.jsonl 2>/dev/null | head -n 1', dir);
  return r.stdout.trim() || null;
}

const fence = (text) => ["```", text.trim(), "```", ""];

async function buildNotes(from, checklistFile) {
  const source = from.program?.name ?? "agent";
  const lines = [
    `# Hand-off: ${from.title || "work in progress"}`,
    "",
    `You are taking over work another coding agent (${source}) started in \`${from.cwd}\`.`,
    "It stopped (usually out of plan limits), not because the work is done.",
    "",
    "Read these notes and check the repository state yourself. Then sum up where the work stands in five bullets: goal, what is done, what is left, open questions, the next step you suggest.",
    "",
    "**Do not continue the work yet.** Change no files and run nothing that changes state until the user tells you to go on.",
    "",
  ];
  if (checklistFile && (await sh('test -f "$1/$2"', from.cwd, checklistFile)).code === 0) {
    lines.push(`The previous agent left a checklist in \`${checklistFile}\`: read it too.`, "");
  }
  const git = (args) => exec("git", ["-C", from.cwd, ...args]).then((r) => (r.code === 0 ? r.stdout : ""));
  const [branch, status, stat, log] = await Promise.all([
    git(["branch", "--show-current"]),
    git(["status", "--short"]),
    git(["diff", "--stat", "HEAD"]),
    git(["log", "--oneline", "-8"]),
  ]);
  if (branch || status || log) {
    lines.push("## Repository", "", `- branch: \`${branch.trim() || "(detached)"}\``, "");
    if (status.trim()) lines.push("Uncommitted changes:", "", ...fence(status.slice(0, 4000)));
    if (stat.trim()) lines.push("Diff size:", "", ...fence(stat.slice(-2000)));
    if (log.trim()) lines.push("Recent commits:", "", ...fence(log));
  }
  const transcript = from.program?.key?.includes("claude") ? await claudeTranscript(from.cwd) : null;
  if (transcript) {
    lines.push("## Conversation", "", `The previous agent's conversation is in \`${transcript}\` (one JSON object per line, newest last). Read its last part first: the latest user requests and what the agent did about them.`, "");
  } else if (from.terminal) {
    const screen = await hc(["read", from.terminal]);
    const tail = (screen.stdout ?? "").split("\n").slice(-300).join("\n");
    if (tail.trim()) lines.push("## The previous agent's screen", "", ...fence(tail.slice(-60000)));
  }
  return lines.join("\n");
}

// A Claude account's own folder, unless it is ~/.claude itself.
function claudeDir(account) {
  const dir = account.dir?.replace(/^~(?=\/)/, home());
  return dir && dir !== `${home()}/.claude` ? dir : null;
}

/** Moves the focused agent's chat to `account`: notes, then the account's
 *  agent beside it, told to read them. Null, or why it failed. */
export async function handOff(account, { checklistFile = HANDOFF_DEFAULTS.checklist_file } = {}) {
  const from = focusedAgent();
  if (!from) return "Click into an agent first: its chat is what moves.";
  const command = AGENT_RUN[account.kind];
  if (!command) return `orcha can't hand a chat to ${account.kind}.`;
  const notes = await buildNotes(from, checklistFile);
  const folder = `${home()}/.cache/orcha/handoff`;
  await sh('mkdir -p "$1" && chmod 700 "$1"', folder);
  const path = `${folder}/${new Date().toISOString().replace(/[:.]/g, "-")}-${account.kind}.md`;
  try {
    await writeTextFile(path, notes, null);
  } catch {
    return "The notes could not be saved.";
  }
  let argv = [command, `Read the hand-off notes in ${path}, sum up where the work stands, then wait for my go.`];
  const dir = account.kind === "claude" ? claudeDir(account) : null;
  if (dir) {
    await exec("python3", ["-I", LIMITS(), "link", account.id]);
    argv = ["env", `CLAUDE_CONFIG_DIR=${dir}`, ...argv];
  }
  run("pane.split", { direction: "right", pane: from.pane, argv });
  return null;
}

/** Same pane, same chat, the agent restarted on `account` (orcha's
 *  SwitchMode::Restart): stops Claude and continues the folder's latest
 *  conversation on the account. */
export async function restartOn(account) {
  const from = focusedAgent();
  if (!from?.terminal) return "Click into an agent first.";
  if (account.kind !== "claude" || !from.program?.key?.includes("claude")) return "Restarting on another account works from Claude to Claude.";
  const dir = claudeDir(account);
  if (dir) await exec("python3", ["-I", LIMITS(), "link", account.id]);
  const env = dir ? `env CLAUDE_CONFIG_DIR=${dir}` : "env -u CLAUDE_CONFIG_DIR";
  // Ctrl+C twice leaves Claude Code; then the shell continues the chat.
  await hc(["keys", from.terminal, "ctrl+c"]);
  await pause(0.4);
  await hc(["keys", from.terminal, "ctrl+c"]);
  await pause(1);
  const r = await hc(["send", from.terminal, `${env} claude --continue`]);
  return r.code === 0 ? null : lastLine(r, "hc send failed");
}

/** Asks the focused agent to write its checklist (it reads it between turns). */
export async function askForChecklist(file = HANDOFF_DEFAULTS.checklist_file) {
  const from = focusedAgent();
  if (!from?.terminal) return "Click into an agent first.";
  const text = `Your plan is running low. Before anything else, write ${file}: what is done, what is next as "- [ ]" items, open questions, and the files you touched, so another agent can continue. Then carry on.`;
  const r = await hc(["send", from.terminal, text]);
  return r.code === 0 ? null : lastLine(r, "hc send failed");
}
