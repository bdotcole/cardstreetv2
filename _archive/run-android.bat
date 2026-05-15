@echo off
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "PATH=%JAVA_HOME%\bin;%ANDROID_HOME%\platform-tools;%ANDROID_HOME%\emulator;%PATH%"

echo === Environment Set ===
echo JAVA_HOME=%JAVA_HOME%
echo ANDROID_HOME=%ANDROID_HOME%

echo.
echo === Starting Emulator ===
start "" "%ANDROID_HOME%\emulator\emulator.exe" -avd Medium_Phone_API_36.1

echo Waiting 30s for emulator to boot...
timeout /t 30 /nobreak

echo.
echo === Building APK ===
cd /d "%~dp0android"
call gradlew.bat assembleDebug

echo.
echo === Installing APK ===
"%ANDROID_HOME%\platform-tools\adb.exe" install -r app\build\outputs\apk\debug\app-debug.apk

echo.
echo === Launching App ===
"%ANDROID_HOME%\platform-tools\adb.exe" shell am start -n com.cardstreet.app/.MainActivity

echo.
echo === Done! CardStreet should be running on the emulator. ===
pause
