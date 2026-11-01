# Runs in a child scope: the shell left open after the CLI keeps the user's own settings.
& {
$ErrorActionPreference = 'Stop'
# PowerShell 5's native argument binder drops empty strings and embedded quotes.
Add-Type -TypeDefinition @'
using System;
using System.Linq;
using System.Text;
public static class CairngormArgv {
    public static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char ch in value) {
            if (ch == '\\') { slashes++; continue; }
            if (ch == '"') { result.Append('\\', slashes * 2 + 1); }
            else { result.Append('\\', slashes); }
            result.Append(ch); slashes = 0;
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    public static string Join(string[] values) { return String.Join(" ", values.Select(Quote)); }
}
'@
$launch = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = [string]$launch.program
$info.Arguments = [CairngormArgv]::Join([string[]]$launch.args)
$info.UseShellExecute = $false
$process = [Diagnostics.Process]::Start($info)
try { $process.WaitForExit(); $global:LASTEXITCODE = $process.ExitCode }
finally { $process.Dispose() }
}
