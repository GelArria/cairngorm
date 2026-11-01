# Cairngorm security baseline

Cairngorm is a single-user desktop application. The operating-system account
is its identity and permission boundary. It does not provide organization
accounts, SSO, RBAC, a central audit service, or compliance certification.

## Credentials and process launches

- Saved API keys live in Windows Credential Manager, macOS Keychain, or Linux
  Secret Service. The JSON configuration contains an opaque apiKeyRef.
- Existing plaintext apiKey values migrate when native configuration is read.
  Migration creates no plaintext backup. If the vault is locked or unavailable,
  the operation fails and preserves the original file; unlock the vault to retry.
- Environment-based credentials remain supported. Standalone CLI use requires
  the configured environment variable; vault resolution belongs to the desktop app.
- get_agent_env exposes readiness and provider metadata, never the API key.
  Rust resolves the secret immediately before spawning the validated sidecar
  executable. Restoring or detaching an agent does not serialize its credential.
- Provider keys are removed from tool child environments. A process running
  under the same OS account can still inspect another process; this is not
  protection against a compromised local account.
- Changing provider, endpoint, or credential variable clears the saved key.
  Connection tests require the same target and provider before reusing a key.
  HTTP redirects are disabled in provider probes, Git summaries, and agent requests.
- Configuration saves use unique private temporary files and atomic replacement.
  Existing integration configuration retains its separate original backup.

## Provider transports

HTTP, HTTPS, WS and WSS endpoints are accepted. Plaintext transports remain
available for local or internal gateways; choose encrypted transport when needed.
URLs cannot contain userinfo, query parameters, or fragments. Authentication
uses a credential header rather than a URL.

HTTP(S) providers use the OpenAI-compatible Chat Completions API. The WebSocket
adapter connects to the exact configured URL and sends one JSON Chat Completions
request per connection. A compatible gateway returns JSON ChatCompletionChunk
objects (including finish_reason), then [DONE] or closes the socket. Headers
include Authorization: Bearer with the configured credential. This contract is
not the OpenAI Realtime/Responses protocol; those require a separate adapter.
Cancellation, deadlines, response limits and TLS verification apply to WS/WSS.
The Settings /models probe and AI commit drafts currently require HTTP(S).

### Proxies and extra certificates for native requests

Native requests (the Settings provider check, AI commit drafts, remote plugin MCP
and sign-in, update checks and downloads) read these variables from Cairngorm's
environment when it starts. Set them as user environment variables, then restart
Cairngorm. System proxy settings (Windows Internet Options, PAC/WPAD, macOS network
settings) are not read.

- `http_proxy`/`HTTP_PROXY` serve `http://` requests; `https_proxy`/`HTTPS_PROXY`
  serve `https://` requests through a CONNECT tunnel. An HTTPS request never uses
  the HTTP variable. `all_proxy`/`ALL_PROXY` is the fallback for both. On macOS
  and Linux the lowercase name wins when both cases are set; Windows treats both
  spellings as one variable. Empty values count as unset.
- Inside the CONNECT tunnel the request line carries the full URL
  (`GET https://host/path`), which HTTP/1.1 servers must accept (RFC 9112 §3.2.2).
- The proxy must be `http://[user:password@]host[:port]` (port 80 by default;
  percent-encode special characters in credentials). HTTPS and SOCKS proxies and
  IPv6 proxy addresses are not supported; such a value fails the request with
  an error naming the variable, never its value. Credentials are sent only with
  CONNECT, so a proxy that requires them works for `https://` requests only.
- `no_proxy`/`NO_PROXY` (lowercase wins) lists hosts reached directly, separated
  by commas or spaces: `*` for every host, a name for itself and its subdomains
  (`example.com`, `.example.com` and `*.example.com` are equivalent), an IP
  address or a CIDR range such as `10.0.0.0/8` or `fd00::/8`. Ports in entries are
  ignored. Names are not resolved, so list `localhost` and `127.0.0.1` separately.
  An invalid range (including a bracketed one such as `[fd00::]/8`) fails every
  proxied request with an error rather than being ignored.
- The route is chosen for the first address of each request; a redirect to
  another host (such as a GitHub release download) keeps that route.
- `NODE_EXTRA_CA_CERTS` names a PEM file of additional root certificates, added to
  the bundled Mozilla roots that native requests trust. Certificate chain and host
  name checks are unchanged. A missing or unreadable file, or one without a valid
  certificate, fails every native request with an error naming the variable.
  Node.js reads the same variable, and agent CLIs inherit it from Cairngorm.
  `SSL_CERT_FILE`, `SSL_CERT_DIR` and the Windows certificate store are not read
  by native requests.

## Native BYOK agent

The Cairngorm agent's file tools are scoped to its starting project folder. They
reject paths outside it, credential files, repository metadata, symbolic links,
hard links and special files. Recursive search skips protected entries. Starting
at a disk root, home folder or credential directory is rejected.

