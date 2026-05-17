# 家庭聊天软件启动脚本

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "家庭聊天软件安装和启动脚本" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 检查Python是否可用
function Test-PythonInstalled {
    try {
        $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
        if ($pythonCmd) {
            $version = & python --version 2>&1
            Write-Host "✓ Python已安装: $version" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "✗ Python未安装" -ForegroundColor Red
    }
    return $false
}

# 检查Python
if (-not (Test-PythonInstalled)) {
    Write-Host "`n正在查找Python安装程序..." -ForegroundColor Yellow
    $installer = "D:\0\python-installer.exe"
    
    if (Test-Path $installer) {
        Write-Host "找到Python安装程序,正在安装(这可能需要几分钟)..." -ForegroundColor Yellow
        Start-Process -FilePath $installer -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_pip=1" -Wait -NoNewWindow
        
        Write-Host "安装完成,正在验证..." -ForegroundColor Yellow
        Start-Sleep -Seconds 3
        
        # 刷新环境变量
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
        
        if (Test-PythonInstalled) {
            Write-Host "✓ Python安装成功!" -ForegroundColor Green
        } else {
            Write-Host "✗ Python安装验证失败,请手动安装Python" -ForegroundColor Red
            exit 1
        }
    } else {
        Write-Host "✗ 未找到Python安装程序,请手动下载安装" -ForegroundColor Red
        exit 1
    }
}

# 进入项目目录
Set-Location "D:\0"

# 创建虚拟环境
Write-Host "`n正在创建虚拟环境..." -ForegroundColor Yellow
if (-not (Test-Path ".venv")) {
    & python -m venv .venv
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 虚拟环境已创建" -ForegroundColor Green
    } else {
        Write-Host "✗ 虚拟环境创建失败" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ 虚拟环境已存在" -ForegroundColor Green
}

# 激活虚拟环境
Write-Host "正在激活虚拟环境..." -ForegroundColor Yellow
$venvActivate = "D:\0\.venv\Scripts\Activate.ps1"
if (Test-Path $venvActivate) {
    & $venvActivate
    Write-Host "✓ 虚拟环境已激活" -ForegroundColor Green
} else {
    Write-Host "✗ 无法激活虚拟环境" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host "`n正在安装依赖包..." -ForegroundColor Yellow
if (Test-Path "requirements.txt") {
    & pip install --upgrade pip
    & pip install -r requirements.txt
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ 依赖安装成功" -ForegroundColor Green
    } else {
        Write-Host "✗ 依赖安装失败" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✗ 未找到requirements.txt" -ForegroundColor Red
    exit 1
}

# 启动服务
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "正在启动家庭聊天服务..." -ForegroundColor Cyan
Write-Host "服务地址: http://localhost:8080" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 在后台启动服务
$serverScript = @"
import eventlet
eventlet.monkey_patch()

from app import app, socketio, db

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    socketio.run(app, host='0.0.0.0', port=8080, debug=False, use_reloader=False)
"@

$serverScript | Out-File -FilePath "D:\0\run_server.py" -Encoding UTF8

# 启动服务器
& python run_server.py &

# 等待服务启动
Start-Sleep -Seconds 3

# 检查服务是否运行
try {
    $response = Invoke-WebRequest -Uri "http://localhost:8080" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    if ($response.StatusCode -eq 200) {
        Write-Host "`n✓ 服务启动成功!" -ForegroundColor Green
    }
} catch {
    Write-Host "`n✗ 服务启动验证失败" -ForegroundColor Red
}

# 打开浏览器
Write-Host "`n正在打开浏览器..." -ForegroundColor Yellow
Start-Process "http://localhost:8080"

# 运行测试
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "正在运行自动化测试..." -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

& python test_chat.py

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "✓ 所有任务完成!" -ForegroundColor Green
Write-Host "服务运行地址: http://localhost:8080" -ForegroundColor Cyan
Write-Host "请在浏览器中使用聊天软件" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 保持服务运行
Write-Host "`n服务正在后台运行中,按Ctrl+C停止服务..." -ForegroundColor Yellow
