cd /d C:\Users\SHAINE~1\Desktop\BLUEWRITE\blotter-app
C:\Users\SHAINE~1\flutter\bin\flutter.bat --version > build-position.log 2>&1
rmdir /s /q build >> build-position.log 2>&1
rmdir /s /q android\.gradle >> build-position.log 2>&1
C:\Users\SHAINE~1\flutter\bin\flutter.bat build apk --release >> build-position.log 2>&1
