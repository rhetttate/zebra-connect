@echo off
title Zebra Connect
cd /d "%~dp0"
echo.
echo  Zebra Connect is starting...
echo  Leave this window open. Open the address below on your phone:
echo.
"%~dp0node.exe" app\src\server.js
pause
