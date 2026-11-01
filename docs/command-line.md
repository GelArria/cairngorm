# The `cairngorm` command

Terminals opened in Cairngorm always find the `cairngorm` command. For your other
terminals:

- **Windows:** the installer adds it to your user PATH, so it works in PowerShell,
  Command Prompt, Git Bash and Windows Terminal opened after the install.
- **Linux (deb, rpm):** the packages install the app itself as `/usr/bin/cairngorm`.
  Started from a terminal, a first instance stays attached to it.
- **Linux (AppImage):** Cairngorm keeps a `cairngorm` link to the AppImage in
  `~/.local/share/Cairngorm/bin`. Add that folder to PATH in your shell profile:
  `export PATH="$PATH:$HOME/.local/share/Cairngorm/bin"`.
- **macOS:** the command ships inside the app as `Cairngorm.app/Contents/MacOS/cairngorm-cli`,
  and Cairngorm keeps a `cairngorm` link to it in `~/Library/Application Support/Cairngorm/bin`.
  Add that folder to PATH in `~/.zprofile`:
  `export PATH="$PATH:$HOME/Library/Application Support/Cairngorm/bin"`.

The links are refreshed whenever Cairngorm starts, so they follow the app when it moves
or updates.

```text
cairngorm                   Open Cairngorm, or bring it to the front
cairngorm .                 Open this folder as a project
cairngorm notes.md          Open a file in the editor, inside its project
cairngorm -a claude         Start Claude Code in this folder
cairngorm ~/app -t --git    Open a project with a new terminal and the Git panel
```

| Option                           | What it does                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `[path]`                         | A folder opens as a project; a file opens in the editor                                                       |
| `-t`, `--terminal`               | Opens a new terminal in the folder (the current folder when no path)                                          |
| `-a`, `--agent <cli>`            | Starts an installed agent CLI there: `claude`, `codex`, `gemini`, `pi`, `opencode` or any CLI in the New menu |
| `--files`, `--git`, `--calendar` | Shows that panel                                                                                              |
| `--settings[=page]`              | Opens Settings, for example `--settings=providers` or `--settings=plugins`                                    |
| `-v`, `--version`                | Prints the version                                                                                            |
| `-h`, `--help`                   | Prints the help                                                                                               |

A path inside a project you already have opens in that project, so `cairngorm .` from any
of its subfolders returns to it. Any other folder becomes a new project with a terminal,
or with just the agent when you pass `--agent`; a file outside your projects makes its
folder a new project. When Cairngorm is already running, the request goes to the open
window instead of starting a second app.

The command only opens what you name: it never runs other commands, and `--agent`
accepts only CLIs Cairngorm has detected or that you added yourself. Agents in your
terminals can run it too, with the same reach as the shell they already have.

Uninstalling Cairngorm removes the folder from PATH; an update keeps it. Development
builds do not put the command on their terminals' PATH. To point the command at another
build, set `CAIRNGORM_APP` to that app's executable.
