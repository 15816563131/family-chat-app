@echo off
chcp 65001 >nul
echo =========================================
echo   Git自动化安装和配置脚本
echo =========================================
echo.

echo [1/8] 正在检查Git是否已安装...
where git >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [信息] Git已经安装！
    goto :CONFIG_GIT
)

echo.
echo [2/8] Git未安装，正在下载Git...
echo.
echo 正在使用winget安装Git...
winget install --id Git.Git -e --accept-package-agreements --accept-source-agreements
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [错误] winget不可用，尝试另一种方式...
    echo.
    echo 正在下载Git安装程序...
    powershell -Command "Invoke-WebRequest -Uri 'https://github.com/git-for-windows/git/releases/download/v2.45.2.windows.1/Git-2.45.2-64-bit.exe' -OutFile 'D:\0\git-installer.exe'"
    
    if exist "D:\0\git-installer.exe" (
        echo.
        echo [3/8] 正在安装Git...
        start /wait "" "D:\0\git-installer.exe" /VERYSILENT /NORESTART /NOCANCEL /SP- /COMPONENTS="icons,ext\shellhere,ext\guihere,gitlfs,assoc,assoc_sh"
        echo.
        echo [4/8] 安装完成，刷新环境变量...
        call :REFRESH_ENV
    ) else (
        echo.
        echo [错误] Git下载失败！
        echo 请手动访问 https://git-scm.com/download/win 下载安装
        echo.
        pause
        exit /b 1
    )
)

:CONFIG_GIT
echo.
echo [5/8] 正在配置Git用户信息...
git config --global user.name "15816563131"
git config --global user.email "15816563131@163.com"
echo [信息] Git用户信息已配置！
echo.
echo 用户名: 15816563131
echo 邮箱: 15816563131@163.com
echo.

echo [6/8] 正在初始化Git仓库...
cd /d D:\0
if exist ".git" (
    echo [信息] Git仓库已存在
) else (
    git init
    git branch -M main
)

echo.
echo [7/8] 正在添加所有文件...
git add .

echo.
echo [8/8] 正在创建初始提交...
git commit -m "Initial commit: Family chat application"

echo.
echo =========================================
echo   Git配置和提交完成！
echo =========================================
echo.
echo 下一步：
echo 1. 连接到GitHub仓库
echo 2. 推送代码到GitHub
echo.
echo 请提供你的GitHub仓库地址（例如：https://github.com/你的用户名/family-chat-app.git）
echo.
echo 或者运行以下命令手动连接：
echo git remote add origin https://github.com/你的用户名/family-chat-app.git
echo git push -u origin main
echo.

pause
exit /b 0

:REFRESH_ENV
echo 正在刷新环境变量...
for /f "usebackq tokens=3*" %%i in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path`) do (
    setx PATH "%%i %%j" /M >nul 2>&1
)
for /f "usebackq tokens=3*" %%i in (`reg query "HKCU\Environment" /v Path`) do (
    setx PATH "%%i %%j" >nul 2>&1
)
echo 环境变量已刷新！
goto :EOF
