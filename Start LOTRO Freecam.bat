@echo off
setlocal EnableExtensions
title LOTRO Freecam

rem Frida has to open a handle to the game process, and Windows will not hand one
rem out from an unelevated prompt. If we are not admin yet, relaunch this same file
rem through UAC and let the first copy exit.
net session >nul 2>&1
if errorlevel 1 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   Could not ask for administrator rights.
        echo   Right-click this file and choose "Run as administrator" instead.
        echo.
        pause
    )
    exit /b
)

rem Elevating drops us in System32, so go back to wherever this file actually lives.
rem Both .js files are expected to sit next to it.
cd /d "%~dp0"

echo.
echo   LOTRO Freecam
echo   --------------------------------------------------------------
echo.

where frida >nul 2>&1
if errorlevel 1 (
    echo   Frida is not installed, or it is not on your PATH.
    echo.
    echo   Install it with:
    echo       pip install frida-tools
    echo.
    echo   If you have only just installed it, close this window and open a
    echo   new one so Windows picks up the updated PATH.
    echo.
    pause
    exit /b
)

rem tasklist in CSV form gives "lotroclient64.exe","12345",... so the second field
rem is the pid. When nothing matches it prints a plain INFO line with no commas,
rem which produces no second token and leaves GAMEPID unset.
set "GAMEPID="
for /f "tokens=2 delims=," %%A in ('tasklist /FI "IMAGENAME eq lotroclient64.exe" /NH /FO CSV 2^>nul') do set "GAMEPID=%%~A"
if not defined GAMEPID (
    echo   The game is not running.
    echo.
    echo   Start LOTRO and log all the way in to a character - not the launcher,
    echo   not character select - then run this again. The script resolves engine
    echo   objects that only exist once the world is loaded.
    echo.
    pause
    exit /b
)
echo   Found the game, process %GAMEPID%.
echo.

echo   Which one?
echo.
echo     [1]  Minimal    free camera only. No render changes, no FPS cost.
echo     [2]  Cinematic  camera plus extended draw distance, grass and terrain.
echo.
set "PICK="
set /p "PICK=  Pick 1 or 2 (enter = 1): "
if not defined PICK set "PICK=1"

if "%PICK%"=="2" (
    set "SCRIPT=lotro_freecam_cinematic.js"
) else (
    set "SCRIPT=lotro_freecam_minimal.js"
)

if not exist "%SCRIPT%" (
    echo.
    echo   Cannot find %SCRIPT% next to this launcher.
    echo   Both .js files need to be in this folder:
    echo   %~dp0
    echo.
    pause
    exit /b
)

echo.
echo   Attaching %SCRIPT% ...
echo.
echo   Leave this window open. It is your connection to the script - closing it
echo   detaches and puts every setting back. It is also a live console you can
echo   type commands into.
echo.
echo   Alt-tab into the game and press Ctrl+F8 to fly.
echo.

frida -p %GAMEPID% -l "%SCRIPT%"

echo.
echo   Detached. Your settings have been restored.
echo.
pause
