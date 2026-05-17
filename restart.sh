#!/bin/bash

# 家庭聊天应用 - 重启服务脚本

echo "================================"
echo "家庭聊天应用 - 重启服务"
echo "================================"
echo ""

# 停止现有进程
echo "🛑 停止现有服务..."
pkill -f "python.*app.py" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✓ 现有服务已停止"
else
    echo "ℹ️  没有运行中的服务"
fi

# 等待一下确保进程已停止
sleep 2

# 检查虚拟环境
if [ ! -d "venv" ]; then
    echo ""
    echo "⚠️  警告: 虚拟环境不存在"
    echo "请先运行 deploy.sh 进行部署"
    exit 1
fi

# 激活虚拟环境
echo ""
echo "🔄 激活虚拟环境..."
source venv/bin/activate

# 启动应用
echo ""
echo "🚀 启动应用服务..."
python3 app.py
