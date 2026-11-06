// Where Orcherd keeps its own files: apart from the terminal orcha, so each
// works without the other. Settings and accounts in ~/.config/orcherd, fuel
// and hand-off notes in ~/.cache/orcherd, the scripts in this mod's bin/.

import { home, appHome, exec } from "herdr";

/** ~/.config/orcherd/<name>: config.json (accounts), config.toml (settings), claude-active, … */
export const configFile = (name) => `${home()}/.config/orcherd/${name}`;
/** ~/.cache/orcherd/<name>: limits/ (fuel), handoff/ (notes). */
export const cacheFile = (name) => `${home()}/.cache/orcherd/${name}`;
/** Makes ~/.config/orcherd (only you can read it), before a file is first written there. */
export const makeConfigDir = () => exec("mkdir", ["-p", "-m", "700", configFile("")]);
/** A script that ships with this mod (bin/accounts.py, bin/open-in.sh). */
export const script = (name) => `${appHome()}/mods/orcha/bin/${name}`;
