@echo off
chcp 65001 >nul
title Sistema Digital INKO - dejar lista esta computadora

REM ===========================================================================
REM  Deja esta computadora lista para ser LA de la plataforma: que arranque
REM  sola y que no se duerma. Es para la computadora que se queda en el
REM  almacén, no para una que se va a casa.
REM
REM  Hace tres cosas, y nada más. Léelas antes de correrlo:
REM
REM   1. Crea una tarea programada «INKO Sistema Digital» que arranca la
REM      plataforma cada vez que esta persona inicia sesión en Windows.
REM   2. Le dice a Windows que, enchufada a la corriente, NO se duerma ni
REM      apague los discos.
REM   3. Le dice que cerrar la tapa tampoco la duerma.
REM
REM  No toca el firewall, ni antivirus, ni nada de seguridad.
REM  Para deshacerlo: schtasks /delete /tn "INKO Sistema Digital" /f
REM ===========================================================================

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Hay que abrirlo como administrador.
  echo   Clic derecho sobre el archivo  ^>  "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

set "AQUI=%~dp0"
if "%AQUI:~-1%"=="\" set "AQUI=%AQUI:~0,-1%"

echo.
echo   Carpeta de la plataforma: %AQUI%
echo.

echo   [1/3] Arranque automatico al iniciar sesion...
schtasks /create /tn "INKO Sistema Digital" /tr "wscript.exe \"%AQUI%\Iniciar oculto.vbs\"" /sc onlogon /it /f
if errorlevel 1 (echo        ^> no se pudo crear la tarea) else (echo        ^> listo)

echo.
echo   [2/3] Que no se duerma estando enchufada...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /change disk-timeout-ac 0
echo        ^> listo

echo.
echo   [3/3] Que cerrar la tapa no la duerma...
powercfg /setacvalueindex SCHEME_CURRENT 4f971e89-eebd-4455-a8de-9e59040e7347 5ca83367-6e45-459f-a27b-476b1d01c936 0
powercfg /setactive SCHEME_CURRENT
echo        ^> listo

echo.
echo   ======================================================================
echo    Ya quedo. Esta computadora arranca la plataforma sola al iniciar
echo    sesion y no se duerme mientras este enchufada.
echo.
echo    Falta una cosa, y es la mas importante: esta computadora tiene que
echo    QUEDARSE en el almacen, prendida y en el wifi del almacen. El iPad no
echo    guarda nada por su cuenta: todo vive aqui.
echo   ======================================================================
echo.
pause
