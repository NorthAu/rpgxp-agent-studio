@echo off
setlocal
set "NODE_OPTIONS="
set "NODE_PATH="
set "studio_node=%~dp0runtime\node.exe"
if not exist "%studio_node%" set "studio_node=node.exe"
if "%~1"=="" goto menu
if /i "%~1"=="demo" goto demo
"%studio_node%" "%~dp0studio.mjs" %*
exit /b %errorlevel%
:demo
"%studio_node%" "%~dp0launcher.mjs" %*
exit /b %errorlevel%
:menu
chcp 65001 >nul
"%studio_node%" "%~dp0launcher.mjs"
if errorlevel 1 pause
