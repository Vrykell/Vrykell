!include "${__FILEDIR__}\generated\installer-translations.nsh"
!macro NSIS_HOOK_PREUNINSTALL
  ${If} ${FileExists} "$INSTDIR\windows-context-menu\manage.ps1"
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\windows-context-menu\manage.ps1" -Action disable -AssetDirectory "$INSTDIR\windows-context-menu" -Executable "$INSTDIR\vrykell.exe"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      MessageBox MB_ICONSTOP "$(ContextMenuUnregisterError)"
      Abort
    ${EndIf}
  ${EndIf}
!macroend
