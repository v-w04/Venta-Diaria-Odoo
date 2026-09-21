@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Respaldar codigo de Apps Script

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
echo   RESPALDAR CODIGO                lo que hay en Apps Script
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

REM Carpeta con fecha: nunca pisa apps-script\ ni un respaldo anterior
set "STAMP="
powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm" > "%TEMP%\vdo_f.txt" 2>nul
if exist "%TEMP%\vdo_f.txt" set /p STAMP=<"%TEMP%\vdo_f.txt"
del "%TEMP%\vdo_f.txt" >nul 2>&1
if not defined STAMP set "STAMP=%RANDOM%"
set "DEST=respaldo-!STAMP!"

echo   %AZUL%[1/1]%FIN%  Bajando a !DEST! . . . . . . . . .
mkdir "!DEST!" >nul 2>&1
> "!DEST!\.clasp.json" echo {
>> "!DEST!\.clasp.json" echo   "scriptId": "!SID!",
>> "!DEST!\.clasp.json" echo   "rootDir": "."
>> "!DEST!\.clasp.json" echo }
pushd "!DEST!"
call clasp pull > "%TEMP%\vdo_pull.txt" 2>&1
set "RC=!errorlevel!"
popd
if not "!RC!"=="0" goto FALLO
del "%TEMP%\vdo_pull.txt" >nul 2>&1
echo          ok

echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. Respaldo en !DEST!\  -  apps-script\ no se toco.%FIN%
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
type "%TEMP%\vdo_pull.txt"
del "%TEMP%\vdo_pull.txt" >nul 2>&1
rmdir /s /q "!DEST!" >nul 2>&1
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO SE PUDO BAJAR EL CODIGO%FIN%
echo.
echo      Arriba esta el mensaje de clasp. Copialo y pasaselo a Claude.
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
