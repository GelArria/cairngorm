# Managed by Cairngorm. Shared native session bridge for hook-based agents.
param([string]$Agent)
if ([string]::IsNullOrWhiteSpace($env:CAIRNGORM_SESSION_REPORT)) { exit 0 }

# Executable stem or Node package folder => reported agent.
$Commands = @{ claude = 'claude'; codex = 'codex'; gemini = 'gemini'; qwen = 'qwen'; copilot = 'copilot'; 'cursor-agent' = 'cursor'; grok = 'grok'; droid = 'droid' }
$Packages = [ordered]@{
    '[/\\]@anthropic-ai[/\\]claude-code[/\\]' = 'claude'
    '[/\\]@openai[/\\]codex[/\\]' = 'codex'
    '[/\\]@google[/\\]gemini-cli[/\\]' = 'gemini'
    '[/\\]@qwen-code[/\\]qwen-code[/\\]' = 'qwen'
    '[/\\]@github[/\\]copilot[/\\]' = 'copilot'
    '[/\\]cursor-agent[/\\]' = 'cursor'
    '[/\\]@xai-official[/\\]grok[/\\]' = 'grok'
}

function Use-Argv {
    if ('CairngormArgv' -as [type]) { return }
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class CairngormArgv {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr memory);
    public static string[] Parse(string command) {
        int count;
        IntPtr memory = CommandLineToArgvW(command, out count);
        if (memory == IntPtr.Zero) return new string[0];
        try {
            var args = new string[count];
            for (int i = 0; i < count; i++)
                args[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(memory, i * IntPtr.Size));
            return args;
        } finally { LocalFree(memory); }
    }
}
'@
}

# Agents import each other's hooks (Codex, Grok and Cursor run Claude's), so the hook's
# nearest agent ancestor decides which CLI owns the session, not the configured argument.
function Find-Agent {
    $fields = @('ProcessId', 'ParentProcessId', 'Name', 'CommandLine', 'CreationDate')
    $child = Get-CimInstance Win32_Process -Filter "ProcessId=$PID" -Property $fields
    for ($depth = 0; $depth -lt 10 -and $child; $depth++) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$([int]$child.ParentProcessId)" -Property $fields
        # A reused PID belongs to a process that started after its supposed child.
        if (-not $process -or $process.CreationDate -gt $child.CreationDate) { return }
        $stem = ([string]$process.Name -replace '\.[^.\\/]*$', '').ToLowerInvariant()
        if ($Commands.ContainsKey($stem)) {
            return @{ agent = $Commands[$stem]; command = [string]$process.CommandLine; start = 1 }
        }
        if ($stem -in @('node', 'bun') -and $process.CommandLine) {
            # The entry script is the first argument after runtime options such as --max-old-space-size.
            $entry = $null
            $start = 0
            try {
                Use-Argv
                $argv = [CairngormArgv]::Parse($process.CommandLine)
                for ($i = 1; $i -lt $argv.Count -and $argv[$i].StartsWith('-'); $i++) { }
                if ($i -lt $argv.Count) { $entry = $argv[$i]; $start = $i + 1 }
            } catch {
                # ConstrainedLanguage cannot compile the parser: take the same token with a regex.
                # Only that token is matched, so a prompt naming a package path cannot pose as an agent.
                if ($process.CommandLine -match '^\s*(?:"[^"]*"|\S+)(?:\s+(?:"-[^"]*"|-\S*))*\s+(?:"([^"]*)"|(\S+))') {
                    $entry = @($Matches[1], $Matches[2]) | Where-Object { $_ } | Select-Object -First 1
                }
            }
            if ($entry) {
                foreach ($pattern in $Packages.Keys) {
                    if ($entry -match $pattern) { return @{ agent = $Packages[$pattern]; command = [string]$process.CommandLine; start = $start } }
                }
            }
        }
        # Only the shells an agent runs hook commands through sit between it and this hook.
        if ($stem -notin @('cmd', 'powershell', 'pwsh', 'bash', 'sh', 'zsh', 'dash', 'fish', 'env')) { return }
        $child = $process
    }
}

