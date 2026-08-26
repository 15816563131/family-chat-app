# FamilyChat APK 构建脚本
# 用法: powershell -ExecutionPolicy Bypass -File build-apk.ps1

param(
    [string]$BuildType = "release",
    [bool]$CopyToStatic = $true,
    [bool]$PushToGit = $false
)

$ErrorActionPreference = "Stop"

# 获取脚本所在目录
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AndroidDir = Join-Path $ScriptDir "family-chat-android\android"
$StaticDir = Join-Path $ScriptDir "static"
$ProjectRoot = $ScriptDir

Write-Host "======================================" -ForegroundColor Green
Write-Host "FamilyChat APK Build Script" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Android Dir: $AndroidDir" -ForegroundColor Cyan
Write-Host "Static Dir: $StaticDir" -ForegroundColor Cyan
Write-Host "Build Type: $BuildType" -ForegroundColor Cyan
Write-Host ""

# 检查Android项目目录
if (-not (Test-Path $AndroidDir)) {
    Write-Error "Android项目目录不存在: $AndroidDir"
    exit 1
}

# 选择Gradle wrapper或系统Gradle
$GradleCmd = $null
if (Test-Path (Join-Path $AndroidDir "gradlew.bat")) {
    $GradleCmd = Join-Path $AndroidDir "gradlew.bat"
    Write-Host "使用项目自带的 gradlew.bat" -ForegroundColor Cyan
} elseif (Get-Command "gradle" -ErrorAction SilentlyContinue) {
    $GradleCmd = "gradle"
    Write-Host "使用系统安装的 gradle" -ForegroundColor Cyan
} else {
    Write-Error "未找到Gradle! 请确保Android项目中有gradlew或系统已安装gradle"
    exit 1
}

# 构建任务名称
$BuildTask = if ($BuildType -eq "debug") { "assembleDebug" } else { "assembleRelease" }
$BuildTypeCapital = if ($BuildType -eq "debug") { "debug" } else { "release" }

Write-Host ""
Write-Host "开始构建: $BuildTask" -ForegroundColor Yellow

# 执行构建
Push-Location $AndroidDir
try {
    if ($GradleCmd -eq "gradle") {
        & $GradleCmd $BuildTask
    } else {
        & $GradleCmd $BuildTask
    }
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "构建失败！退出码: $LASTEXITCODE"
        exit 1
    }
    Write-Host ""
    Write-Host "构建成功！" -ForegroundColor Green
} finally {
    Pop-Location
}

# APK输出路径
$ApkPath = Join-Path $AndroidDir "app\build\outputs\apk\$BuildTypeCapital\app-$BuildTypeCapital.apk"
Write-Host "APK路径: $ApkPath" -ForegroundColor Cyan

if (-not (Test-Path $ApkPath)) {
    Write-Error "构建完成但未找到APK文件: $ApkPath"
    exit 1
}

# 显示APK大小
$ApkFile = Get-Item $ApkPath
$ApkSizeMB = [math]::Round($ApkFile.Length / 1MB, 2)
Write-Host "APK大小: $ApkSizeMB MB" -ForegroundColor Cyan
Write-Host "APK修改时间: $($ApkFile.LastWriteTime)" -ForegroundColor Cyan

# 复制到static目录
if ($CopyToStatic) {
    Write-Host ""
    Write-Host "复制APK到static目录..." -ForegroundColor Yellow
    
    if (-not (Test-Path $StaticDir)) {
        New-Item -ItemType Directory -Path $StaticDir -Force | Out-Null
        Write-Host "创建目录: $StaticDir" -ForegroundColor Cyan
    }
    
    $DestPath = Join-Path $StaticDir "family-chat.apk"
    Copy-Item -Path $ApkPath -Destination $DestPath -Force
    Write-Host "已复制到: $DestPath" -ForegroundColor Green
}

# 可选：提交到Git
if ($PushToGit) {
    Write-Host ""
    Write-Host "提交到Git..." -ForegroundColor Yellow
    
    Push-Location $ProjectRoot
    try {
        git status
        
        git add static/family-chat.apk
        git add build-apk.ps1
        
        $CommitMessage = "Build: 更新APK v2.0.0 $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        git commit -m $CommitMessage
        
        Write-Host ""
        Write-Host "已提交到本地Git。请手动运行 'git push' 推送到远程仓库。" -ForegroundColor Green
        Write-Host "  commit: $CommitMessage" -ForegroundColor Cyan
    } catch {
        Write-Warning "Git操作失败: $_"
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "完成！APK路径: $ApkPath" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
