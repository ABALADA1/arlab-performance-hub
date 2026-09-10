@echo off
chcp 65001 >nul
title ARLAB - Recuperar ultima version real
cls
echo ==========================================================
echo   ARLAB - RECUPERAR LA ULTIMA VERSION REAL DEL NAVEGADOR
echo ==========================================================
echo.
echo IMPORTANTE: cierra completamente Chrome y Microsoft Edge
echo antes de continuar. Asi podremos leer todos los archivos
de cache sin que el navegador los bloquee.
echo.
echo Este proceso NO sube nada a Internet y solo extrae URLs
de ARLAB. Tambien hace una copia local de los almacenes web.
echo.
pause
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0RECUPERAR_ULTIMA_ARLAB.ps1"
echo.
pause
