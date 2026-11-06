#!/bin/sh
# Opens a folder's project (its git root, else the folder) in an app: the
# first IDE or Git app installed on this Mac. Orcherd's ⌘E / ⌘G.
#   open-in.sh ide|git <folder>
dir=${2:-$PWD}
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || root=$dir
# a folder named like an option stays a folder for `open`
case $root in /*) ;; *) root=./$root ;; esac
case $1 in
  ide) apps="Cursor|Visual Studio Code|Windsurf|Zed|IntelliJ IDEA|WebStorm|PyCharm|Xcode" ;;
  git) apps="Fork|Sourcetree|GitHub Desktop|Tower|GitKraken" ;;
  *) echo "usage: open-in.sh ide|git <folder>" >&2; exit 2 ;;
esac
IFS='|'
for app in $apps; do
  for d in /Applications "$HOME/Applications" /Applications/Setapp; do
    [ -d "$d/$app.app" ] && exec open -a "$d/$app.app" "$root"
  done
done
echo "No $1 app found: install one of $(echo "$apps" | sed 's/|/, /g')." >&2
exit 1
