# Cairngorm status line relay for Claude Code. Claude Code passes its subscription limits
# (rate_limits) to the status line; this saves them for Cairngorm's usage display, then
# runs the user's previous status line command, if any, with the same input.
$ErrorActionPreference = "SilentlyContinue"
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$raw = [Console]::In.ReadToEnd().TrimStart([char]0xFEFF)
$hooksDir = Split-Path -Parent $PSCommandPath
$claudeDir = Split-Path -Parent $hooksDir

# Claude Code also redraws the status line for /clear, /usage and mode changes, passing
# the last limits that session saw, which can be older than what another session saved.
# Usage only grows within a window, so an older window, or a lower percentage in the same
# window, keeps the saved one. Windows of the same period reset within minutes of each other.
# A saved reading older than an hour always gives way, so a shifted or wrong reset time can
# never hold the display.
function Test-Current($saved, $new, $fresh) {
    if (-not ($new -is [System.Management.Automation.PSCustomObject])) { return $false }
    try {
        if (-not $fresh -or -not $saved -or $null -eq $saved.resets_at -or $null -eq $new.resets_at) {
            return $true
        }
        $gap = [double]$new.resets_at - [double]$saved.resets_at
        if ($gap -lt -1800) { return $false }
        if ($gap -le 1800 -and [double]$new.used_percentage -lt [double]$saved.used_percentage) {
            return $false
        }
    } catch {}
    return $true
}

try {
    $limits = ($raw | ConvertFrom-Json).rate_limits
    if ($limits -and ($limits.five_hour -or $limits.seven_day)) {
        $path = Join-Path $claudeDir "cairngorm-usage.json"
        $saved = $null
        try { $saved = [System.IO.File]::ReadAllText($path, $utf8) | ConvertFrom-Json } catch {}
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $fresh = $false
        try { $fresh = $saved -and ($now - [double]$saved.updatedAt) -lt 3600 } catch {}
        $newFive = Test-Current $saved.fiveHour $limits.five_hour $fresh
        $newSeven = Test-Current $saved.sevenDay $limits.seven_day $fresh
        $fiveHour = if ($newFive) { $limits.five_hour } else { $saved.fiveHour }
        $sevenDay = if ($newSeven) { $limits.seven_day } else { $saved.sevenDay }
        if ($newFive -or $newSeven) {
            $usage = [ordered]@{
                updatedAt = $now
                fiveHour  = $fiveHour
                sevenDay  = $sevenDay
            } | ConvertTo-Json -Compress -Depth 4
            # A temporary file per process, so two sessions saving at once do not collide.
            # Two sessions can still both pass the check; the next redraw corrects that.
            $temp = "$path.$PID.tmp"
            try {
                [System.IO.File]::WriteAllText($temp, $usage, $utf8)
                Move-Item -Force -LiteralPath $temp -Destination $path -ErrorAction Stop
            } catch {
                Remove-Item -Force -LiteralPath $temp -ErrorAction SilentlyContinue
            }
        }
    }
} catch {}

# Runs the previous status line the way Claude Code would: through Git Bash when it is
# installed, else PowerShell. The guard stops a relay that ends up chained to itself.
function Quote-Argument([string]$text) {
    '"' + (($text -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}
function Find-GitBash {
    $candidates = @(
        $env:CLAUDE_CODE_GIT_BASH_PATH,
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    )
    foreach ($path in $candidates) {
        if ($path -and (Test-Path -LiteralPath $path)) { return $path }
    }
    $found = Get-Command bash.exe -All -ErrorAction SilentlyContinue |
        Where-Object { $_.Source -match "\\Git\\" } | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
}

$chain = Join-Path $hooksDir "cairngorm-statusline.chain"
if (-not $env:CAIRNGORM_STATUSLINE -and (Test-Path -LiteralPath $chain)) {
    $command = [System.IO.File]::ReadAllText($chain, $utf8).Trim()
    if ($command) {
        try {
            $env:CAIRNGORM_STATUSLINE = "1"
            $info = New-Object System.Diagnostics.ProcessStartInfo
            $bash = Find-GitBash
            if ($bash) {
                $info.FileName = $bash
                $info.Arguments = "-c " + (Quote-Argument $command)
            } else {
                $info.FileName = "powershell.exe"
                $info.Arguments = "-NoProfile -Command " + (Quote-Argument $command)
            }
            $info.UseShellExecute = $false
            $info.RedirectStandardInput = $true
            $info.RedirectStandardOutput = $true
            $info.StandardOutputEncoding = $utf8
            $process = [System.Diagnostics.Process]::Start($info)
            $output = $process.StandardOutput.ReadToEndAsync()
            $process.StandardInput.Write($raw)
            $process.StandardInput.Close()
            if ($process.WaitForExit(10000)) {
                [Console]::Out.Write($output.Result)
            } else {
                & taskkill.exe /T /F /PID $process.Id 2>&1 | Out-Null
            }
        } catch {}
    }
}
