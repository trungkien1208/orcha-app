// orcha's accounts and their fuel, read from orcha's own files (config.json
// and the limits cache), and what can be done with them: use one, add one,
// hand a chat to one. Shared by ACCOUNTS, Settings › Accounts, Settings ›
// Hand-off and the low-fuel watch in the right panel.
//
// Signing in and switching go through orcha's extras (`limits.py`), so the
// Keychain and the shared account folders stay orcha's business.

import { readTextFile, writeTextFile, exec, hc, home, run, focused, agents, panes } from "herdr";
import { agentTitle, expandHome } from "./ui.js";
import { readTable, writeKey } from "./config.js";
import { claudeTranscript, readTerminal } from "./links.js";

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

// The default account (Settings › Make default) is kept apart from the one in
// the main folder now (claude-active): chats on the main folder can borrow
// another account without a restart, and the default stays what it was.
const DEFAULT_FILE = () => `${home()}/.config/orcha/claude-default`;

/** Every account with its cached limits, the Claude account in the main
 *  folder now (`active`) and the default one (`main`, the same unless the
 *  main folder's chats are borrowing). */
export async function readAccounts() {
  const config = await readJson(CONFIG());
  const active = (await readTextFile(`${home()}/.config/orcha/claude-active`))?.trim() ?? null;
  const main = (await readTextFile(DEFAULT_FILE()))?.trim() || active;
  const list = [];
  for (const account of config?.accounts ?? []) {
    list.push({ ...account, limits: (await readJson(`${home()}/.cache/orcha/limits/${account.id}.json`)) ?? {} });
  }
  return { list, active, main };
}

/** Puts `id` in the main folder: every chat there moves to it within half a
 *  minute, without a restart. Null, or why it failed. */
async function activateAccount(id) {
  const r = await exec("python3", ["-I", LIMITS(), "activate", id]);
  return r.code === 0 ? null : lastLine(r, "limits.py failed");
}

/** Settings › Make default: new chats start on `id`, and so do the ones on
 *  the main folder (no longer borrowing). Null, or why it failed. */
export async function makeDefault(id) {
  const failed = await activateAccount(id);
  if (failed) return failed;
  try {
    await writeTextFile(DEFAULT_FILE(), `${id}\n`, await readTextFile(DEFAULT_FILE()));
  } catch {
    return "The default was not saved. Try again.";
  }
  return null;
}

/** Reads the accounts' fuel into the cache (network). Accounts read in the
 *  last two minutes are skipped, unless `fresh` (someone asked for it). */
export async function refreshFuel(fresh = false) {
  await exec("python3", ["-I", LIMITS(), "json", ...(fresh ? ["fresh"] : [])]);
}

// The config folder each terminal's Claude reads (CLAUDE_CONFIG_DIR, from its
// process), or "-" for the main one, as limits.py takes it. One ps for all.
async function configFolders(terminals) {
  const pids = await Promise.all(
    terminals.map(async (t) => {
      try {
        return JSON.parse((await hc(["get", "--json", t])).stdout).foreground?.pid ?? null;
      } catch {
        return null;
      }
    }),
  );
  const env = new Map();
  const live = pids.filter(Boolean);
  if (live.length) {
    const r = await exec("ps", ["-E", "-ww", "-o", "pid=,command=", "-p", live.join(",")]);
    for (const line of r.stdout.split("\n")) {
      const m = /^\s*(\d+)\s(.*)$/.exec(line);
      if (m) env.set(Number(m[1]), /(?:^|\s)CLAUDE_CONFIG_DIR=(\S+)/.exec(m[2])?.[1] ?? "-");
    }
  }
  return pids.map((pid) => (pid && env.get(pid)) || "-");
}

const configFolder = async (terminal) => (await configFolders([terminal]))[0];

/** Which Claude account each Claude pane runs on, by terminal:
 *  { id, label, other, borrowed, seat }. `other`: not the default account
 *  (the main folder's). `borrowed`: the pane's folder belongs to another
 *  account (`seat`, its id: the session's own) and was kept running on this
 *  one, no restart. One read of
 *  every pane's folder and one per folder of who holds it. */