# Launch flags carried over on resume (1 = takes a value); Cairngorm validates them again.
$LaunchFlags = @{
    cursor = @{ '--force' = 0; '-f' = 0; '--yolo' = 0; '--plan' = 0; '--mode' = 1; '--sandbox' = 1 }
    gemini = @{ '--yolo' = 0; '-y' = 0; '--approval-mode' = 1 }
    qwen = @{ '--yolo' = 0; '-y' = 0; '--approval-mode' = 1 }
}

function Get-LaunchFlags([string[]]$argv, [int]$start, [hashtable]$known) {
    $flags = @()
    for ($i = $start; $i -lt $argv.Count; $i++) {
        $arg = $argv[$i]
        if ($arg -ceq '--') { break }
        $name = $arg.Split('=')[0]
        if (-not ($known.Keys -ccontains $name)) { continue } # CLI flags are case-sensitive
        $flags += $arg
        if ($known[$name] -and -not $arg.Contains('=') -and $i + 1 -lt $argv.Count) { $flags += $argv[++$i] }
    }
    return , $flags
}

# SessionStart omits permission_mode in some Claude versions; read only the real CLI's argv.
function Get-ClaudeLaunchMode([string[]]$argv, [int]$start) {
    $mode = $null
    $values = @('--model', '--effort', '--agent', '--settings', '--name', '-n', '--session-id', '--system-prompt', '--append-system-prompt', '--system-prompt-file', '--append-system-prompt-file')
    for ($i = $start; $i -lt $argv.Count; $i++) {
        $arg = $argv[$i]
        if ($arg -ceq '--') { break }
        if ($arg -ceq '--dangerously-skip-permissions') { $mode = 'bypassPermissions' }
        elseif ($arg -ceq '--permission-mode' -and $i + 1 -lt $argv.Count) { $mode = $argv[++$i] }
        elseif ($arg.StartsWith('--permission-mode=')) { $mode = $arg.Substring(18) }
        elseif ($arg.Contains('=') -and $arg.Split('=')[0] -cin ($values + @('--resume', '-r'))) { continue }
        elseif ($arg -cin $values -and $i + 1 -lt $argv.Count) { $i++ }
        elseif ($arg -cin @('--resume', '-r')) {
            if ($i + 1 -lt $argv.Count -and -not $argv[$i + 1].StartsWith('-')) { $i++ }
        }
        elseif ($arg -cin @('--continue', '-c', '--allow-dangerously-skip-permissions', '--verbose')) { continue }
        else { return } # unknown argument roles must never infer extra permissions
    }
    return $mode
}

# Managed Windows can run this file in ConstrainedLanguage, which blocks .NET methods such as
# [Console]::In and [IO.File]. Reading, parsing and writing therefore use cmdlets only. Without
# Add-Type, Node/Bun agents are still identified by their entry script, but launch flags are not read.
# JSON is written as ASCII with \uXXXX escapes: valid UTF-8 without a byte-order mark.
function ConvertTo-AsciiJson($value) {
    $json = $value | ConvertTo-Json -Compress
    $chars = foreach ($c in $json.ToCharArray()) {
        if ([int]$c -gt 126) { '\u{0:x4}' -f [int]$c } else { [string]$c }
    }
    return -join $chars
}

