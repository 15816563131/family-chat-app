@echo off
chcp 65001 >nul
echo ================================================
echo  家庭聊天应用 - GitHub 初始化脚本
echo ================================================
echo.

:: 检查是否已初始化Git
if exist ".git" (
    echo [警告] Git仓库已经初始化
    echo.
    set /p continue="是否要重新初始化？(y/n): "
    if /i not "%continue%"=="y" (
        echo 取消操作
        exit /b 0
    )
    rmdir /s /q ".git" 2>nul
)

:: 初始化Git仓库
echo [1/6] 初始化Git仓库...
git init
git branch -M main

:: 配置用户信息
echo.
echo [2/6] 配置Git用户信息...
set /p github_user="请输入你的GitHub用户名: "
git config user.name "%github_user%"
set /p github_email="请输入你的GitHub邮箱: "
git config user.email "%github_email%"

:: 添加所有文件
echo.
echo [3/6] 添加所有文件到Git...
git add .

:: 创建初始提交
echo.
echo [4/6] 创建初始提交...
git commit -m "Initial commit: 家庭聊天应用 v1.0"

:: 设置远程仓库
echo.
echo [5/6] 设置远程仓库...
set /p confirm="请确认你已经在GitHub创建了仓库 (yes/no): "
if /i "%confirm%"=="yes" (
    set /p repo_name="请输入仓库名称 (默认: family-chat-app): "
    if "%repo_name%"=="" set repo_name=family-chat-app
    git remote add origin "https://github.com/%github_user%/%repo_name%.git"
    echo 远程仓库已添加: https://github.com/%github_user%/%repo_name%.git
) else (
    echo 请先访问 https://github.com 创建仓库
    echo 然后手动运行: git remote add origin <仓库URL>
)

:: 推送代码
echo.
echo [6/6] 推送代码到GitHub...
echo.
echo ================================================
echo  重要提示：
echo ================================================
echo.
echo 如果这是第一次推送，可能需要输入GitHub的访问令牌
echo 生成令牌步骤：
echo 1. 访问 https://github.com/settings/tokens
echo 2. 点击 "Generate new token (classic)"
echo 3. 勾选 "repo" 权限
echo 4. 生成并复制令牌
echo.
set /p push_now="现在推送到GitHub？(yes/no): "
if /i "%push_now%"=="yes" (
    git push -u origin main
    if %errorlevel%==0 (
        echo.
        echo ================================================
        echo  ✓ 代码已成功推送到GitHub！
        echo ================================================
        echo.
        echo 下一步 - 部署到云端：
        echo 1. 访问 https://railway.app
        echo 2. 登录并点击 "Deploy from GitHub"
        echo 3. 选择 family-chat-app 仓库
        echo 4. 配置环境变量后部署
        echo.
        echo 详细指南请查看: CLOUD_DEPLOY.md
        echo.
    ) else (
        echo.
        echo [错误] 推送失败，请检查：
        echo - GitHub仓库是否存在
        echo - 访问令牌是否正确
        echo - 网络连接是否正常
    )
) else (
    echo.
    echo 你可以稍后手动推送：
    echo   git push -u origin main
)

echo.
echo ================================================
echo  脚本执行完成！
echo ================================================
pause
