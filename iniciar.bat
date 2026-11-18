@echo off
rem ---------------------------------------------------------------------------
rem PLANO B: modo console, com a janela preta aberta mostrando os logs.
rem O jeito normal e o atalho "Drop Tracker CS2" (iniciar-bandeja.vbs), que usa
rem o icone na bandeja e nao abre janela nenhuma.
rem Use este arquivo quando precisar ver o que o servidor esta escrevendo.
rem ---------------------------------------------------------------------------
setlocal
title Drop Tracker CS2
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js nao encontrado.
  echo   Instale em https://nodejs.org e rode este arquivo de novo.
  echo.
  pause
  exit /b 1
)

rem Ja esta rodando? entao so abre o navegador.
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5179 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   O app ja esta rodando. Abrindo o navegador...
  start "" http://localhost:5179
  exit /b 0
)

echo.
echo   Drop Tracker CS2
echo   O navegador abre em http://localhost:5179
echo.
echo   Deixe esta janela aberta enquanto quiser o app no ar.
echo   Fechar esta janela = desligar o app.
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:5179'"
node server\index.js

echo.
echo   O app foi encerrado.
pause
