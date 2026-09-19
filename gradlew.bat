@echo off
setlocal
set GRADLE_VERSION=9.7.1
set ROOT=%USERPROFILE%\.gradle\hereliesaz-admin\gradle-%GRADLE_VERSION%
set BIN=%ROOT%\gradle-%GRADLE_VERSION%\bin\gradle.bat
set ZIP=%ROOT%\gradle-%GRADLE_VERSION%-bin.zip
if not exist "%BIN%" (
  if not exist "%ROOT%" mkdir "%ROOT%"
  if not exist "%ZIP%" powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing 'https://services.gradle.org/distributions/gradle-%GRADLE_VERSION%-bin.zip' -OutFile '%ZIP%'"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$actual=(Get-FileHash -Algorithm SHA256 '%ZIP%').Hash.ToLower(); if($actual -ne 'acd53f1edaf02f1a8ff99879f8a34b302661a057d9b063ae9e35b552f804d20a'){ throw 'Gradle distribution checksum mismatch' }"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%ZIP%' '%ROOT%'"
)
call "%BIN%" %*
