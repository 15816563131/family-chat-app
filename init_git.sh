#!/bin/bash

# 家庭聊天应用 - Git初始化脚本

echo "========================================"
echo "家庭聊天应用 - Git仓库初始化"
echo "========================================"
echo ""

# 检查git是否安装
if ! command -v git &> /dev/null; then
    echo "[错误] 未找到Git"
    echo "请先安装Git: https://git-scm.com/download"
    read -p "按回车键退出..."
    exit 1
fi

echo "[1/6] 初始化Git仓库..."
git init

echo ""
echo "[2/6] 配置用户信息..."
echo "请输入你的GitHub用户名和邮箱"
read -p "用户名: " username
read -p "邮箱: " email
git config user.name "$username"
git config user.email "$email"

echo ""
echo "[3/6] 添加所有文件到暂存区..."
git add .

echo ""
echo "[4/6] 创建初始提交..."
git commit -m "Initial commit: 家庭聊天应用

- Flask + Flask-SocketIO 实时聊天应用
- 支持用户注册登录
- 好友系统和实时消息
- 配置云端部署（Railway/Render）
- 包含部署和维护文档"

echo ""
echo "[5/6] 创建主分支..."
git branch -M main

echo ""
echo "========================================"
echo "[完成] Git仓库初始化成功！"
echo "========================================"
echo ""
echo "接下来的步骤："
echo ""
echo "1. 在GitHub创建新仓库"
echo "2. 添加远程仓库："
echo "   git remote add origin https://github.com/你的用户名/family-chat-app.git"
echo "3. 推送代码："
echo "   git push -u origin main"
echo ""
echo "然后就可以在Railway或Render上部署了！"
echo ""
read -p "按回车键退出..."
