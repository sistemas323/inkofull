@echo off
title Sistema Digital INKO
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   No se encontro Node.js en esta computadora.
  echo   Descargalo desde https://nodejs.org  ^(version LTS^) e instalalo,
  echo   luego vuelve a abrir este archivo.
  echo.
  pause
  exit /b 1
)

node server.js
echo.
echo   El servidor se detuvo.
pause
