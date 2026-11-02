<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/media/gem-dark.svg">
    <img src="docs/media/gem-light.svg" width="96" alt="Cairngorm gem">
  </picture>
</p>

<h1 align="center">Cairngorm</h1>

<p align="center">
  <strong>Your coding agents, terminals, files and Git.<br>One desktop workspace.</strong>
</p>

<p align="center">
  <a href="https://cairngorm.dev">Website</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#get-started">Get started</a> ·
  <a href="docs/development.md#contributing">Contribute</a>
</p>

<p align="center"><sub>Development build · Windows, macOS &amp; Linux · MIT licensed</sub></p>

![Cairngorm with Claude Code, Codex CLI and Oh My Pi beside the code editor](docs/media/workspace.png)

<p align="center"><sub>A workspace demo with local sample replies, from <a href="https://cairngorm.dev">cairngorm.dev</a>.</sub></p>

## Get started

**Bring your agents.** Run Pi, Claude Code, Codex, Gemini CLI, OpenCode or another
installed CLI. Your tools keep their own configuration and sign-ins; no Cairngorm account
required. An optional built-in agent connects to your own model provider.

**Run from source.** Follow the [development setup](docs/development.md#toolchain) for
prerequisites, installation and launch commands. This repository contains a development
build; feature availability varies by OS.

**Open a project from your terminal.** Once the `cairngorm` command is installed:

```sh
cairngorm .
cairngorm -a claude
```

See the [command-line guide](docs/command-line.md) for more options.

## Inside the workspace

| Workflow                    | What you can do                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agents, terminals & Git** | Split terminals, detach windows and keep each project's files, editor and Git changes close by.                                                                                                                                   |
| **Desktop applications**    | Ask a connected agent to build a chart in Excel or edit a Word document through the installed app's automation API. On Windows, the app docks beside the terminal. You approve each application's first use.                      |
| **Documents**               | Open spreadsheets beside the agent and watch it read and edit the workbook. Saves include a version check and a backup; [document providers](docs/document-providers.md) add file types.                                          |
| **Diagrams & whiteboards**  | Open tldraw, Excalidraw, draw.io and Mermaid as interactive panes. One MCP plugin catalog serves your agent CLIs and other connected MCP clients.                                                                                 |
| **Browser tests**           | Follow live Playwright pages in Chromium, Firefox and WebKit, pause on a frame and keep the last screenshot. A separate [test browser](docs/test-browser.md) lets you explore without touching the run.                           |
| **Scheduled work**          | Schedule prompts for Codex, Gemini CLI or the built-in agent and see the files changed in Git projects. Close the window while an agent works; it keeps running in the background, and sessions return when you reopen Cairngorm. |
| **Subscription usage**      | Check the 5-hour and weekly limits of Codex and Claude Code without spending a request. Claude Code limits appear after its first answer.                                                                                         |

## Platform support

Cairngorm targets Windows, macOS and Linux, with different application-integration capabilities:

- **Windows:** installed application windows can dock in workspace panes; scheduled agent execution is available.
- **macOS:** agents drive scriptable applications in their own windows.
- **Linux:** application integration uses applications that ship an MCP server.

Application docking and scheduled agent execution currently require Windows. Model-provider
usage is billed separately. See [Security](docs/security.md) for permissions and platform limits.

## Documentation & contributing

[Settings](docs/settings-file.md) · [Architecture](docs/architecture.md) ·
[Development](docs/development.md) · [Tests](tests/README.md) ·
[Reporting a vulnerability](SECURITY.md)

Contributions are welcome. Read the [contribution guide](docs/development.md#contributing)
and [coding conventions](docs/coding-conventions.md) before opening a change.

Cairngorm is released under the [MIT License](LICENSE). Third-party components keep their
own licenses; see [licenses/](licenses/).
