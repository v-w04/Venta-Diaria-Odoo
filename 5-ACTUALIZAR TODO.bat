@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Venta Diaria - Actualizar todo

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
echo   ACTUALIZAR TODO                 codigo a Apps Script y git
echo   %AZUL%%REGLA%%FIN%
echo.

REM =====================================================================
echo   %AZUL%[1/4]%FIN%  Configuracion . . . . . . . . . . . . .
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
echo          ok
echo.

REM =====================================================================
echo   %AZUL%[2/4]%FIN%  Respaldo del codigo anterior . . . . . .
set "PRIMERA="
if exist "respaldo-codigo-viejo\" (
  echo          ya existe, no hace falta otro
  goto PASO3
)
set "PRIMERA=1"
mkdir "respaldo-codigo-viejo" >nul 2>&1
> "respaldo-codigo-viejo\.clasp.json" echo {
>> "respaldo-codigo-viejo\.clasp.json" echo   "scriptId": "!SID!",
>> "respaldo-codigo-viejo\.clasp.json" echo   "rootDir": "."
>> "respaldo-codigo-viejo\.clasp.json" echo }
pushd "respaldo-codigo-viejo"
call clasp pull > "%TEMP%\vdo_pull.txt" 2>&1
set "RC=!errorlevel!"
popd
if not "!RC!"=="0" goto FALLOPULL
echo          ok  quedo en respaldo-codigo-viejo\
del "%TEMP%\vdo_pull.txt" >nul 2>&1

:PASO3
echo.
REM =====================================================================
echo   %AZUL%[3/4]%FIN%  Subir a Apps Script . . . . . . . . . .
REM ---- Archivos que ya no deben subirse (renombrados) ----
if exist "apps-script\Limpieza.html" del /f /q "apps-script\Limpieza.html" >nul 2>&1
REM El nombre viejo de este archivo (sin numero)
if exist "ACTUALIZAR TODO.bat" del /f /q "ACTUALIZAR TODO.bat" >nul 2>&1
REM ---- clasp push: dos intentos, se guarda la salida de ambos ----
set "OUT1=%TEMP%\vdo_push1.txt"
set "OUT2=%TEMP%\vdo_push2.txt"
del "%OUT1%" "%OUT2%" >nul 2>&1
call clasp push --force < nul > "%OUT1%" 2>&1
set "RC1=!errorlevel!"
set "OUTX=%OUT1%"
set "RCX=!RC1!"
call :PUSHOK
if defined PUSHBIEN goto SUBIDO
REM Segundo intento sin opciones (versiones de clasp que no aceptan --force)
call clasp push < nul > "%OUT2%" 2>&1
set "RC2=!errorlevel!"
set "OUTX=%OUT2%"
set "RCX=!RC2!"
call :PUSHOK
if defined PUSHBIEN goto SUBIDO
goto FALLOPUSH

:SUBIDO
set "NARCH="
findstr /I /C:"Pushed" "!OUTX!" > "%TEMP%\vdo_n.txt" 2>nul
if exist "%TEMP%\vdo_n.txt" set /p NARCH=<"%TEMP%\vdo_n.txt"
del "%TEMP%\vdo_n.txt" "%OUT1%" "%OUT2%" >nul 2>&1
echo          ok  !NARCH!
echo.

REM =====================================================================
echo   %AZUL%[4/4]%FIN%  Guardar en git . . . . . . . . . . . .
if not defined GIT (
  echo          sin git en esta PC, se salta
  goto CIERRE
)
if not exist ".git\" (
  "!GIT!" init >nul 2>&1
  echo          repositorio creado
)
del /f /q ".git\index.lock" ".git\HEAD.lock" ".git\config.lock" >nul 2>&1
del /f /q ".git\objects\maintenance.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1
"!GIT!" add -A >nul 2>&1
"!GIT!" status --porcelain > "%TEMP%\vdo_st.txt" 2>nul
set "HAYCAMBIOS="
for %%A in ("%TEMP%\vdo_st.txt") do if %%~zA gtr 0 set "HAYCAMBIOS=1"
del "%TEMP%\vdo_st.txt" >nul 2>&1
set PENDIENTES=0
"!GIT!" rev-list --count @{u}..HEAD > "%TEMP%\vdo_p.txt" 2>nul
if exist "%TEMP%\vdo_p.txt" set /p PENDIENTES=<"%TEMP%\vdo_p.txt"
del "%TEMP%\vdo_p.txt" >nul 2>&1
if not defined PENDIENTES set PENDIENTES=0
if not defined HAYCAMBIOS (
  if "!PENDIENTES!"=="0" (
    echo          sin cambios que guardar
    goto CIERRE
  )
  "!GIT!" push -q
  if errorlevel 1 goto FALLOPUSHGIT
  goto VERIFICA
)
"!GIT!" commit -q -m "Actualizacion Venta Diaria Odoo"
if errorlevel 1 goto COMMITFAIL
"!GIT!" remote > "%TEMP%\vdo_rm.txt" 2>nul
set "HAYREMOTO="
for %%A in ("%TEMP%\vdo_rm.txt") do if %%~zA gtr 0 set "HAYREMOTO=1"
del "%TEMP%\vdo_rm.txt" >nul 2>&1
if not defined HAYREMOTO (
  echo          commit local, el repo no tiene GitHub conectado
  goto CIERRE
)
"!GIT!" push -q
if errorlevel 1 goto FALLOPUSHGIT
goto VERIFICA

