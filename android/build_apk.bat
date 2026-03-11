@echo off
set "JAVA_HOME=C:\Program Files\Android\Android Studio1\jbr"
set "PATH=%JAVA_HOME%\bin;%PATH%"
echo Using JAVA_HOME: %JAVA_HOME%
call gradlew.bat assembleDebug
