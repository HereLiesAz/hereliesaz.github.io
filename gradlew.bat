@echo off
setlocal
set GRADLE_VERSION=9.6.0
set ROOT=%USERPROFILE%\.gradle\hereliesaz-admin\gradle-%GRADLE_VERSION%
set BIN=%ROOT%\gradle-%GRADLE_VERSION%\bin\gradle.bat
set ZIP=%ROOT%\gradle-%GRADLE_VERSION%-bin.zip
if not exist "%BIN%" (
  if not exist "%ROOT%" mkdir "%ROOT%"
  if not exist "%ZIP%" powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip' -OutFile '%ZIP%'"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ZIP%' '%ROOT%'"
)
call "%BIN%" %*
