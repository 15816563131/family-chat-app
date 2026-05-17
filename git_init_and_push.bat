
@echo off
chcp 65001 >nul
echo =========================================
echo   Git仓库初始化和推送脚本
echo =========================================
echo.

echo 正在使用完整Git路径...
set "GIT_PATH=C:\Program Files\Git\bin\git.exe

echo [1/7] 初始化Git仓库...
"%GIT_PATH%" init
"%GIT_PATH%" branch -M main

echo.
echo [2/7] 配置本地用户信息...
"%GIT_PATH%" config user.name "15816563131
"%GIT_PATH%" config user.email "15816563131@163.com"

echo.
echo [3/7] 添加所有文件到暂存区...
"%GIT_PATH%" add .

echo.
echo [4/7] 创建提交...
"%GIT_PATH%" commit -m "Initial commit: Family chat application"

echo.
echo [5/7] 添加远程仓库...
echo.
echo 请告诉我你的GitHub仓库地址（URL）
echo 例如：https://github.com/你的用户名/family-chat-app.git
echo.
echo （在浏览器复制仓库主页的地址栏）
echo.
set /p REPO_URL="请粘贴GitHub仓库地址: 
echo.
"%GIT_PATH%" remote add origin %REPO_URL%

echo.
echo [6/7] 准备推送代码到GitHub...
"%GIT_PATH%" push -u origin main

echo.
echo =========================================
echo   完成！
echo =========================================
echo.
echo 如果需要输入GitHub用户名和密码（注意GitHub现在需要个人访问令牌Personal Access Token）
echo.
pause
