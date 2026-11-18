@echo off
setlocal
title Drop Tracker CS2 - parar
cd /d "%~dp0"

where powershell >nul 2>nul
if errorlevel 1 (
  echo.
  echo   PowerShell nao encontrado.
  echo.
  pause
  exit /b 1
)

echo.
echo   Encerrando o Drop Tracker CS2 (bandeja + servidor)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "tray\drop-tracker-tray.ps1" -Stop

echo.
echo   Pronto. O icone da bandeja e o servidor foram encerrados.
rem Espera 3 s sem depender de stdin (timeout falha com entrada redirecionada).
ping -n 3 127.0.0.1 >nul
exit /b 0
