!macro customInstall
  WriteRegStr SHCTX "Software\Classes\teamspace-app" "" "URL:Team Space"
  WriteRegStr SHCTX "Software\Classes\teamspace-app" "URL Protocol" ""
  WriteRegStr SHCTX "Software\Classes\teamspace-app\DefaultIcon" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\",0'
  WriteRegStr SHCTX "Software\Classes\teamspace-app\shell\open\command" "" '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" -- $\"%1$\"'
!macroend

!macro customUnInstall
  ReadRegStr $0 SHCTX "Software\Classes\teamspace-app\shell\open\command" ""
  StrCmp $0 '$\"$INSTDIR\${APP_EXECUTABLE_FILENAME}$\" -- $\"%1$\"' 0 +2
    DeleteRegKey SHCTX "Software\Classes\teamspace-app"
!macroend

