@echo off
chcp 65001 >nul
cd /d %~dp0
where python >nul 2>nul && (python start.py & goto :eof)
where py >nul 2>nul && (py -3 start.py & goto :eof)
echo 未找到 Python，请先安装 https://www.python.org/downloads/ 或用其他静态服务器
pause
