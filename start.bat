@echo off
title Checklist Audit - Launcher
cd /d "%~dp0"
setlocal EnableExtensions

set "PY="

rem Detect a usable Python (ignores the Microsoft Store stub, which exits non-zero)
py -3 -c "exit(0)" >nul 2>nul && set "PY=py -3"
if not defined PY python -c "exit(0)" >nul 2>nul && set "PY=python"

if not defined PY goto :nopython

rem Find a free port between 8000 and 8010
set "PORT=8000"
:findport
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
  set /a PORT+=1
  if %PORT% GTR 8010 goto :noport
  goto :findport
)

echo Starting Checklist Audit on http://127.0.0.1:%PORT%/ ...
echo.
echo Keep this window open while using the app.
echo Close this window to stop the server.
echo.
start "Checklist Audit Server" cmd /k "%PY% server.py %PORT%"
ping -n 2 127.0.0.1 >nul
start "" "http://127.0.0.1:%PORT%/"
endlocal
exit /b 0

:nopython
echo.
echo [Checklist Audit] Python was not found on this computer.
echo Opening the app directly - local browser storage will be used for data.
echo.
echo To use a real on-disk database file, install Python from
echo https://www.python.org, then run start.bat again.
echo.
start "" "%~dp0index.html"
endlocal
exit /b 0

:noport
echo.
echo [Checklist Audit] No free port found between 8000 and 8010.
echo Please close some programs and try again.
echo.
start "" "%~dp0index.html"
endlocal
exit /b 1
