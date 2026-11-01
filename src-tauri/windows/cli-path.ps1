# Adds or removes the folder of the `cairngorm` command in the user's PATH. Run by the
# installer hooks: `cli-path.ps1 add|remove <folder>`. Entries such as %USERPROFILE% stay
# unexpanded and every other entry is kept in order.
param(
    [Parameter(Mandatory)][ValidateSet('add', 'remove')][string]$Action,
    [Parameter(Mandatory)][string]$Folder
)
$ErrorActionPreference = 'Stop'

$folder = $Folder.TrimEnd('\')
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
try {
    $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $entries = @($current -split ';' | Where-Object { $_ -ne '' })
    $others = @($entries | Where-Object { $_.TrimEnd('\') -ne $folder })
    $next = if ($Action -eq 'add') { @($others) + $folder } else { $others }
    $value = $next -join ';'
    if ($value -eq ($entries -join ';')) {
        exit 0
    }
    $kind = if ($key.GetValueNames() -contains 'Path') { $key.GetValueKind('Path') } else { 'ExpandString' }
    if ($value) {
        $key.SetValue('Path', $value, $kind)
    } else {
        $key.DeleteValue('Path', $false)
    }
} finally {
    $key.Dispose()
}

# Tell Explorer and new terminals that the environment changed.
Add-Type -Namespace Cairngorm -Name Environment -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint msg,
    System.UIntPtr wParam, string lParam, uint flags, uint timeout, out System.UIntPtr result);
'@
$result = [System.UIntPtr]::Zero
[void][Cairngorm.Environment]::SendMessageTimeout([System.IntPtr]0xffff, 0x1a, [System.UIntPtr]::Zero, 'Environment', 2, 5000, [ref]$result)
