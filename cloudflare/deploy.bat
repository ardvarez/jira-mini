@echo off
title Deploy Jira Mini Cloudflare Backend
cd /d "%~dp0"

echo ======================================================
echo  1. Migrating Database Schema to Cloudflare D1...
echo ======================================================
call npx wrangler d1 execute jira-db --file=./schema.sql --remote

echo.
echo ======================================================
echo  2. Deploying Worker API...
echo ======================================================
call npx wrangler deploy

echo.
echo ======================================================
echo  Deploy Complete! Salin Worker URL ke Jira Mini web.
echo ======================================================
pause
