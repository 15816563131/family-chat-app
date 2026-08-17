# ===== 一键部署到 Fly.io 脚本 =====
# 你只需要：
# 1. 注册 fly.io 账号：https://fly.io/app/sign-up
# 2. 安装 flyctl：https://fly.io/docs/getting-started/installing-flyctl/
# 3. 运行此脚本

Write-Host "🚀 一键部署 FamilyChat 到 Fly.io" -ForegroundColor Cyan
Write-Host ""

# 检查 flyctl 是否安装
if (-not (Get-Command flyctl -ErrorAction SilentlyContinue)) {
    Write-Host "❌ 未找到 flyctl，请先安装：" -ForegroundColor Red
    Write-Host "   下载地址：https://fly.io/docs/getting-started/installing-flyctl/" -ForegroundColor Yellow
    Write-Host "   Windows 命令：winget install superfly.flyctl" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ flyctl 已找到" -ForegroundColor Green

# 登录（如果未登录）
Write-Host ""
Write-Host "🔐 请在浏览器中完成登录..." -ForegroundColor Cyan
flyctl auth login

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 登录失败，请重试" -ForegroundColor Red
    exit 1
}

Write-Host "✅ 登录成功" -ForegroundColor Green

# 初始化应用（如果已配置 fly.toml 则跳过）
Write-Host ""
Write-Host "⚙️  正在初始化应用..." -ForegroundColor Cyan
flyctl launch --copy-config --no-deploy --name family-chat-app

if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠️  初始化可能已完成，继续部署..." -ForegroundColor Yellow
}

# 启动部署
Write-Host ""
Write-Host "🚀 开始部署..." -ForegroundColor Cyan
flyctl deploy

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 部署失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 部署成功！" -ForegroundColor Green
Write-Host ""
Write-Host "查看应用：flyctl open" -ForegroundColor Cyan
Write-Host "查看日志：flyctl logs" -ForegroundColor Cyan
Write-Host ""