Shell execution is off by default. A user can explicitly add allowShell: true
to ~/.panel/agent/config.json for a trusted project workflow. This gives the
agent command execution with that user's permissions. Even with a filtered
environment, an unrestricted shell can read files, call local services and use
the network. The file checks are application-level containment and do not
replace an OS sandbox against concurrent local filesystem changes. Installed
third-party agent CLIs retain their own approval and sandbox policies.

## Renderer and plugin boundaries

- Production CSP restricts scripts, connections, frames and object loading;
  development has a separate CSP for Vite and local test tools.
- On Windows, a native navigation guard keeps `main` and `detached-*` webviews
  on the application origin (or the configured development origin). External
  HTTP(S) links, including PDF links targeting the top window, are cancelled
  inside Cairngorm and opened in the system browser. Other schemes, embedded
  credentials and links over 8 KiB are blocked. Browser preview child webviews
  retain their own navigation policy. Ordinary application anchors and terminal
  links (including OSC 8) use the shell opener rather than `window.open`;
  OSC 8 links retain their destination-confirmation prompt.
  The native guard is Windows-only: WRY's WebKit navigation callback also sees
  iframe loads, so enabling the same policy there would break document/plugin
  frames. macOS/Linux need a frame-aware native guard.
- CDP is absent from release configuration. Debug builds require
  PANEL_REMOTE_DEBUGGING=1 and bind the debugger to loopback.
- Shell-plugin process spawn, stdin-write and kill permissions are removed.
  The native PTY commands remain privileged application functionality.
- Plugin servers are catalogued external services. Enabled plugin inputs and
  results may leave the machine. Views run in isolated sandboxed iframes;
  plugin and preview origins cannot invoke application commands directly.
- The MCP gateway binds to loopback, requires a per-process bearer secret for
  agent calls and rejects browser Origin headers. Unix discovery files are
  private; Windows uses the user's app-data ACLs.

## Git in project folders

Cairngorm runs Git when a project opens and on every refresh, without a click.
Git can execute commands from a folder's own `.git` even for a plain status or
history listing: `core.fsmonitor`, filter and diff drivers, the
`post-index-change` hook, signature checks through `gpg.program`, and the same
settings inside submodules. A clone never copies `.git/config` or hooks, but an
extracted archive or a shared folder can carry them. Every Git call therefore:

- passes `-c core.fsmonitor=false -c log.showSignature=false` (command-line
  settings beat repository config);
- sets `GIT_OPTIONAL_LOCKS=0`, so status does not rewrite the index and no
  index hook runs;
- adds `--ignore-submodules=all` to status and diff, so submodule config is
  never used;
- first reads the repository's local and worktree config (reading runs nothing)
  and refuses to run Git there if a `filter.*.clean|smudge|process` (standard
  Git LFS values excepted), `diff.external`, `diff.*.textconv|command` or a
  command-valued `core.fsmonitor` is set. The Git view names the key. The check
  also refuses when the config cannot be read (Git older than 2.26).

Global and system config belong to the user and are not checked. Operations the
user starts (commit, pull, push, switch, cherry-pick, revert) run the
repository's hooks and keys such as `core.sshCommand`, `credential.helper` and
commit signing, as Git does in a terminal.

## Agent tools and consent

Any agent CLI connected to the MCP bridge can call Cairngorm's tools from a live
Cairngorm terminal that has a project. Each grant below states what it covers,
how far it reaches and how to take it back.

- **File tools** (list, read, create, open, document operations) work inside the
  calling terminal's project folder, checked by canonical path. The first use
  from a terminal asks: "Allow for this terminal" covers that terminal session;
  "Always allow in all projects" lets agents in every project use their own
  project's files without asking. Paths outside the project need a separate
  per-file or per-folder approval, every save is approved in the document's pane,
  and create never overwrites. Settings ▸ Plugins ▸ File access sets Ask first,
  Always or Off.
- **Application scripts** run PowerShell (Windows COM) or JavaScript for
  Automation (macOS) through an installed application. A script runs with the
  user's account permissions and is not limited to that application: this grant
  means "run commands as you". The first use asks per terminal; "Always allow in
  this project" covers that application for agents in that one project only, and
  other projects and applications ask separately. Global grants from earlier
  builds are no longer honored, so their next use asks again. Settings ▸ Plugins
  lists each grant with its project and an "Ask again" action.
- **Prompt injection.** Agents read untrusted text: project files, web pages and
  results from remote plugins (for example Notion pages or Linear issues). Text
  that steers an agent can make it call any tool the user has already allowed,
  including a script through an application with an "Always" grant. Agents whose
  own shell is restricted but whose MCP tools are allowed gain command execution
  through such a grant. Keep "Always" for trusted projects, and leave tool
  approvals on in each CLI. Each catalog plugin says that its service receives
  what agents send to it and that its replies are untrusted.
- **Scheduled runs** start the Cairngorm agent or the integrated Codex adapter
  without a person watching, on the project folder, with network, web search,
  hooks, apps and remote plugins off for Codex, writes confined to the workspace
  sandbox and a 30-minute limit. They cannot use Cairngorm's MCP tools, which
  need a live terminal. A project file can still steer a run. For Git projects,
  the last result lists the files the run changed; review them before relying on
  the result.

