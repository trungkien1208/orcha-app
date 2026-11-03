// orcha's config.toml (shared with orcha in the terminal): one table read or
// one `key = value` line written at a time; the rest of the file is kept as
// it is. Enough TOML for orcha's flat settings, not a full parser.

import { readTextFile, writeTextFile, home } from "herdr";

const TOML = () => `${home()}/.config/orcha/config.toml`;

// Where [name] starts and ends in `lines`, or null.
function section(lines, name) {
  const head = new RegExp(`^\\s*\\[${name.replace(/\./g, "\\.")}\\]\\s*(#.*)?$`);
  const start = lines.findIndex((l) => head.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function parseValue(raw) {
  const v = raw.replace(/\s+#.*$/, "").trim();
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (/^-?\d+$/.test(v)) return Number(v);
  if (v === "true" || v === "false") return v === "true";
  return v;
}

const tomlValue = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);

/** Every `key = value` of table `name` ("orcha", "orcha.open_with"). */
export async function readTable(name) {
  const lines = ((await readTextFile(TOML())) ?? "").split("\n");
  const out = {};
  const at = section(lines, name);
  if (!at) return out;
  for (const line of lines.slice(at.start + 1, at.end)) {
    const m = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (m) out[m[1]] = parseValue(m[2]);
  }
  return out;
}

/** Sets `key` in table `name`, adding the table if needed. Null, or why not. */
export async function writeKey(name, key, value) {
  const before = await readTextFile(TOML());
  const lines = (before ?? "").split("\n");
  const line = `${key} = ${tomlValue(value)}`;
  const at = section(lines, name);
  if (!at) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(`[${name}]`, line, "");
  } else {
    const i = lines.slice(at.start + 1, at.end).findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (i >= 0) lines[at.start + 1 + i] = line;
    else {
      // After the table's last setting, before its trailing blank lines.
      let end = at.end;
      while (end > at.start + 1 && lines[end - 1].trim() === "") end -= 1;
      lines.splice(end, 0, line);
    }
  }
  try {
    await writeTextFile(TOML(), lines.join("\n"), before);
    return null;
  } catch {
    return "config.toml changed meanwhile. Try again.";
  }
}
