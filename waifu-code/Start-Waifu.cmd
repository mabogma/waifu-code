@echo off
setlocal
cd /d "%~dp0"
set "WAIFU_NODE=%~dp0..\..\work\runtime\node-v24.22.0-win-x64"
if exist "%WAIFU_NODE%\node.exe" set "PATH=%WAIFU_NODE%;%PATH%"
if not exist out\main.js (
 echo Waifu Code is not compiled. Run Build-Waifu.cmd first.
 exit /b 1
)
call scripts\code.bat %*
