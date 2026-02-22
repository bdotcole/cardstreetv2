@echo off
set JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr
set ANDROID_HOME=C:\Users\brand\AppData\Local\Android\Sdk
set PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%PATH%

echo === Cleaning and Building Debug APK ===
cd /d "C:\Users\brand\Downloads\cardstreet-tcg\android"
call gradlew.bat clean assembleDebug

if errorlevel 1 (
    echo BUILD FAILED
    pause
    exit /b 1
)

echo.
echo === Finding APK ===
dir /s /b "C:\Users\brand\Downloads\cardstreet-tcg\android\app\build\*.apk"

echo.
echo === Copying APK to Desktop for easy access ===
for /r "C:\Users\brand\Downloads\cardstreet-tcg\android\app\build" %%f in (app-debug.apk) do (
    copy "%%f" "C:\Users\brand\Downloads\CardStreet.apk" /Y
    echo Copied to: C:\Users\brand\Downloads\CardStreet.apk
)

echo.
echo === Installing via ADB (if device connected) ===
"%ANDROID_HOME%\platform-tools\adb.exe" devices
"%ANDROID_HOME%\platform-tools\adb.exe" install -r "C:\Users\brand\Downloads\CardStreet.apk"

echo.
echo === Done! ===
pause
