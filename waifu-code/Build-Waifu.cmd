@echo off
setlocal
cd /d "%~dp0"
set "WAIFU_NODE=%~dp0..\..\work\runtime\node-v24.22.0-win-x64"
if exist "%WAIFU_NODE%\node.exe" set "PATH=%WAIFU_NODE%;%PATH%"
set "NODE_OPTIONS=--max-old-space-size=8192"
node scripts\waifu-doctor.cjs --prerequisites
if errorlevel 1 exit /b 1
call npm run install-fast
if errorlevel 1 exit /b 1
call npm run build-fast
if errorlevel 1 exit /b 1
call npm run electron
if errorlevel 1 exit /b 1
echo Ready. Run Start-Waifu.cmd to open Waifu Code.