export async function readPaneAccounts() {
  const claudes = panes().filter((p) => p.terminal && p.program?.key?.includes("claude"));
  if (!claudes.length) return {};
  const folders = await configFolders(claudes.map((p) => p.terminal));
  const unique = [...new Set(folders)];
  const holders = await Promise.all(unique.map((f) => exec("python3", ["-I", LIMITS(), "whoami", f]).then((r) => (r.code === 0 ? r.stdout.trim() || null : null))));
  const holderOf = new Map(unique.map((f, i) => [f, holders[i]]));
  const { list, main } = await readAccounts();
  const out = {};
  claudes.forEach((p, i) => {
    const folder = folders[i];
    const id = holderOf.get(folder);
    if (!id) return;
    // Whose the folder is: the default account's for the main one.
    const owner = folder === "-" ? list.find((a) => a.id === main) ?? null : list.find((a) => a.kind === "claude" && claudeDir(a) === folder) ?? null;
    const label = list.find((a) => a.id === id)?.label ?? id;
    const borrowed = Boolean(owner && owner.id !== id);
    out[p.terminal] = { id, label, other: id !== main, borrowed, seat: borrowed ? owner.id : null };
  });
  return out;
}

/** The account a terminal's Claude runs on, or null. */
export async function claudeAccountOf(terminal) {
  const r = await exec("python3", ["-I", LIMITS(), "whoami", await configFolder(terminal)]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/** What keeping `from`'s chat running on another account would do: a
 *  sign-in belongs to a config folder, so every chat in that folder moves
 *  (`others` besides this one), borrowing the account; the default account
 *  stays as it is. */
export async function keepInfo(from) {
  if (!from?.terminal) return { why: "Click into an agent first.", others: 0 };
  const claudes = panes().filter((p) => p.terminal && p.terminal !== from.terminal && p.program?.key?.includes("claude"));
  const [folder, ...folders] = await configFolders([from.terminal, ...claudes.map((p) => p.terminal)]);
  return { why: null, others: folders.filter((f) => f === folder).length };
}

/** The chat keeps running on `account`'s sign-in, no restart: Claude reads it
 *  again within half a minute, and FUEL shows it BORROWED. Chats sharing its
 *  folder move with it (keepInfo). Null, or why not. */
export async function keepRunningOn(account, from) {
  const { why } = await keepInfo(from);
  if (why) return why;
  const folder = await configFolder(from.terminal);
  // Borrowing on the main folder: remember the default first, so it stays.
  if (folder === "-" && !(await readTextFile(DEFAULT_FILE()))?.trim()) {
    const { active } = await readAccounts();
    if (active) await writeTextFile(DEFAULT_FILE(), `${active}\n`, null).catch(() => {});
  }
  const r = await exec("python3", ["-I", LIMITS(), "switch-dir", account.id, folder]);
  return r.code === 0 ? null : lastLine(r, "limits.py failed");
}

/** A new chat on `account`, in a new tab: Claude in the account's own folder,
 *  Codex and Cursor as they are. Null, or why not. */
export async function startOn(account) {
  if (account.kind !== "claude") {
    const argv = AGENT_RUN[account.kind];
    if (!argv) return `orcha can't start ${account.kind}.`;
    run("tab.new", { argv: [argv] });
    return null;
  }
  const dir = claudeDir(account);
  const why = await mainFolderTaken(account, dir);
  if (why) return why;
  if (dir) await exec("python3", ["-I", LIMITS(), "link", account.id]);
  run("tab.new", { argv: dir ? ["env", `CLAUDE_CONFIG_DIR=${dir}`, "claude"] : ["claude"] });
  return null;
}

// An account without a folder of its own runs on the main one, which holds
// whichever account is the default: why `account` can't run there now, or null.
async function mainFolderTaken(account, dir) {
  if (dir) return null;
  const holder = (await exec("python3", ["-I", LIMITS(), "whoami", "-"])).stdout.trim();
  if (holder === account.id) return null;
  const { list } = await readAccounts();
  const other = list.find((a) => a.id === holder)?.label ?? "another account";
  return `${account.label ?? account.id} has no folder of its own and the main one holds ${other}. Make it the default in Settings › Accounts first.`;
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

/** The agents an account can be for. Claude accounts get a name and a folder
 *  each; Codex and Cursor sign in where their CLI keeps it, so one each. */
export const ACCOUNT_KINDS = [
  { kind: "claude", label: "Claude", cli: "claude" },
  { kind: "codex", label: "Codex", cli: "codex" },
  { kind: "cursor", label: "Cursor", cli: "cursor-agent" },
];

/** Adds an account to orcha's config.json (as orcha's add_to_config does) and
 *  opens its sign-in: Claude account `name`, or the one Codex or Cursor
 *  account. Null, or why it failed. */
export async function addAccount(name, kind = "claude") {
  const one = kind !== "claude" ? ACCOUNT_KINDS.find((k) => k.kind === kind) : null;
  const slug = accountSlug(name);
  if (!one && !slug) return "Give it a name, like personal or work.";
  const id = one ? kind : `claude-${slug}`;
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
  if (one) {
    if (list.some((a) => a?.kind === kind)) return `${one.label} is already an account: one per computer.`;
    list.push({ id, kind, label: one.label, email: "", dir: null });
  } else {
    if (list.some((a) => a?.id === id || a?.id?.replace(/^claude-/, "") === slug)) return `${id} is already an account.`;
    list.push({ id, kind: "claude", label: `Claude · ${slug}`, email: "", dir: `~/.ai-accounts/claude/${slug}` });
  }
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

/** The agent pane people are looking at, or null. */
export function focusedAgent() {
  const f = focused();
  if (!f?.pane) return null;
  const pane = panes().find((p) => p.pane === f.pane);
  if (!pane?.program?.agent) return null;
  const agent = agents().find((a) => a.pane === f.pane);
  return { pane: f.pane, terminal: agent?.address ?? f.terminal, cwd: pane.cwd || f.cwd, program: pane.program, title: agentTitle(agent, pane) ?? "" };
}

const sh = (script, ...args) => exec("sh", ["-c", script, "orcha", ...args]);

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
    const tail = (await readTerminal(from.terminal)).split("\n").slice(-300).join("\n");
    if (tail.trim()) lines.push("## The previous agent's screen", "", ...fence(tail.slice(-60000)));
  }
  return lines.join("\n");
}

// A Claude account's own folder, unless it is ~/.claude itself.
function claudeDir(account) {
  const dir = account.dir && expandHome(account.dir);
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
  const taken = account.kind === "claude" ? await mainFolderTaken(account, dir) : null;
  if (taken) return taken;
  if (dir) {
    await exec("python3", ["-I", LIMITS(), "link", account.id]);
    argv = ["env", `CLAUDE_CONFIG_DIR=${dir}`, ...argv];
  }
  run("pane.split", { direction: "right", pane: from.pane, argv });
  return null;
}

/** Same pane, same chat, the agent restarted on `account` (orcha's
 *  SwitchMode::Restart): stops Claude and continues the folder's latest
 *  conversation on the account. It needs the account in a folder of its own
 *  (restart_folder in actions.rs): its sign-in may be set aside. */
export async function restartOn(account) {
  const from = focusedAgent();
  if (!from?.terminal) return "Click into an agent first.";
  if (account.kind !== "claude" || !from.program?.key?.includes("claude")) return "Restarting on another account works from Claude to Claude.";
  const dir = claudeDir(account);
  const owner = await exec("python3", ["-I", LIMITS(), "whoami", dir ?? "-"]);
  const holder = owner.stdout.trim();
  if (holder !== account.id) {
    // Say who holds the folder and the way out, not just "no".
    const { list } = await readAccounts();
    const name = account.label ?? account.id;
    const other = list.find((a) => a.id === holder)?.label ?? "another account";
    if (!dir) return `${name} uses the main Claude folder (~/.claude), and ${other} is in it now. Make ${name} the default (Settings › Accounts), or keep this chat running on it.`;
    return `${name}'s folder holds ${other} now. Keep the chat running on ${name} instead.`;
  }
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
