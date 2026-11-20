@echo off
setlocal
set "NODE_OPTIONS="
node.exe "%~dp0studio.mjs" %*
