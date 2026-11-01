# Real clicks (SetCursorPos + mouse_event) on the Cairngorm window.
# Usage: powershell -File tests/manual/windows/click.ps1 -AppPid <pid> -X <x> -Y <y> [-X2 <x> -Y2 <y>]
#   X,Y only        -> click
#   with X2,Y2      -> drag from (X,Y) to (X2,Y2), window-relative coords
param([uint32]$AppPid, [int]$X, [int]$Y, [int]$X2 = -1, [int]$Y2 = -1, [switch]$Middle, [switch]$Double)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class MPC {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  public static void Click(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(150); mouse_event(2,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(80); mouse_event(4,0,0,0,UIntPtr.Zero); }
  public static void MiddleClick(int x, int y) { SetCursorPos(x, y); System.Threading.Thread.Sleep(150); mouse_event(32,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(80); mouse_event(64,0,0,0,UIntPtr.Zero); }
  public static void DoubleClick(int x, int y) { Click(x, y); System.Threading.Thread.Sleep(100); Click(x, y); }
  public static void Drag(int x1, int y1, int x2, int y2) { SetCursorPos(x1,y1); System.Threading.Thread.Sleep(150); mouse_event(2,0,0,0,UIntPtr.Zero); System.Threading.Thread.Sleep(120); for (int i=1;i<=20;i++){ SetCursorPos(x1+(x2-x1)*i/20, y1+(y2-y1)*i/20); System.Threading.Thread.Sleep(30);} System.Threading.Thread.Sleep(150); mouse_event(4,0,0,0,UIntPtr.Zero); }
}
"@
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public class WR {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public struct RECT { public int L, T, R, B; }
  public static RECT MainRect(uint t) { RECT o = new RECT(); EnumWindows((h,l)=>{ uint p; GetWindowThreadProcessId(h,out p); if (p==t){ var s=new StringBuilder(64); GetWindowText(h,s,64); if (s.ToString()=="Cairngorm"){ GetWindowRect(h,out o); return false; } } return true; }, IntPtr.Zero); return o; }
}
"@
$r = [WR]::MainRect($AppPid)
if ($X2 -ge 0) { [MPC]::Drag($r.L + $X, $r.T + $Y, $r.L + $X2, $r.T + $Y2); Write-Output ("drag " + $X + "," + $Y + " -> " + $X2 + "," + $Y2) }
elseif ($Middle) { [MPC]::MiddleClick($r.L + $X, $r.T + $Y); Write-Output ("middle " + $X + "," + $Y) }
elseif ($Double) { [MPC]::DoubleClick($r.L + $X, $r.T + $Y); Write-Output ("double " + $X + "," + $Y) }
else { [MPC]::Click($r.L + $X, $r.T + $Y); Write-Output ("click " + $X + "," + $Y) }
