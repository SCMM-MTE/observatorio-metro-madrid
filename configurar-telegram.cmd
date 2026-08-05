@echo off
title Configurar avisos de Telegram
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-telegram.ps1"
pause
