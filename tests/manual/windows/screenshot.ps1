# Screenshot of the main Cairngorm window by PID (PrintWindow, no CDP).
# Captures the window content even if it is behind other windows.
# Usage: powershell -File tests/manual/windows/screenshot.ps1 <pid> <output-path.png>
param([uint32]$AppPid, [string]$Out)
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WR2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public static IntPtr Hwnd(uint t) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if (p==t && IsWindowVisible(h)){ var s=new StringBuilder(64); GetWindowText(h,s,64); if (s.ToString()=="Cairngorm"){ found=h; return false; } } return true; }, IntPtr.Zero);
    return found;
  }
}
"@
$hwnd = [WR2]::Hwnd($AppPid)
if ($hwnd -eq [IntPtr]::Zero) { Write-Output "FAIL: window not found"; exit 1 }
[WR2]::ShowWindow($hwnd, 9) | Out-Null   # SW_RESTORE if minimized
Start-Sleep -Milliseconds 250
$r = New-Object WR2+RECT
[WR2]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$w = $r.R - $r.L; $h2 = $r.B - $r.T
if ($w -le 0 -or $h2 -le 0) { Write-Output "FAIL: empty window bounds"; exit 1 }
$bmp = New-Object System.Drawing.Bitmap($w, $h2)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [WR2]::PrintWindow($hwnd, $hdc, 2)   # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$g.Dispose()
if (-not $ok) { $bmp.Dispose(); Write-Output "FAIL PrintWindow"; exit 1 }
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "SHOT $Out ${w}x${h2} rect=$($r.L),$($r.T)"
