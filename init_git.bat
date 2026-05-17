@echo off
REM 家庭聊天应用 - Git初始化脚本

echo ========================================
echo 家庭聊天应用 - Git仓库初始化
echo ========================================
echo.

REM 检查git是否安装
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到Git
    echo 请先安装Git: https://git-scm.com/download/win
    echo 安装后重新运行此脚本
    pause
    exit /b 1
)

echo [1/6] 初始化Git仓库...
git init

echo.
echo [2/6] 配置用户信息...
git config user.name "Your Name"
git config user.email "your.email@example.com"

echo.
echo [3/6] 添加所有文件到暂存区...
git add .

echo.
echo [4/6] 创建初始提交...
git commit -m "Initial commit: 家庭聊天应用

- Flask + Flask-SocketIO 实时聊天应用
- 支持用户注册登录
- 好友系统和实时消息
- 配置云端部署（Railway/Render）
- 包含部署和维护文档"

echo.
echo [5/6] 创建主分支...
git branch -M main

echo.
echo ========================================
echo [完成] Git仓库初始化成功！
echo ========================================
echo.
echo 接下来的步骤：
echo.
echo 1. 在GitHub创建新仓库
echo 2. 添加远程仓库：
echo    git remote add origin https://github.com/你的用户名/family-chat-app.git
echo 3. 推送代码：
echo    git push -u origin main
echo.
echo 然后就可以在Railway或Render上部署了！
echo.
pause
