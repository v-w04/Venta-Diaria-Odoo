@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Configurar

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
echo   CONFIGURAR                      una sola vez por computadora
echo   %AZUL%%REGLA%%FIN%
echo.

REM =====================================================================
echo   %AZUL%[1/4]%FIN%  Node.js . . . . . . . . . . . . . . . .
where node >nul 2>&1
if errorlevel 1 goto SINNODE
echo          ok
echo.

REM =====================================================================
echo   %AZUL%[2/4]%FIN%  clasp . . . . . . . . . . . . . . . . .
where clasp >nul 2>&1
if not errorlevel 1 goto CLASPOK
echo          no estaba, instalando . . .
call npm install -g @google/clasp > "%TEMP%\vdo_npm.txt" 2>&1
where clasp >nul 2>&1
if errorlevel 1 goto SINCLASP
del "%TEMP%\vdo_npm.txt" >nul 2>&1
:CLASPOK
set "VER=?"
call clasp --version > "%TEMP%\vdo_v.txt" 2>nul
if exist "%TEMP%\vdo_v.txt" set /p VER=<"%TEMP%\vdo_v.txt"
del "%TEMP%\vdo_v.txt" >nul 2>&1
echo          ok  version !VER!
echo.

REM =====================================================================
echo   %AZUL%[3/4]%FIN%  Script ID del libro . . . . . . . . . .
REM ---- Script ID del libro Venta Diaria Odoo 2026 (no es secreto) ----
set "SID=1dt95ytZ_LTdYOYELMu-WCU1ePOu_s3AxmovFAeQY42Ce1qeCYQ46wE2j"
set "SIDMAL="
if not exist ".clasp.json" set "SIDMAL=1"
if exist ".clasp.json" findstr /C:"!SID!" ".clasp.json" >nul 2>&1 || set "SIDMAL=1"
if exist ".clasp.json" findstr /C:"scriptExtensions" ".clasp.json" >nul 2>&1 || set "SIDMAL=1"
if defined SIDMAL (
  > ".clasp.json" echo {
  >> ".clasp.json" echo   "scriptId": "!SID!",
  >> ".clasp.json" echo   "rootDir": "apps-script",
  >> ".clasp.json" echo   "scriptExtensions": [".gs", ".js"],
  >> ".clasp.json" echo   "htmlExtensions": [".html"]
  >> ".clasp.json" echo }
)
echo          ok
echo.

REM =====================================================================
echo   %AZUL%[4/4]%FIN%  Sesion de clasp . . . . . . . . . . . .
if exist "%USERPROFILE%\.clasprc.json" (
  echo          ok  ya habia sesion
  goto CIERRE
)
echo          se abre el navegador: entra con victor.walmart.04
echo.
call clasp login
if not exist "%USERPROFILE%\.clasprc.json" goto SINLOGIN
echo.
echo          ok

:CIERRE
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. Esta computadora ya puede subir el codigo.%FIN%
echo.
echo   Siguiente:  5-ACTUALIZAR TODO.bat
echo.
call :LOGO
exit /b 0

REM =====================================================================
:SINNODE
echo          falta
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO HAY NODE.JS EN ESTA COMPUTADORA%FIN%
echo.
echo      1. Bajalo de https://nodejs.org  ^(version LTS^)
echo      2. Instalalo con todo por defecto
echo      3. Cierra esta ventana y vuelve a correr este archivo
echo.
pause
exit /b 1

:SINCLASP
echo          fallo
echo.
type "%TEMP%\vdo_npm.txt"
del "%TEMP%\vdo_npm.txt" >nul 2>&1
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO SE PUDO INSTALAR CLASP%FIN%
echo.
echo      Clic derecho en este archivo ^> Ejecutar como administrador.
echo.
pause
exit /b 1

:SINLOGIN
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO SE COMPLETO EL INICIO DE SESION%FIN%
echo.
echo      Vuelve a correr este archivo y termina el login en el
echo      navegador con victor.walmart.04@gmail.com
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
