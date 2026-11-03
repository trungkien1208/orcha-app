# orcha for Herdr 🐋🍵

orcha's cockpit for the [Herdr desktop app](https://github.com/herdrdev/herdr-app). You get your projects in a sidebar, every agent's state at a glance, fuel for each account, and git on the side.

**This is not an app of its own.** It's a skin plus a plugin for Herdr. Herdr is the app you open; orcha-app changes how it looks and adds orcha's panels. Think of a phone (Herdr) and a case with extra buttons (orcha-app).

## How the pieces fit

| Piece | What it does | Need it? |
| --- | --- | --- |
| **Herdr app** (`herdr-app`) | The window. Draws everything, runs your terminals and agents. | Yes |
| **orcha-app** (this repo) | orcha's layout, themes and one mod, copied into Herdr's config folder. | Yes |
| **orcha** in the terminal ([repo](https://github.com/trungkien1208/orcha)) | Keeps your accounts and fuel. | Only for FUEL and ACCOUNTS |

Nothing in Herdr gets changed or forked. Herdr keeps updating itself, and orcha keeps working on top.

## Install

You need `curl` and `python3` (both come with macOS).

**1. Install Herdr** (skip if you have it):

```sh
curl -fsSL https://releases.herdr.dev/app/install.sh | sh
```

**2. Install orcha's look:**

```sh
curl -fsSL https://raw.githubusercontent.com/trungkien1208/orcha-app/HEAD/install.sh | sh
```

**3. Switch Herdr to orcha.** Open Herdr, press `⌘⇧P` (command palette), type `layout.switch`, pick **orcha**.

That's it. You should see the projects on the left, PROCESS at the bottom left and FUEL on the right. If you don't, see [Something looks wrong](#something-looks-wrong).

**Optional:** install the terminal [orcha](https://github.com/trungkien1208/orcha) too if you want FUEL and account switching.

## A quick tour

```
┌──────────────┬───────────────────────────┬──────────────┐
│ + NEW   ☰    │  tabs                     │ INFO | FILES │
│              ├───────────────────────────┤ FUEL         │
│ PROJECTS     │                           │ branch       │
│  🍵 my-app   │   your agents and         │ changes      │
│   └ agent    │   terminals               │ history      │
│  🚀 api      │                           │ worktrees    │
│              │                           │              │
│ PROCESS      │                           │              │
│ OPUS ●━🚂○─🏁 │                           │              │
├──────────────┴───────────────────────────┴──────────────┤
│ status bar: how the open agent is doing                 │
└─────────────────────────────────────────────────────────┘
```

- **Projects** (left): each project with its icon (click it to pick one of ~150 emoji by group or by word, or paste any emoji), its branch and how its agents are doing. The open project shows a card for each agent: what it's working on, its model, how long it has been going, and how much context and memory it uses (green is fine, yellow is getting full, red means trouble).
- **PROCESS** (bottom left): every working agent is a little train. More on that [below](#process-the-trains).
- **Right panel**, two tabs on top:
  - **INFO**: FUEL (how much each account has left; click it to open ACCOUNTS), the current branch with buttons to open your editor or Git app, what changed, recent commits and worktrees (extra copies of the project on other branches).
  - **FILES**: the files of the folder you're in, and a search box over the whole project (by NAME, or TEXT inside the files). Click a file and it opens in a viewer beside your work; the viewer is reused while it stays open. Clicking a changed file in INFO opens this tab too.
- **Header**: how many projects and agents (the red "needs you" blinks), a search box that opens FIND, and buttons for the command palette (`⌘⇧P`), ACCOUNTS and Settings.
- **FIND**, like in a code editor:

  | Keys | Finds |
  | --- | --- |
  | `⌘O` | a file of the project by name (type a few letters, `↵` opens it) |
  | `⌘⇧F` | text inside the project's files; the viewer lists the lines that hold it |
  | `⌘F` | text in the pane you're in: a terminal's history, or the file the viewer shows |
  | `⌘L` | links and file paths the pane printed, newest first |

  `Tab` switches between them. `⌘P` stays Herdr's terminal picker.
- **Open what agents print.** `⌘L` lists the web addresses and file paths in the pane; `↵` opens one: a page in your browser, a folder in Finder, a picture, PDF or document in its app, code in the viewer (at its line, for `file.rs:42`). Or select a path, right-click and pick **Open**. A path that isn't where it says is looked for in the project. To open a file type in your editor instead, set it in orcha's `config.toml`:

  ```toml
  [orcha.open_with]
  md = "editor"          # cursor, code or zed, at the line
  png = "system"         # the system's app
  log = "folder"         # show it in Finder
  rs = "editor:zed {path}:$L"
  ```
- **Tabs and title bars** take the agent's color: Claude yellow, Codex green, Cursor blue, a plain shell teal. The open tab joins its title bar like a folder; each tab shows its agent's icon and a dot for its state. The title bar says the model, the state and for how long, and the context used.
- **Right-click** a project or a pane to open, rename, split, zoom or close it; right-click inside a terminal to open the selected path or link, list the pane's links, split or zoom.
- **Settings** (`⌘,` or the gear in the header): Herdr's own settings, with orcha's on top: working rules and skills per project (one tab per project), accounts, hand-off, and which panels to show.
- **Themes**: Brutal, Matcha and Ocean, each in light and dark. Pick one in Settings › Look.

### PROCESS: the trains

Each agent that's working gets its own line with four stops:

| Stop | The agent is... |
| --- | --- |
| **THINK** | reading files, searching, planning |
| **CODE** | editing files or running commands |
| **TEST** | running tests, linters or type checks |
| **DONE** | finished |

The train runs between the stop it reached and the next one, puffing smoke, and the next stop blinks. When the agent moves on, the train glides to the next stretch. At DONE it parks under the checkered flag. Click a train to jump to that agent. When an agent stops working, its train goes back to the depot. You can hide PROCESS in Settings.

## Accounts and hand-off

orcha keeps several accounts (say, a personal and a work Claude plan) and shows how much fuel each one has left. Open **ACCOUNTS** from the header or by clicking FUEL.

- **USE** makes that Claude account the one every Claude chat uses. Running chats move to it within half a minute, no restart.
- **HAND OFF** moves the chat you're looking at to that account, or to another agent (Codex, Cursor). The new agent opens beside the old one with short notes (what the work is, git state, where the old chat is), sums up where things stand and waits for your go. Claude to Claude asks how: keep running, restart, or a new pane.
- **ADD ACCOUNT** (or `a`): give it a name, then sign in in the pane that opens. Its chats, settings and skills are shared with your other accounts.
- **SIGN IN** shows on an account orcha can't read fuel for yet.

**Settings › Hand-off** puts three marks on the fuel bar of the account in use:

| Under this mark | orcha... |
| --- | --- |
| Checklist | asks the agent in front of you to write what's done and what's next to `.orcha/handoff.md` |
| Offer | shows a note offering to switch to the account with the most fuel |
| Auto | moves the chat to that account by itself, once the agent is between turns |

Checklist and Auto are off until you set them. These settings are shared with orcha in the terminal; if both are open, turn on Auto in one of them only.

## Update

Run the install command from step 2 again. It only replaces orcha's own files.

## Uninstall

```sh
cd ~/.config/herdr-app
rm -rf layouts/orcha.json themes/orcha-*.json mods/orcha
```

Then switch Herdr back to another layout (`⌘⇧P` → `layout.switch`). The installer also added a `layout:orcha` entry to `keys.json` (for `⌘,`); it does nothing once the layout is gone, so you can leave it or delete it.

## Something looks wrong

- **Herdr looks the same after installing.** You're still on another layout. `⌘⇧P` → `layout.switch` → **orcha**.
- **FUEL and ACCOUNTS are empty.** They come from the terminal [orcha](https://github.com/trungkien1208/orcha): install it, then add an account in ACCOUNTS.
- **A panel shows an error or stays blank.** Run `herdr-app check ~/.config/herdr-app/mods/orcha`. It tells you what broke. Then [open an issue](https://github.com/trungkien1208/orcha-app/issues) with that output.
- **Two Claude chats show the same model and context.** Known: those numbers come from the newest Claude chat in the agent's folder, so chats in the same folder share them.
- **Agents are gone after a reboot.** Herdr opens fresh shells after a restart; it doesn't bring agents back (yet).
- **Switched accounts but a chat still uses the old one.** USE moves Claude chats that use the main sign-in; a chat started on a specific account stays there. Use HAND OFF to move it.

<details>
<summary><b>Where the installer writes</b></summary>

Everything goes into `~/.config/herdr-app` (or `$HERDR_APP_HOME` if set):

- `layouts/orcha.json`: where every panel sits.
- `themes/orcha-*.json`: the six themes.
- `mods/orcha/`: the mod that draws orcha's panels.
- `keys.json`: `⌘,` (settings), `⌘O`, `⌘⇧F`, `⌘F` and `⌘L` (FIND), only while the orcha layout is on.
- `settings.json`: sets Matcha as the theme, only if you haven't picked one yet.

Herdr's own files and yours are left alone. Herdr picks up the changes live, no restart needed.

</details>

<details>
<summary><b>For contributors</b></summary>

- `mods/orcha/` is the mod. `main.js` picks the part a layout block asks for (`header`, `left`, `tabs`, `pane`, `panel`, `status`) or a popup (`settings`, `accounts`, `menu`, `icon`). `ui.js` holds the look.
- `mods/orcha/catalog.js` is generated from orcha's `src/orcha_rules.rs`: run `python3 gen-catalog.py` (or `python3 gen-catalog.py ../orcha` for a local checkout) after orcha's rules or skills change.
- `mods/orcha/settings.js` starts from Herdr's own settings page; compare it with a new Herdr's `frame/settings/main.js` when Herdr updates.
- Animate with Herdr's native `.loop`, `.transition` and `.frames`, not timers: every redraw repaints the whole window.
- Test loop: `sh install.sh`, then `herdr-app check ~/.config/herdr-app/mods/orcha`, then `herdr-app shot shot.png` to see the window (keep it visible, a hidden window keeps an old frame).

</details>

## License

Apache-2.0. See [NOTICE](NOTICE) for the parts that come from Herdr and Phosphor Icons.