try {
    $payload = (@($input) -join "`n") | ConvertFrom-Json
    $id = @($payload.session_id, $payload.sessionId, $payload.conversation_id) | Where-Object { $_ -is [string] -and $_ } | Select-Object -First 1
    if (-not $id) { exit 0 }
    if (-not [string]::IsNullOrWhiteSpace($payload.agent_id)) { exit 0 } # subagents never own the pane
    $cwd = $payload.cwd
    if (-not $cwd -and $payload.workspace_roots) { $cwd = @($payload.workspace_roots)[0] }

    $previous = $null
    if (Test-Path -LiteralPath $env:CAIRNGORM_SESSION_REPORT) {
        try { $previous = Get-Content -LiteralPath $env:CAIRNGORM_SESSION_REPORT -Raw -Encoding UTF8 | ConvertFrom-Json } catch { } # corrupt old metadata must not prevent a fresh report
    }
    $same = $previous -and $previous.id -ceq $id -and $Commands.ContainsValue([string]$previous.agent)
    $start = $payload.hook_event_name -eq 'SessionStart'
    $found = $null
    # A (re)started session can come from another CLI or other launch flags: inspect it again.
    if ($start -or -not $same) {
        try { $found = Find-Agent } catch { } # detection is best effort
    }
    # Print/headless runs (claude -p, codex exec, ...) never own the interactive pane.
    if ($found -and ($found.command -match '\s(-p|--print|--prompt)(\s|=|$)' -or ($found.agent -eq 'codex' -and $found.command -match '\sexec(\s|$)'))) { exit 0 }
    if ($found) { $agent = $found.agent }
    elseif ($same) { $agent = [string]$previous.agent }
    elseif ($Agent -eq 'claude' -and ($env:CURSOR_VERSION -or $payload.cursor_version)) { exit 0 }
    elseif ($Agent -eq 'cursor') { exit 0 } # Cursor's global hooks.json also runs in the IDE
    elseif ($Commands.ContainsValue($Agent)) { $agent = $Agent }
    else { exit 0 }

    $report = @{ agent = $agent; id = $id; cwd = $cwd }
    # Claude saves a conversation only after its first message: restore checks this file.
    if ($agent -eq 'claude' -and $payload.transcript_path -is [string] -and $payload.transcript_path) { $report.path = $payload.transcript_path }
    if ($LaunchFlags.ContainsKey($agent)) {
        $flags = @()
        if ($found) { try { Use-Argv; $flags = Get-LaunchFlags ([CairngormArgv]::Parse($found.command)) $found.start $LaunchFlags[$agent] } catch { } }
        elseif ($same -and $previous.flags) { $flags = @($previous.flags) }
        if ($flags.Count) { $report.flags = $flags }
    }
    $mode = $payload.permission_mode
    if (-not $mode) { $mode = $payload.permissionMode } # Grok's camelCase payload
    if (-not $mode -and $same -and $agent -in @('grok', 'codex')) { $mode = $previous.permission_mode }
    if ($agent -eq 'grok') {
        if ($mode -is [string] -and $mode -cin @('default', 'auto', 'plan', 'bypassPermissions')) { $report.permission_mode = $mode }
    } elseif ($agent -eq 'claude') {
        # shortcut: mode-only UI toggles have no hook; capture the next prompt/stop until Claude exposes one.
        if (-not $mode -and $start) {
            if ($found) { try { Use-Argv; $mode = Get-ClaudeLaunchMode ([CairngormArgv]::Parse($found.command)) $found.start } catch { } }
        } elseif (-not $mode -and $same) { $mode = $previous.permission_mode }
        if ($mode -is [string] -and $mode -cin @('default', 'manual', 'acceptEdits', 'plan', 'dontAsk', 'auto', 'bypassPermissions')) { $report.permission_mode = $mode }
    } elseif ($agent -eq 'codex' -and $mode -is [string] -and $mode -cin @('default', 'bypassPermissions')) {
        $report.permission_mode = $mode
    }
    $tmp = "$($env:CAIRNGORM_SESSION_REPORT).$PID.tmp"
    Set-Content -LiteralPath $tmp -Value (ConvertTo-AsciiJson $report) -Encoding Ascii -NoNewline
    Move-Item -LiteralPath $tmp -Destination $env:CAIRNGORM_SESSION_REPORT -Force
} catch { } # reporting cannot block an agent
