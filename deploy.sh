#!/bin/bash

# 家庭聊天应用 - 本地部署脚本

echo "================================"
echo "家庭聊天应用 - 本地部署"
echo "================================"
echo ""

# 检查Python环境
if ! command -v python3 &> /dev/null; then
    echo "❌ 错误: 未找到Python3"
    echo "请先安装Python 3.8或更高版本"
    exit 1
fi

echo "✓ Python版本: $(python3 --version)"

# 创建虚拟环境
if [ ! -d "venv" ]; then
    echo ""
    echo "📦 创建虚拟环境..."
    python3 -m venv venv
    
    if [ $? -ne 0 ]; then
        echo "❌ 虚拟环境创建失败"
        exit 1
    fi
    echo "✓ 虚拟环境创建成功"
fi

# 激活虚拟环境
echo ""
echo "🔄 激活虚拟环境..."
source venv/bin/activate

# 安装依赖
echo ""
echo "📥 安装依赖包..."
pip install --upgrade pip
pip install -r requirements.txt

if [ $? -ne 0 ]; then
    echo "❌ 依赖安装失败"
    exit 1
fi
echo "✓ 依赖安装成功"

# 检查数据库
echo ""
echo "🗄️  检查数据库..."
if [ ! -f "instance/family_chat.db" ]; then
    echo "📝 初始化数据库..."
    python3 -c "from app import app, db; app.app_context().push(); db.create_all()"
    echo "✓ 数据库初始化成功"
else
    echo "✓ 数据库已存在"
fi

# 启动应用
echo ""
echo "================================"
echo "🎉 部署完成！"
echo "================================"
echo ""
echo "启动应用: python app.py"
echo "访问地址: http://localhost:8080"
echo ""
echo "按 Ctrl+C 停止服务"
echo ""

python3 app.py
