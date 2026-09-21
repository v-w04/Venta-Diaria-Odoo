@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Guardar en git

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

REM ---- git: el del PATH o el de GitHub Desktop ----
set "GIT="
where git >nul 2>&1 && set "GIT=git"
if not defined GIT for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"

echo.
echo   GUARDAR EN GIT                  solo git, no toca Apps Script
echo   %AZUL%%REGLA%%FIN%
echo.
if not defined GIT goto SINGIT

echo   %AZUL%[1/2]%FIN%  Commit . . . . . . . . . . . . . . . .
if not exist ".git\" (
  "!GIT!" init >nul 2>&1
  echo          repositorio creado
)
if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1
"!GIT!" add -A >nul 2>&1
"!GIT!" status --porcelain > "%TEMP%\vdo_st.txt" 2>nul
set "HAYCAMBIOS="
for %%A in ("%TEMP%\vdo_st.txt") do if %%~zA gtr 0 set "HAYCAMBIOS=1"
del "%TEMP%\vdo_st.txt" >nul 2>&1
if not defined HAYCAMBIOS (
  echo          sin cambios que guardar
  goto CIERRE
)
"!GIT!" commit -m "Actualizacion Venta Diaria Odoo" >nul 2>&1
if errorlevel 1 (
  echo          no se pudo hacer el commit: git no tiene nombre y correo
  echo          configurados en esta PC. El codigo en Apps Script no se afecta.
  goto CIERRE
)
echo          ok
echo.

echo   %AZUL%[2/2]%FIN%  Subir a GitHub . . . . . . . . . . . .
"!GIT!" remote > "%TEMP%\vdo_rm.txt" 2>nul
set "HAYREMOTO="
for %%A in ("%TEMP%\vdo_rm.txt") do if %%~zA gtr 0 set "HAYREMOTO=1"
del "%TEMP%\vdo_rm.txt" >nul 2>&1
if not defined HAYREMOTO (
  echo          el repo no tiene GitHub conectado, quedo local
  goto CIERRE
)
"!GIT!" push > "%TEMP%\vdo_gp.txt" 2>&1
if errorlevel 1 goto FALLOPUSH
del "%TEMP%\vdo_gp.txt" >nul 2>&1
echo          ok

:CIERRE
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. Cambios guardados.%FIN%
echo.
call :LOGO
exit /b 0

:SINGIT
echo   %ROJO%x  NO HAY GIT EN ESTA COMPUTADORA%FIN%
echo.
echo      Instala GitHub Desktop o git para Windows.
echo      Para subir el codigo a Apps Script no hace falta: usa 3-clasp-push.bat
echo.
pause
exit /b 1

:FALLOPUSH
echo          fallo
echo.
type "%TEMP%\vdo_gp.txt"
del "%TEMP%\vdo_gp.txt" >nul 2>&1
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  EL COMMIT QUEDO LOCAL, GITHUB LO RECHAZO%FIN%
echo.
echo      Arriba esta el mensaje de git. Copialo y pasaselo a Claude.
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
