#!/bin/sh
# orcha for the Herdr desktop app: copies orcha's layout, themes and mods
# into Herdr's config folder. Herdr picks them up live.
#
#   curl -fsSL https://raw.githubusercontent.com/trungkien1208/orcha-app/HEAD/install.sh | sh
#   sh install.sh          (from a clone)
#
# Run it again to update. Only orcha's own files are written
# (layouts/orcha.json and its preview, themes/orcha-*, mods/orcha*), plus orcha's keys for the
# orcha layout in keys.json (Cmd+, Cmd+O Cmd+Shift+F Cmd+F Cmd+L Cmd+W Cmd+Shift+W) and orcha's
# colors when no theme is picked yet; Herdr's shipped files and your own are
# left alone.
set -eu

REPO="trungkien1208/orcha-app"
src=$(cd "$(dirname "$0")" 2>/dev/null && pwd || true)
fetched=
cleanup_fetch() { [ -z "$fetched" ] || rm -rf "$fetched"; }
trap cleanup_fetch EXIT
if [ -z "$src" ] || [ ! -d "$src/mods/orcha" ]; then
  # Piped from curl: fetch this repository's current files.
  command -v curl >/dev/null 2>&1 || { echo "orcha-app needs curl"; exit 1; }
  fetched=$(mktemp -d)
  curl -fsSL "https://codeload.github.com/$REPO/tar.gz/HEAD" | tar -xz -C "$fetched"
  src=$(find "$fetched" -mindepth 1 -maxdepth 1 -type d | head -n 1)
  [ -d "$src/mods/orcha" ] || { echo "the download did not contain orcha's mods"; exit 1; }
fi
dest=${HERDR_APP_HOME:-${XDG_CONFIG_HOME:-$HOME/.config}/herdr-app}

mkdir -p "$dest/layouts" "$dest/themes" "$dest/mods"
cp "$src/layouts/orcha.json" "$dest/layouts/orcha.json"
cp "$src/layouts/orcha.svg" "$dest/layouts/orcha.svg"
for old in "$dest"/themes/orcha-*.json; do
  [ -e "$old" ] || continue
  [ -e "$src/themes/$(basename "$old")" ] || rm -f "$old"
done
cp "$src"/themes/orcha-*.json "$dest/themes/"
# Staged outside mods/, so Herdr never sees a half-copied mod folder.
stage=$(mktemp -d "$dest/.orcha-install.XXXXXX")
trap 'rm -rf "$stage"; cleanup_fetch' EXIT
# orcha's mods that this version no longer has go first.
for old in "$dest"/mods/orcha*; do
  [ -e "$old" ] || continue
  [ -d "$src/mods/$(basename "$old")" ] || rm -rf "$old"
done
for mod in "$src"/mods/orcha*; do
  name=$(basename "$mod")
  cp -R "$mod" "$stage/$name"
  # Move the old copy aside before deleting it: Herdr may write into a mod
  # folder (jsconfig.json) while it is being removed.
  [ ! -e "$dest/mods/$name" ] || mv "$dest/mods/$name" "$stage/$name.old"
  mv "$stage/$name" "$dest/mods/$name"
done
# Cmd+, opens orcha's settings and Cmd+O / Cmd+Shift+F / Cmd+F / Cmd+L open FIND
# while the orcha layout shows, and orcha's
# colors are the theme unless the person already picked one (Settings › Look).
python3 -I - "$dest" <<'PY'
import json, os, sys

def update(path, change):
    try:
        with open(path) as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        data = {}
    if not change(data):
        return
    tmp = path + ".orcha-tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, path)

def bind(keys):
    mine = keys.setdefault("layout:orcha", {})
    mine["cmd-,"] = "orcha.settings"
    # FIND: a file by name, text in the project, text in the pane, links.
    mine["cmd-o"] = "orcha.find-file"
    mine["cmd-shift-f"] = "orcha.find-text"
    mine["cmd-f"] = "orcha.find-pane"
    mine["cmd-l"] = "orcha.find-link"
    # Cmd+W / Cmd+Shift+W on a project's last tab or pane close the project without asking.
    mine["cmd-w"] = "orcha.close-tab"
    mine["cmd-shift-w"] = "orcha.close-pane"
    return True

def colors(person):
    if "theme" in person:
        return False
    person["theme"] = {"light": "orcha-matcha", "dark": "orcha-matcha-dark"}
    return True

home = sys.argv[1]
update(os.path.join(home, "keys.json"), bind)
update(os.path.join(home, "settings.json"), colors)
PY
command -v herdr-app >/dev/null 2>&1 || [ -x "$HOME/.local/bin/herdr-app" ] ||
  echo "Herdr is not installed yet: curl -fsSL https://releases.herdr.dev/app/install.sh | sh"
echo "orcha installed into $dest. In Herdr: command palette (Cmd+Shift+P) → layout.switch → orcha"
