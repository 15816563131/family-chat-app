# 家庭聊天应用 - 云端部署指南

## 🚀 快速部署（推荐方案）

### 第一步：推送代码到GitHub

#### 1.1 初始化Git仓库
双击运行 `init_git.bat` 或在终端运行：
```bash
cd D:\0
git init
git add .
git commit -m "Initial commit: 家庭聊天应用"
```

#### 1.2 创建GitHub仓库
1. 访问 https://github.com 并登录
2. 点击右上角 "+" → "New repository"
3. 仓库名称填写：`family-chat-app`
4. 选择 "Private"（私有）或 "Public"（公开）
5. 点击 "Create repository"

#### 1.3 推送代码
在终端运行（替换为你的GitHub用户名）：
```bash
git remote add origin https://github.com/你的GitHub用户名/family-chat-app.git
git branch -M main
git push -u origin main
```

---

### 第二步：部署到Railway（推荐 - 免费）

Railway 提供免费的部署额度，支持持续运行。

#### 2.1 连接GitHub
1. 访问 https://railway.app
2. 点击 "Login" → 使用 GitHub 登录
3. 授权 Railway 访问你的 GitHub

#### 2.2 创建项目
1. 在 Railway 面板点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 选择 `family-chat-app` 仓库
4. Railway 会自动检测并部署

#### 2.3 配置环境变量
1. 在项目设置中找到 "Variables"
2. 点击 "New Variable" 添加：
   - `SECRET_KEY` = `python -c "import secrets; print(secrets.token_hex(32))"` 生成的随机字符串
   - `PORT` = `8080`

#### 2.4 获取访问地址
部署完成后，Railway 会提供类似 `https://family-chat-app.up.railway.app` 的URL，这就是你的应用地址！

---

### 第三步：部署到 Render（备选方案）

Render 也提供免费的持续运行服务。

#### 3.1 创建 Web Service
1. 访问 https://render.com
2. 使用 GitHub 登录
3. 点击 "New" → "Web Service"
4. 连接你的 `family-chat-app` 仓库

#### 3.2 配置设置
- **Root Directory**: `/`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `gunicorn app:app --worker-class eventlet -w 1 --bind :$PORT`
- **Plan**: Free

#### 3.3 添加环境变量
在 Dashboard 添加：
- `SECRET_KEY`: 随机密钥
- `DATABASE_URL`: `sqlite:///instance/family_chat.db`

---

## 🔄 代码更新流程

### 本地更新代码
```bash
cd D:\0
# 编辑你的代码...

# 提交更改
git add .
git commit -m "更新描述"
git push origin main
# Railway/Render 会自动检测到更新并重新部署
```

### 强制重启
如果自动部署没有触发，可以在 Railway/Render 面板手动点击 "Redeploy"。

---

## 🛡️ 数据备份

### 自动备份（Railway）
Railway 的免费版不提供自动备份，建议：
1. 定期通过 Railway 的 CLI 导出数据库
2. 或者在本地保留数据副本

### 手动备份
```bash
# 连接到 Railway 容器
railway run python

# 在Python shell中
from app import db
from sqlalchemy import create_engine
engine = create_engine('sqlite:///instance/family_chat.db')
# 导出数据...
```

---

## 🔧 维护命令

### 查看日志（Railway CLI）
```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 链接项目
railway link

# 查看日志
railway logs
```

### 重启服务
```bash
railway up --detach
```

---

## 📊 监控和故障排除

### 查看应用状态
- Railway: https://railway.app/dashboard
- Render: https://render.com/dashboard

### 常见问题

#### 1. 部署失败
- 检查 `requirements.txt` 是否正确
- 查看构建日志定位错误
- 确保 Python 版本兼容（3.8+）

#### 2. WebSocket 不工作
- 确保云平台支持 WebSocket（Railway/Render 都支持）
- 检查 CORS 配置是否正确

#### 3. 数据库丢失
- Railway 免费版的文件系统不是持久化的！
- **重要**: 考虑升级到付费版或使用 PostgreSQL

---

## 💡 推荐的生产环境配置

### Railway Pro (推荐)
- $5/月 起
- 持久化磁盘存储
- 自定义域名
- 自动备份

### Render Starter
- 免费额度：750小时/月
- 休眠后需要30秒唤醒
- 适合低流量应用

### Railway Hobby ($5/月)
- 512MB RAM
- 持久化存储
- 不休眠
- 适合家庭/小型应用

---

## 🎯 下一步

1. 完成 GitHub 推送
2. 部署到 Railway
3. 测试完整功能
4. 配置自定义域名（可选）

现在你的应用已经准备好在云端运行了！🎉
