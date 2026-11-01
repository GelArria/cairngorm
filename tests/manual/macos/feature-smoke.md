# macOS feature smoke

Run on a real Mac in a disposable OS user account or separately identified QA app with
its own app-data directory. Never close the Cairngorm that hosts an active agent or the
owner's terminals. A successful `.dmg` build is not evidence these features work.
Record the macOS/app/CLI versions, time, expected/actual result and artifact paths for
**each** step; mark unavailable apps/agents skipped, not passed. Keep screenshots under
`logs/e2e/` and redact conversations, paths and credentials before sharing.

| Check | Action and expected evidence |
| --- | --- |
| Native terminal | Open a terminal in the app; run `printf 'SMOKE %s\n' ok`. Capture the rendered `SMOKE ok`, not just the command text. Repeat in each installed bash/zsh/fish shell. |
| CLI exit | Start an installed agent, exit it normally, then run `echo shell-still-here` in the same pane. The original shell must remain usable. |
| Fresh and used session | In a scratch project, open one unused Claude/Pi pane and one pane with a harmless message. With explicit owner permission, close **only the QA instance**, reopen it, and check fresh startup versus the same saved conversation and permission mode. Never auto-trust changed hooks. |
| Claude quota relay | With Python 3 available, let Claude answer a harmless message. Check the quota card and that an existing status line still prints. Do not record raw keys or message contents. |
| Fresh MCP file flow | In the disposable account, approve Connect agents, restart the chosen CLI, request a blank workbook in a scratch project, approve first file use, and verify the provider renders it beside the terminal. Denying must create nothing. |
| Storage and upgrade | Back up a disposable old-profile database before upgrading; confirm projects/tabs/layout survive. If intentionally locking storage, verify the header warning is visible without shifting layout. Never fault-inject the owner's database. |
| OSA automation | Pick a harmless installed scriptable app, explicitly approve a read-only script, check output, then deny another request and confirm no script runs. For a deliberate modal/timeout case, record the returned stop reason and whether the test-started app remains running; never assume a dialog was dismissed. |
| Layout | Capture 2x2, three stacked and after-close layouts at normal and narrow widths; inspect gaps, clipping and native transparency. Windows baselines are not a macOS reference. |

Record remaining failures and skips in a local test report under `logs/`. Scheduled agent runs are disabled
outside Windows by design, so do not report an unavailable macOS scheduler as passed.
