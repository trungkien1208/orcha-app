// orcha's accounts and their fuel, read from orcha's own files (config.json
// and the limits cache), and the two actions on them, run through orcha's
// extras (`limits.py`). Shared by ACCOUNTS and Settings › Accounts.

import { readTextFile, exec, home } from "herdr";

const LIMITS = () => `${home()}/.orcha/scripts/limits.py`;

async function readJson(path) {
  try {
    const text = await readTextFile(path);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** Every account with its cached limits, and the Claude account in use. */
export async function readAccounts() {
  const config = await readJson(`${home()}/.config/orcha/config.json`);
  const active = (await readTextFile(`${home()}/.config/orcha/claude-active`))?.trim() ?? null;
  const list = [];
  for (const account of config?.accounts ?? []) {
    list.push({ ...account, limits: (await readJson(`${home()}/.cache/orcha/limits/${account.id}.json`)) ?? {} });
  }
  return { list, active };
}

/** Makes `id` the Claude account every new chat uses. Null, or why it failed. */
export async function activateAccount(id) {
  const r = await exec("python3", ["-I", LIMITS(), "activate", id]);
  return r.code === 0 ? null : (r.stderr || r.stdout || "limits.py failed").trim().split("\n").pop();
}

/** Reads every account's fuel again (network), into the cache. */
export async function refreshFuel() {
  await exec("python3", ["-I", LIMITS(), "json"]);
}
