@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\open-app.ps1" -Stop
if errorlevel 1 pause
