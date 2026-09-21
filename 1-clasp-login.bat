@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Sesion de clasp

REM ---- Color de marca ----
set "ESC="
for /f %%E in ('echo prompt $E ^| cmd') do set "ESC=%%E"
set "AZUL="
set "VERDE="
set "ROJO="
set "FIN="
if defined ESC set "AZUL=%ESC%[38;2;31;148;249m"
if defined ESC set "VERDE=%ESC%[38;2;63;185;80m"
if defined ESC set "ROJO=%ESC%[38;2;248;81;73m"
if defined ESC set "FIN=%ESC%[0m"
set "REGLA=----------------------------------------------------"

echo.
echo   SESION DE CLASP                 cuenta victor.walmart.04
echo   %AZUL%%REGLA%%FIN%
echo.
where clasp >nul 2>&1
if errorlevel 1 goto SINCLASP

if exist "%USERPROFILE%\.clasprc.json" (
  echo   Ya habia una sesion. Se cierra y se abre la nueva.
  echo.
  call clasp logout >nul 2>&1
  if exist "%USERPROFILE%\.clasprc.json" del /f /q "%USERPROFILE%\.clasprc.json" >nul 2>&1
)
echo   Se abre el navegador: entra con victor.walmart.04@gmail.com
echo.
call clasp login
if not exist "%USERPROFILE%\.clasprc.json" goto SINLOGIN

echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. Sesion iniciada.%FIN%
echo.
call :LOGO
exit /b 0

:SINCLASP
echo   %ROJO%x  CLASP NO ESTA INSTALADO%FIN%
echo.
echo      Corre 0-CONFIGURAR.bat, lo instala solo.
echo.
pause
exit /b 1

:SINLOGIN
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO SE COMPLETO EL INICIO DE SESION%FIN%
echo.
echo      Vuelve a correr este archivo y termina el login en el navegador.
echo.
pause
exit /b 1

:LOGO
REM --- Logo animado: solo en salidas exitosas, sin cls, sin pause despues ---
where node >nul 2>&1
if errorlevel 1 goto SINLOGO
if not exist "%~dp0logo-animado.js" goto SINLOGO
node "%~dp0logo-animado.js" giro marca 0 12
goto :eof

:SINLOGO
pause
goto :eof
