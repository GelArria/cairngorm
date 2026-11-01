# cairngorm.json

One settings file for what Cairngorm detects and how terminals start. It lives in Cairngorm's data
folder (Windows: `%APPDATA%\com.panelnative.app\cairngorm.json`; Settings ▸ General ▸ Settings file
shows the exact path and opens it). JSON with comments and trailing commas is accepted. Saving the
file (in Cairngorm or any editor) applies the change right away in every window.

`cairngorm.schema.json` is written next to it, so editors that understand `$schema` offer
completion and validation.

**Permissions are never read from this file.** File access and "always allow" for applications are
granted only in Cairngorm's dialogs, so a program that can edit the file cannot grant itself access.

```jsonc
{
  "$schema": "./cairngorm.schema.json",
  "shells": {
    "default": "Git Bash", // a shell's name, or a full { "name", "path", "args", "env" }
    "hide": ["Command Prompt"],
    "add": [{ "name": "Node REPL", "path": "node", "args": ["-i"] }],
  },
  "agentClis": {
    "hide": ["amp"], // by name or id
    "add": [{ "name": "My agent", "program": "my-agent", "args": ["--tui"] }],
  },
  "applications": {
    "hide": ["onenote"], // ids from cairngorm_list_apps
    "add": [
      {
        "id": "photoshop",
        "name": "Photoshop",
        "progId": "Photoshop.Application",
        "executable": "C:/Program Files/Adobe/Photoshop/Photoshop.exe",
      },
    ],
  },
  "launchProfiles": [],
  "terminal": { "clipboard": "windows", "scrollback": 3000 },
  "documents": { "openWith": { "xlsx": "app.cairngorm.spreadsheet" } },
}
```

- An application added here never reuses another one's approval: it cannot take the id of a
  detected application (even a hidden one), must name an absolute program outside the Windows folder,
  and agents must be allowed to control it separately (the dialog says "(from cairngorm.json)"). If
  its ProgID or program changes, Cairngorm asks again.
- `shells.default` is the program every new terminal starts, like a shell profile: treat edits to it
  with the same care.
- Detection keeps working; `hide` and `add` adjust it. `applications` also changes what agents see in
  `cairngorm_list_apps`.
- The Settings screens write to the same file and keep your comments.
- The first time, the main window creates the file from the settings this machine already had
  (default shell, launch profiles, terminal options and "open with" choices). Deleting it later
  creates an empty one.
- Every save re-reads the file first, so windows and external editors never overwrite each other.
  While the file has a syntax error, the Settings screens do not save.
- A syntax error keeps the last valid settings in use and is shown in Settings ▸ General.

Implementation: `src/config/` (native `config/native/config.rs`: read, atomic write, schema, change
watcher; frontend `config/data/config-store.ts`: snapshot, comment-preserving edits with
`jsonc-parser`, loaded lazily). Consumers: `terminal/data/terminal-preferences.ts`,
`terminal/data/configured-shells.ts`, `terminal/data/cli-launch.ts`,
`documents/data/provider-preferences.ts`, `plugins/native/plugin_app_discovery.rs`.
