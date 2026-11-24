; Hooks for the Windows installer (bundle > windows > nsis > installerHooks in tauri.conf.json).
;
; CaretFlow was called Folio until 0.5.0. The installer keys its folder, uninstall entry and
; shortcuts by the product name, so an update would put CaretFlow next to the old Folio instead of
; replacing it. These hooks remove an old Folio install and give CaretFlow the shortcuts Folio had.

Var FolioRemoved
Var FolioHadDesktopLink

; Before installing: remove Folio. Its uninstaller runs silently and keeps the app data (settings,
; recent files: they belong to the identifier, which didn't change). It must run before CaretFlow
; registers .md files, because it unregisters the same "Markdown" file type.
!macro NSIS_HOOK_PREINSTALL
  StrCpy $FolioRemoved 0
  StrCpy $FolioHadDesktopLink 0
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Folio" "Publisher"
  ReadRegStr $R1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Folio" "DisplayName"
  ${If} $R1 == "Folio"
  ${AndIf} $R0 == "folio" ; the publisher Tauri took from the identifier app.folio.markdown
  ${AndIf} ${FileExists} "$LOCALAPPDATA\Folio\uninstall.exe"
    DetailPrint "Removing Folio (now CaretFlow)"
    ${If} ${FileExists} "$DESKTOP\Folio.lnk"
      StrCpy $FolioHadDesktopLink 1
    ${EndIf}
    ; _?= runs the uninstaller in place, so ExecWait really waits for it
    ExecWait '"$LOCALAPPDATA\Folio\uninstall.exe" /S _?=$LOCALAPPDATA\Folio'
    Delete "$LOCALAPPDATA\Folio\uninstall.exe"
    RMDir "$LOCALAPPDATA\Folio"
    StrCpy $FolioRemoved 1
  ${EndIf}

  ; Up to 0.12.3 the publisher was "folio" (taken from the identifier), now it is "Sooeeren". The
  ; installer remembers a chosen install folder under Software\<publisher>\CaretFlow, so an update
  ; would not find it and install a second copy in the default folder. Carry the old one over.
  ReadRegStr $R0 HKCU "Software\folio\CaretFlow" ""
  ReadRegStr $R1 HKCU "${MANUPRODUCTKEY}" ""
  ${If} $R0 != ""
  ${AndIf} $R1 == ""
    ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    ${AndIf} ${FileExists} "$R0\${MAINBINARYNAME}.exe"
      StrCpy $INSTDIR $R0
      SetOutPath $INSTDIR
    ${EndIf}
    DeleteRegKey HKCU "Software\folio\CaretFlow"
    DeleteRegKey /ifempty HKCU "Software\folio"
  ${EndIf}
!macroend

; After installing: an in-app update runs the installer in update mode, which doesn't create
; shortcuts (it expects them to exist already), but Folio's were just removed with it.
!macro NSIS_HOOK_POSTINSTALL
  ${If} $FolioRemoved = 1
  ${AndIf} $UpdateMode = 1
    StrCpy $UpdateMode 0
    Call CreateOrUpdateStartMenuShortcut
    ${If} $FolioHadDesktopLink = 1
      Call CreateOrUpdateDesktopShortcut
    ${EndIf}
    StrCpy $UpdateMode 1
  ${EndIf}
!macroend
