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

rem Si la plataforma se detiene por un error, se vuelve a levantar sola a los
rem 5 segundos. El motivo queda anotado en datos\servidor.log.
:arrancar
node server.js
if errorlevel 2 if not errorlevel 3 (
  echo.
  echo   La plataforma ya estaba abierta. Esta ventana se puede cerrar.
  echo.
  rem Arrancada sin ventana ^(Iniciar oculto.vbs^) no hay quien lea ni conteste:
  rem esperar una tecla dejaria un proceso colgado que nadie ve.
  if not defined INKO_OCULTO pause
  exit /b 0
)
echo.
echo   El servidor se detuvo. Se vuelve a levantar en 5 segundos...
echo   ^(Para apagarla de verdad, cierra esta ventana.^)
timeout /t 5 /nobreak >nul
goto arrancar