## What Cairngorm writes into other tools

Cairngorm edits other agents' configuration files only by adding its own entries;
every other entry is kept, an unreadable file is reported and never rewritten,
and the first edit of a file keeps a `.cairngorm-backup` copy beside it.

- **Session hooks** in installed agent CLIs (Claude Code, Codex, Gemini, Qwen,
  Droid, Cursor, Copilot, Grok) plus session plugins for Pi and OpenCode report
  each conversation so it can be resumed after a restart. They are added when a
  terminal starts and exit at once outside a Cairngorm terminal. On Windows the
  hook uses only cmdlets for reading and writing, so it also reports under
  PowerShell ConstrainedLanguage (tested by setting that mode inside a
  disposable process, not under a real WDAC/AppLocker policy). There it cannot
  compile its command-line parser: it still identifies the CLI from its program
  name or Node/Bun entry script, but does not read launch flags, so only the
  permission mode the CLI sends is kept.
- **Claude Code status line relay** saves subscription limits for the usage
  display and still runs the user's previous status line command.
- **MCP bridge entry** (`cairngorm`) is added only after the user chooses
  Connect agents in Settings ▸ Plugins.

Settings ▸ Plugins ▸ Cairngorm in agent configs ▸ "Remove Cairngorm from agent
configs" removes all of these, restores the previous status line, and records
the choice so Cairngorm does not add the hooks back until "Add session hooks
back" is chosen. The Windows uninstaller runs the same removal when "Delete app
data" is checked (never during an update or reinstall). Entries that point to another install, or another server with the same
name, are left alone.

## Restored permission modes

Agent tabs restored after a restart reopen the same conversation in the
permission mode the user last chose, including modes that skip approvals:
`--dangerously-skip-permissions` (Claude Code),
`--dangerously-bypass-approvals-and-sandbox` (Codex), `--yolo` or
`--approval-mode yolo` (Gemini, Qwen), `--force` (Cursor) and
`--permission-mode bypassPermissions` (Grok). Session reports are data: only
known flags with known values become arguments, IDs are restricted to safe
characters and values are quoted. A launch profile's own permission flags win.
A tab whose launch command turns approvals off shows a shield icon and says so
in its tooltip; an agent started by hand inside a shell is not detected.

## Data retention

Set deployment environment variables before starting the application:

| Variable                      | Default | Behavior                                                                                      |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------- |
| CAIRNGORM_PERSIST_SCROLLBACK  | 1       | Set to 0 to delete persisted terminal history and renderer crash records and stop new writes. |
| CAIRNGORM_RETENTION_DAYS      | 7       | History and diagnostic retention; integer from 1 to 365 days.                                 |
| CAIRNGORM_ENABLE_MEMORY_DUMPS | 0       | Set to 1 to explicitly permit watchdog memory dumps.                                          |

Expired history and renderer crash records are deleted on startup or access.
Native diagnostic cleanup runs when hang diagnostics are saved. Native files
use the OS user configuration directory: `%APPDATA%/Cairngorm/logs` on Windows,
`$XDG_CONFIG_HOME/Cairngorm/logs` (normally `~/.config/Cairngorm/logs`) on Linux,
and `~/Library/Application Support/Cairngorm/logs` on macOS. Unix directories
are private (0700), JSON files use 0600, and unavailable storage never falls
back to the project directory. Existing local databases and backups are not
cryptographically erased; protect them with the machine's disk encryption and
backup policy. History is not encrypted by Cairngorm and may include secrets
printed by CLIs. In-memory replay exists only for the current application session.
Diagnostics remain local and can contain paths, stack traces and application
metadata. A memory dump can contain arbitrary process memory.

## Distribution and verification

The security workflow audits production npm dependencies and Cargo advisories.
The build workflow emits frontend, sidecar and native CycloneDX inventories
and SHA256SUMS. These are generated from actual build artifacts; CI still needs
to run to produce release evidence. The current workflow does not generate
GitHub build-provenance attestations.

Tagged Windows builds require WINDOWS_CERTIFICATE_BASE64 and
WINDOWS_CERTIFICATE_PASSWORD repository secrets. The PFX must contain a code
signing private key; Tauri signs and timestamps the bundle using it. Tagged
macOS builds require APPLE_CERTIFICATE, APPLE_CERTIFICATE_PASSWORD,
APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD and APPLE_TEAM_ID for signing
and notarization. Certificates and Apple credentials must be supplied by the
project owner. The workflow fails when required signing credentials are absent.
Linux artifacts use checksums; repository/package signing and
a signed auto-update channel are separate deployment work.

Deploy as a standard user with a patched WebView runtime. Organizations should
approve provider/plugin destinations, enforce endpoint and network controls,
and validate release evidence before installation. SSO, central policy/audit,
and OS-level sandboxing for the BYOK engine remain architectural extensions,
not features implied by this baseline.
