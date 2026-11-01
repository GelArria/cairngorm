; The `cairngorm` terminal command is installed as $INSTDIR\bin\cairngorm.exe, and that
; folder is added to the user's PATH so every new terminal finds it. An update keeps it.
!macro NSIS_HOOK_POSTINSTALL
  Push $0
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" add "$INSTDIR\bin"'
  Pop $0
  ${If} $0 != 0
    DetailPrint "Could not add the cairngorm command to PATH ($0). Add $INSTDIR\bin yourself."
  ${EndIf}
  Pop $0
!macroend

; Uninstalling Cairngorm with "Delete app data" checked also removes what it wrote into other
; agents' configurations (session hooks, session plugins, the Claude Code status line relay and
; MCP bridge entries). An upgrade runs the old uninstaller too, so a plain uninstall, an update
; and a reinstall keep them; Settings > Plugins removes them on request.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$INSTDIR\cli-path.ps1"
    Push $0
    nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\cli-path.ps1" remove "$INSTDIR\bin"'
    Pop $0
    Pop $0
  ${EndIf}
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIf} ${FileExists} "$INSTDIR\${MAINBINARYNAME}.exe"
    ; Never edit settings a running Cairngorm owns; this asks the user to close it first.
    !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --remove-agent-integrations'
  ${EndIf}
!macroend
