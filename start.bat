@echo off
chcp 65001 > nul
title BAFS Scholarship Assessment System - Real-time Server
echo ======================================================================
echo   BAFS Group - ระบบประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา (Real-time)
echo ======================================================================
echo กำลังเริ่มต้นเซิร์ฟเวอร์และเปิดหน้าต่างเบราว์เซอร์...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1"

pause
