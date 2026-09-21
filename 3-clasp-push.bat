@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Subir a Apps Script

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
echo   SUBIR A APPS SCRIPT             solo el codigo, sin git
echo   %AZUL%%REGLA%%FIN%
echo.
where clasp >nul 2>&1
if errorlevel 1 goto SINCLASP
if not exist "%USERPROFILE%\.clasprc.json" goto SINLOGIN

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

echo   %AZUL%[1/1]%FIN%  Subiendo apps-script\ . . . . . . . . .
REM ---- clasp push: dos intentos, se guarda la salida de ambos ----
set "OUT1=%TEMP%\vdo_push1.txt"
set "OUT2=%TEMP%\vdo_push2.txt"
del "%OUT1%" "%OUT2%" >nul 2>&1
call clasp push --force < nul > "%OUT1%" 2>&1
set "RC1=!errorlevel!"
set "OUTX=%OUT1%"
set "RCX=!RC1!"
call :PUSHOK
if defined PUSHBIEN goto OK
REM Segundo intento sin opciones (versiones de clasp que no aceptan --force)
call clasp push < nul > "%OUT2%" 2>&1
set "RC2=!errorlevel!"
set "OUTX=%OUT2%"
set "RCX=!RC2!"
call :PUSHOK
if defined PUSHBIEN goto OK
goto FALLO

:OK
del "%OUT1%" "%OUT2%" >nul 2>&1
echo          ok

echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. Codigo arriba.%FIN%
echo.
echo   %ROJO%^^!  RECARGA EL LIBRO CON F5%FIN%
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
echo   %ROJO%x  CLASP NO TIENE SESION INICIADA%FIN%
echo.
echo      Corre 1-clasp-login.bat y vuelve a correr este.
echo.
pause
exit /b 1

:FALLO
echo          fallo
echo.
set "CVER=?"
call clasp --version > "%TEMP%\vdo_v.txt" 2>nul
if exist "%TEMP%\vdo_v.txt" set /p CVER=<"%TEMP%\vdo_v.txt"
del "%TEMP%\vdo_v.txt" >nul 2>&1
echo   clasp version !CVER!
echo.
echo   Intento 1  ^(clasp push --force^):
if exist "%OUT1%" type "%OUT1%"
echo.
echo   Intento 2  ^(clasp push^):
if exist "%OUT2%" type "%OUT2%"
echo.
set "SKIP="
findstr /I /C:"Skipping" "%OUT1%" "%OUT2%" >nul 2>&1 && set "SKIP=1"
del "%OUT1%" "%OUT2%" >nul 2>&1
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  CLASP NO PUDO SUBIR EL CODIGO%FIN%
echo.
if defined SKIP (
  echo      clasp se detuvo a preguntar si reemplaza appsscript.json y nadie
  echo      le contesto. Abre CMD en esta carpeta, escribe  clasp push
  echo      y contesta  y  a la pregunta. Luego vuelve a correr este archivo.
) else (
  echo      Arriba estan los dos mensajes de clasp. Copialos y pasaselos a Claude.
)
echo.
pause
exit /b 1

:PUSHOK
REM Decide si un intento de clasp push funciono, leyendo su salida.
set "PUSHBIEN="
findstr /I /C:"Pushed" "!OUTX!" >nul 2>&1 && set "PUSHBIEN=1"
if defined PUSHBIEN goto :eof
if not "!RCX!"=="0" goto :eof
findstr /I /C:"Skipping" /C:"rror" /C:"nvalid" /C:"unknown" "!OUTX!" >nul 2>&1 && goto :eof
set "PUSHBIEN=1"
goto :eof

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
