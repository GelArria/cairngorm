# Repository instructions

## Scope and ownership

- Organize `src/` by feature; keep each feature's Rust in its `native/` folder.
- Read [architecture](docs/architecture.md) before moving files, changing module
  responsibilities or build paths. Follow [coding conventions](docs/coding-conventions.md).
- App owns startup and cross-feature coordination. Projects own project state; calendar
  receives project scope explicitly and app supplies its lifecycle callbacks.
- Use focused public entry points across features and direct implementation imports within
  a feature. Preserve lazy imports, singleton ownership, IPC names and hot-path behavior.
- Reuse existing shadcn components. Keep files near 200 lines when responsibilities permit;
  avoid splitting cohesive logic merely to reach a line count.
- Write first-party code, comments, documentation, UI copy and test descriptions in English.
  Preserve legacy contract/migration values and Unicode encoding fixtures.

## Verification

- Use [tests/README.md](tests/README.md) to choose the runner and platform prerequisites.
- Prefer TesterArmy `e2e` for new browser-flow tests; preserve existing regression suites.
- Keep frontend tests under `tests/unit/` or `tests/e2e/`, Rust tests under `tests/native/`.
  Sidecar tests and terminal hook internal tests remain with their packages.
- Always give Playwright an explicit config, such as `tests/playwright.config.ts`.
- Keep generated diagnostics under `logs/` and screenshots/artifacts under `logs/e2e/`.
- Use the repository formatting commands and verify the affected module's behavior.
- For UI changes, capture the result, have an image specialist analyze it, and verify
  functionality rather than relying only on a screenshot.
- When the task is complete, run exactly one foreground `reviewer` subagent. Do the rest
  of the work directly; do not delegate implementation or exploration.

## Development safety

Read [development and debugging](docs/development.md) before launching or debugging the
native app. A running Cairngorm may host the user's terminal; ask before closing it.
Avoid concurrent native instances sharing the same app data or gateway.
Local agent settings, temporary plans and reference checkouts are ignored, not deliverables.

## Finding reference implementations

Search the local implementation first, then available local reference checkouts, the
project wiki, dependency sources, library documentation and finally the web.
The ignored `references/` folder is optional and is not a build dependency.

When building agent features, study these files if the Pi checkout is available:

| Concern                      | Reference                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Agent loop and events        | `references/pi/packages/agent/src/agent-loop.ts`, `types.ts`, `agent.ts`      |
| Terminal rendering and input | `references/pi/packages/tui/src/tui.ts`, `terminal.ts`, `editor-component.ts` |
| CLI integration              | `references/pi/packages/coding-agent/src/`                                    |
| Provider API                 | `references/pi/packages/ai/`                                                  |
| Native terminal widgets      | `references/ratatui/ratatui-widgets/`, `ratatui-core/`                        |

Use the existing agent loop's steering, follow-up queues and event contracts rather than
introducing a second orchestration path. Preserve differential TUI rendering and input
behavior when changing terminal integration.
