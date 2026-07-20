@echo off
setlocal EnableExtensions
title LOTRO Freecam - Install Dependencies

rem No elevation here on purpose: Install-Dependencies.ps1 installs everything for the
rem current Windows user only (winget --scope user / InstallAllUsers=0), so it never
rem needs admin rights, unlike "Start LOTRO Freecam.bat" which does (Frida needs
rem elevation to attach to the game process later).
cd /d "%~dp0"

if not exist "Install-Dependencies.ps1" (
    echo.
    echo   Cannot find Install-Dependencies.ps1 next to this launcher.
    echo   It needs to be in this folder:
    echo   %~dp0
    echo.
    pause
    exit /b
)

echo.
echo   LOTRO Freecam - installing Python and Frida if they're missing...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "Install-Dependencies.ps1"

exit /b
