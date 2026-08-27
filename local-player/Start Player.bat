@echo off
title Netplus IPTV Player — v1.6.1
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed yet.
  echo The official Node.js download page will open now.
  echo Install the Windows LTS version, then double-click Start Player.bat again.
  echo.
  start "" "https://nodejs.org/dist/v24.19.0/node-v24.19.0-x64.msi"
  pause
  exit /b 1
)

node server.cjs
if errorlevel 1 (
  echo.
  echo The player stopped because of an error. Take a screenshot of this window.
  pause
)
