# orcha for Herdr 🐋🍵

orcha's cockpit, as a look for the [Herdr desktop app](https://github.com/herdrdev/herdr-app): your projects in a sidebar, every agent's state at a glance, fuel for each account, and git on the side. No fork of Herdr: just a layout, a few themes and one mod, so Herdr keeps updating itself and orcha keeps working.

## Install

Install Herdr first if you don't have it:

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

Then orcha's look:

```sh
curl -fsSL https://raw.githubusercontent.com/trungkien1208/orcha-app/HEAD/install.sh | sh
```

In Herdr, open the command palette (`⌘⇧P`), run `layout.switch` and pick **orcha**. Run the installer again to update.

## What you get

- **Projects** in the sidebar, each with its icon (click it to pick one), its branch and how its agents are doing. The open project is a card with an agent card per agent: what it works on, its model, how long it has been at it, and its context and RAM, green, yellow or red.
- **PROCESS** at the foot of the sidebar: every running agent is a train on a line of four stations, THINK → CODE → TEST → DONE.
- **The right panel**: FUEL (click it for ACCOUNTS), the branch with buttons for your IDE and Git app, what changed, history and worktrees.
- **Pane title bars** in the agent's color (Claude yellow, Codex green, Cursor blue), and a status bar that says how the open agent is doing.
- **Right-click** a project or a pane to open, rename, split, zoom or close it.
- **Settings** (`⌘,` or the button in the header): Herdr's own settings with orcha's on top: working rules and skills for each project, accounts, and the panels.
- **Themes**: orcha's Brutal, Matcha and Ocean, light and dark. Pick one in Settings › Look.

FUEL, ACCOUNTS and switching accounts use the terminal [orcha](https://github.com/trungkien1208/orcha)'s accounts and fuel. Without orcha installed, everything else works and those two stay empty.

## Good to know

- Model and context are read from the newest Claude conversation in the agent's folder, so two Claude chats in the same folder can show the same numbers.
- Herdr starts fresh shells after a reboot; it does not bring agents back.
- Switching accounts applies to new Claude chats.

## For contributors

- `mods/orcha/` is the mod: `main.js` picks the part a layout block asks for (`header`, `left`, `tabs`, `pane`, `panel`, `status`) or a popup (`settings`, `accounts`, `menu`, `icon`). `ui.js` holds the look.
- `mods/orcha/catalog.js` is generated from orcha's `src/orcha_rules.rs`: run `python3 gen-catalog.py` (or `python3 gen-catalog.py ../orcha` for a local checkout) after orcha's rules or skills change.
- `mods/orcha/settings.js` starts from Herdr's own settings page; compare it with a new Herdr's `frame/settings/main.js` when Herdr updates.
- Check a change with `herdr-app check ~/.config/herdr-app/mods/orcha` after `sh install.sh`.

## License

Apache-2.0. See [NOTICE](NOTICE) for the parts that come from Herdr and Lucide.