:VERIFICA
set "RAMA="
"!GIT!" rev-parse --abbrev-ref HEAD > "%TEMP%\vdo_b.txt" 2>nul
if exist "%TEMP%\vdo_b.txt" set /p RAMA=<"%TEMP%\vdo_b.txt"
del "%TEMP%\vdo_b.txt" >nul 2>&1
if not defined RAMA goto NOCUADRA
set "LOCAL="
set "REMOTO="
"!GIT!" rev-parse HEAD > "%TEMP%\vdo_l.txt" 2>nul
if exist "%TEMP%\vdo_l.txt" set /p LOCAL=<"%TEMP%\vdo_l.txt"
del "%TEMP%\vdo_l.txt" >nul 2>&1
"!GIT!" ls-remote origin !RAMA! > "%TEMP%\vdo_r.txt" 2>nul
if exist "%TEMP%\vdo_r.txt" set /p REMOTO=<"%TEMP%\vdo_r.txt"
del "%TEMP%\vdo_r.txt" >nul 2>&1
if not defined LOCAL goto NOCUADRA
if not defined REMOTO goto NOCUADRA
if /i not "!LOCAL:~0,10!"=="!REMOTO:~0,10!" goto NOCUADRA
echo          subido y verificado

:CIERRE
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo %VERDE%  Listo. El codigo nuevo ya esta en Apps Script.%FIN%
echo.
echo      Sale el menu "Venta Diaria" arriba.
if defined PRIMERA (
  echo.
  echo   %ROJO%^^!  ES LA PRIMERA VEZ: FALTAN 4 PASOS EN EL MENU%FIN%
  echo      1. Configuracion ^> Configurar Odoo
  echo      2. Configuracion ^> Probar conexion a Odoo
  echo      3. Limpiar hojas que no uso ^> primero Compactar
  echo      4. Configuracion ^> Instalar / reinstalar triggers
)
echo.
call :LOGO
exit /b 0

REM =====================================================================
:SINCLASP
echo          falta
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  CLASP NO ESTA INSTALADO%FIN%
echo.
echo      Corre 0-CONFIGURAR.bat, lo instala solo.
echo.
pause
exit /b 1

:SINLOGIN
echo          sin sesion
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  CLASP NO TIENE SESION INICIADA%FIN%
echo.
echo      Corre 1-clasp-login.bat ^(cuenta victor.walmart.04^)
echo      y vuelve a correr este.
echo.
pause
exit /b 1

:FALLOPULL
echo          fallo
echo.
type "%TEMP%\vdo_pull.txt"
del "%TEMP%\vdo_pull.txt" >nul 2>&1
rmdir /s /q "respaldo-codigo-viejo" >nul 2>&1
echo.
echo   %AZUL%%REGLA%%FIN%
echo.
echo   %ROJO%x  NO SE PUDO BAJAR EL CODIGO ANTERIOR%FIN%
echo.
echo      No se subio nada: el codigo viejo sigue intacto.
echo      Casi siempre es la sesion. Corre 1-clasp-login.bat
echo      con victor.walmart.04 y vuelve a correr este.
echo.
pause
exit /b 1

:FALLOPUSH
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
findstr /I /C:"Skipping" "%OUT1%" >nul 2>&1 && set "SKIP=1"
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
  echo      La causa es el mensaje del Intento 1. Copialo y pasaselo a Claude.
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
findstr /I /C:"Skipping" /C:"rror" /C:"nvalid" /C:"unknown" /C:"already exists" "!OUTX!" >nul 2>&1 && goto :eof
set "PUSHBIEN=1"
goto :eof

:COMMITFAIL
echo.
echo   %ROJO%x  NO SE PUDO HACER EL COMMIT%FIN%
echo      git sin nombre y correo en esta PC: 0-CONFIGURAR.bat
echo.
pause
exit /b 1

:NOCUADRA
echo.
echo   %ROJO%x  NO PUDE CONFIRMAR QUE GITHUB QUEDO IGUAL%FIN%
echo      Revisa el repo en GitHub antes de seguir.
echo.
pause
exit /b 1

:FALLOPUSHGIT
echo.
echo   %ROJO%x  EL COMMIT QUEDO LOCAL, GITHUB LO RECHAZO%FIN%
echo      El codigo SI subio a Apps Script. Revisa git.
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
