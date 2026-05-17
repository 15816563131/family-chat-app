#!/bin/bash

# 家庭聊天应用 - 更新并重新部署脚本

echo "================================"
echo "家庭聊天应用 - 更新部署"
echo "================================"
echo ""

# 检查Git
if ! command -v git &> /dev/null; then
    echo "❌ 错误: 未找到Git"
    echo "请先安装Git"
    exit 1
fi

echo "✓ Git版本: $(git --version)"

# 拉取最新代码
echo ""
echo "📥 拉取最新代码..."
git pull origin main

if [ $? -ne 0 ]; then
    echo "❌ 代码更新失败"
    echo "可能存在冲突，请手动解决"
    exit 1
fi
echo "✓ 代码更新成功"

# 激活虚拟环境并安装新依赖
echo ""
echo "🔄 更新依赖包..."
source venv/bin/activate
pip install -r requirements.txt

if [ $? -ne 0 ]; then
    echo "❌ 依赖更新失败"
    exit 1
fi
echo "✓ 依赖更新成功"

# 重启应用
echo ""
echo "🔄 重启应用服务..."
echo ""

# 停止现有进程（如果存在）
pkill -f "python.*app.py" 2>/dev/null

# 等待一下确保进程已停止
sleep 2

# 启动新应用
python3 app.py
