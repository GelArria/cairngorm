# Native regression probe: capture visible console windows, including brief flashes.
param([string]$Ready, [string]$Stop, [string]$Out)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class ConsoleProbe {
  public delegate void EventProc(IntPtr hook, uint ev, IntPtr hwnd, int obj, int child, uint thread, uint time);
  public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, EventProc callback, uint process, uint thread, uint flags);
  [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
  [DllImport("user32.dll")] static extern int GetClassName(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr data);
  static HashSet<IntPtr> baseline = new HashSet<IntPtr>();
  public static List<string> Flashes = new List<string>();
  static EventProc callback;
  static IntPtr hook;
  public static void Start() {
    EnumWindows((hwnd, data) => { baseline.Add(hwnd); return true; }, IntPtr.Zero);
    callback = (h, ev, hwnd, obj, child, thread, time) => {
      if (obj != 0 || child != 0 || baseline.Contains(hwnd) || !IsWindowVisible(hwnd)) return;
      var cls = new StringBuilder(256); GetClassName(hwnd, cls, cls.Capacity);
      if (cls.ToString() != "ConsoleWindowClass" && cls.ToString() != "CASCADIA_HOSTING_WINDOW_CLASS") return;
      var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
      Flashes.Add(cls + ": " + title);
    };
    hook = SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, callback, 0, 0, 0);
    if (hook == IntPtr.Zero) throw new Exception("SetWinEventHook failed");
  }
  public static void Stop() { UnhookWinEvent(hook); GC.KeepAlive(callback); }
}
'@
[ConsoleProbe]::Start()
Set-Content -Path $Ready -Value 'ready'
$deadline = (Get-Date).AddSeconds(60)
try {
  while (!(Test-Path $Stop) -and (Get-Date) -lt $deadline) {
    [System.Windows.Forms.Application]::DoEvents()
    Start-Sleep -Milliseconds 5
  }
} finally {
  [ConsoleProbe]::Stop()
  ConvertTo-Json -InputObject @([ConsoleProbe]::Flashes) -Compress | Set-Content -Path $Out
}
if (!(Test-Path $Stop)) {
  Write-Error 'Console probe timed out before the test finished'
  exit 1
}
