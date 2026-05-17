# 🚀 一键部署指南

## 家庭聊天应用 - 快速部署到云端

---

## 📋 部署前准备

### 1. 安装必要工具

**Git** (如果未安装):
- 下载地址: https://git-scm.com/download/win
- 安装时选择 "Git Bash Here" 选项

**Python 3.8+**:
- 下载地址: https://www.python.org/downloads/

---

## 🎯 快速部署步骤 (推荐)

### 方式一：Windows 用户（最简单）

1. **打开文件夹**
   打开 `D:\0` 文件夹

2. **运行Git初始化**
   双击运行 `init_git.bat`
   - 输入你的GitHub用户名
   - 输入你的GitHub邮箱

3. **创建GitHub仓库**
   - 访问 https://github.com
   - 点击右上角 "+" → "New repository"
   - Repository name: `family-chat-app`
   - 选择 "Private" (私有) 或 "Public" (公开)
   - 点击 "Create repository"

4. **连接并推送代码**
   在 `D:\0` 文件夹中，右键选择 "Git Bash Here"，然后运行：
   ```bash
   # 替换为你实际的GitHub用户名
   git remote add origin https://github.com/你的用户名/family-chat-app.git
   git push -u origin main
   ```

5. **部署到Railway**
   - 访问 https://railway.app
   - 使用GitHub登录
   - 点击 "New Project" → "Deploy from GitHub"
   - 选择 `family-chat-app` 仓库
   - Railway会自动检测并部署

6. **配置环境变量**
   在Railway控制台：
   - 点击 "Variables"
   - 添加 `SECRET_KEY`，值为随机字符串
     ```bash
     # 生成随机密钥
     python -c "import secrets; print(secrets.token_hex(32))"
     ```
   - 确认 `PORT = 8080` (Railway自动设置)

7. **完成！**
   等待2-3分钟，Railway会提供访问URL

### 方式二：命令行用户

```bash
# 1. 初始化Git
./init_git.sh

# 2. 创建GitHub仓库并添加远程
git remote add origin https://github.com/你的用户名/family-chat-app.git
git push -u origin main

# 3. 在Railway部署
# 访问 railway.app 创建项目并连接GitHub
```

---

## ☁️ Railway 部署详细配置

### 必需环境变量

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `SECRET_KEY` | `your-secret-key-here` | 使用 `python -c "import secrets; print(secrets.token_hex(32))"` 生成 |
| `PORT` | `8080` | Railway会自动设置 |

### Railway 控制台配置

1. **Variables 设置**
   - SECRET_KEY = `abc123def456...` (32位随机字符串)
   - PORT = `8080`

2. **Settings**
   - Region: 选择亚太或最近区域
   - Branch: `main`

3. **Deployments**
   - 每次推送到GitHub会自动触发部署
   - 可以手动点击 "Redeploy" 重启

---

## 🔄 更新代码

### 本地更新后推送到云端

```bash
# 1. 提交更改
git add .
git commit -m "Your update message"
git push origin main

# 2. Railway会自动检测并重新部署
```

### Railway手动重启

如果推送后未自动部署：
1. 登录 Railway 控制台
2. 选择项目 → Deployments
3. 点击 "Redeploy"

---

## 💾 数据库备份

### 本地备份

```bash
# 创建备份目录
mkdir backups

# 备份数据库
cp instance/family_chat.db backups/backup_$(date +%Y%m%d).db

# 查看备份
ls -lh backups/
```

### 查看数据库

使用 SQLite 命令行：
```bash
sqlite3 instance/family_chat.db

# 在sqlite3中查看表：
.tables

# 查看用户：
SELECT * FROM user;

# 退出：
.exit
```

---

## 🐛 故障排除

### 应用无法启动

**检查日志**:
1. Railway: 控制台 → Logs
2. 本地: 运行 `python app.py` 查看输出

**常见错误**:
- `ModuleNotFoundError`: 运行 `pip install -r requirements.txt`
- `Port already in use`: 停止其他服务或改端口

### WebSocket连接失败

1. 检查浏览器控制台是否有错误
2. 确认网络连接正常
3. 尝试刷新页面

### 数据库错误

```bash
# 如果数据库损坏，删除重建（会丢失数据！）
rm instance/family_chat.db
python app.py  # 会自动重建
```

---

## 📞 获取帮助

### 相关文档

- 详细维护指南: [MAINTENANCE.md](MAINTENANCE.md)
- 项目说明: [README.md](README.md)

### 技术支持

- Flask文档: https://flask.palletsprojects.com/
- Railway文档: https://docs.railway.app/
- GitHub: 创建Issue获取帮助

---

## ✅ 部署检查清单

部署完成后，确认以下项目：

- [ ] 应用可以访问（显示聊天界面）
- [ ] 可以注册新用户
- [ ] 可以登录
- [ ] 可以发送消息
- [ ] 消息可以实时接收
- [ ] 数据库正常保存数据

---

## 🎉 恭喜！

你的家庭聊天应用已成功部署到云端！

现在你可以：
- 通过URL访问应用
- 与家人分享URL
- 开始聊天！

---

**提示**: 
- 定期备份数据库 `instance/family_chat.db`
- 关注 Railway 用量（免费额度500小时/月）
- 代码更新只需推送到GitHub，自动部署

祝使用愉快！ 🎊
