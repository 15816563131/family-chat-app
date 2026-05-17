# 🏠 家庭聊天应用

一个简洁的家庭私有聊天应用，支持实时消息、多用户和好友系统。

## ✨ 功能特点

- 🔐 **用户认证** - 安全注册和登录系统
- 💬 **实时聊天** - 基于WebSocket的即时消息
- 👥 **好友系统** - 添加、管理好友
- 📱 **响应式设计** - 支持各种设备访问
- ☁️ **云端部署** - 支持一键部署到云平台

## 🛠️ 技术栈

- **后端**: Flask + Flask-SocketIO
- **数据库**: SQLite (可切换为PostgreSQL)
- **实时通信**: WebSocket
- **部署**: Railway / Render / Docker

## 🚀 快速部署

### 方式一：Railway (推荐，免费)

1. Fork本仓库到你的GitHub
2. 访问 [Railway](https://railway.app) 并登录
3. 点击 "New Project" → "Deploy from GitHub"
4. 选择你的仓库
5. 在环境变量中设置：
   - `SECRET_KEY`: 随机密钥
   - `PORT`: 8080
6. 点击部署，等待完成！

### 方式二：Render

1. Fork本仓库
2. 访问 [Render](https://render.com)
3. 创建新的 Web Service
4. 连接GitHub仓库
5. 设置构建命令和端口
6. 部署完成！

### 方式三：本地运行

```bash
# 克隆项目
git clone <你的仓库URL>
cd family-chat-app

# 创建虚拟环境
python -m venv .venv

# 激活虚拟环境
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 运行应用
python app.py
```

访问 http://localhost:8080

## 📁 项目结构

```
family-chat-app/
├── app.py              # 主应用文件
├── requirements.txt    # Python依赖
├── templates/          # HTML模板
│   └── index.html
├── static/            # 静态资源
│   ├── style.css
│   └── chat.js
├── railway.json       # Railway配置
├── .gitignore         # Git忽略文件
└── README.md          # 项目文档
```

## 🔧 配置说明

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `SECRET_KEY` | 应用密钥 | family-chat-secret-key-2024 |
| `DATABASE_URL` | 数据库连接URL | sqlite:///family_chat.db |
| `PORT` | 服务端口 | 8080 |

### 云端部署端口

确保设置环境变量 `PORT=8080`，这是Railway/Render等平台的标准端口。

## 🔒 安全建议

1. **修改默认密钥**: 生产环境中务必更改 `SECRET_KEY`
2. **使用HTTPS**: 确保启用HTTPS加密
3. **定期备份**: 定期备份数据库文件
4. **监控日志**: 关注应用运行日志

## 📊 维护

详细的维护指南请参考 [MAINTENANCE.md](MAINTENANCE.md)

## 🤝 贡献

欢迎提交Issue和Pull Request！

## 📄 许可证

本项目仅供家庭和个人使用。
