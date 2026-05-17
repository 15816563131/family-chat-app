# 家庭聊天应用 - 维护文档

本文档提供完整的应用部署、维护和故障排除指南。

## 📋 目录

1. [云端部署指南](#云端部署指南)
2. [代码更新流程](#代码更新流程)
3. [日志查看](#日志查看)
4. [数据库备份](#数据库备份)
5. [平台配置详解](#平台配置详解)
6. [故障排除](#故障排除)

---

## ☁️ 云端部署指南

### Railway 部署 (推荐)

**Railway** 提供免费层额度，适合个人和家庭使用。

#### 步骤 1: Fork 仓库

1. 访问 GitHub 上的仓库页面
2. 点击右上角 "Fork" 按钮
3. 选择你的GitHub账户创建 fork

#### 步骤 2: 创建 Railway 项目

1. 访问 [Railway](https://railway.app)
2. 使用 GitHub 账号登录
3. 点击 "New Project" → "Deploy from GitHub repo"
4. 授权 Railway 访问你的 GitHub
5. 选择你 fork 的仓库

#### 步骤 3: 配置环境变量

在 Railway 控制台中，点击 "Variables" 标签，添加以下变量：

```
SECRET_KEY = your-random-secret-key-here
PORT = 8080
```

**生成 SECRET_KEY 的方法**：
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

#### 步骤 4: 部署

Railway 会自动检测 Python 应用并开始部署。等待 2-3 分钟即可完成。

部署成功后，Railway 会提供访问 URL，格式类似：
`https://family-chat-app.up.railway.app`

### Render 部署

**Render** 是另一个优秀的免费云平台选择。

#### 步骤 1: 创建 Web Service

1. 访问 [Render](https://render.com)
2. 登录后点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库

#### 步骤 2: 配置服务

填写以下配置：

- **Name**: `family-chat-app`
- **Region**: 选择离你最近的区域
- **Branch**: `main`
- **Root Directory**: (留空)
- **Runtime**: `Python 3`
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `python app.py`
- **Plan**: `Free`

#### 步骤 3: 设置环境变量

在 "Environment" 部分添加：

```
SECRET_KEY = your-random-secret-key-here
PORT = 8080
```

#### 步骤 4: 部署

点击 "Create Web Service"，等待部署完成。

### 端口配置

**重要**：云平台通常通过 `PORT` 环境变量指定端口。

Railway/Render 等平台会自动设置此变量，但确保你的应用使用它：

```python
import os
port = int(os.environ.get('PORT', 8080))
socketio.run(app, host='0.0.0.0', port=port)
```

当前 `app.py` 已配置为自动读取此环境变量。

---

## 🔄 代码更新流程

### 本地更新

1. 修改代码
2. 提交到 Git：
   ```bash
   git add .
   git commit -m "Update description"
   git push origin main
   ```

### 云端自动部署

将代码推送到 GitHub 后，云平台会自动：
1. 检测到新的提交
2. 拉取最新代码
3. 重新安装依赖
4. 重启应用

整个过程通常需要 2-5 分钟。

### 手动重启 (如果需要)

**Railway**:
- 在 Railway 控制台点击 "Deployments" → "Redeploy"

**Render**:
- 在 Render 控制台点击 "Manual Deploy" → "Deploy latest commit"

---

## 📊 日志查看

### 本地日志

```bash
# 查看实时日志
python app.py

# 或者重定向到文件
python app.py > app.log 2>&1
```

### Railway 日志

1. 登录 Railway 控制台
2. 选择你的项目
3. 点击 "Logs" 标签
4. 查看实时日志流

### Render 日志

1. 登录 Render 控制台
2. 选择你的 Web Service
3. 点击 "Logs" 标签
4. 支持搜索和过滤

### 日志中的重要信息

关注以下内容：
- `Client connected` - 用户连接成功
- `Client disconnected` - 用户断开连接
- 错误堆栈跟踪 - 排查问题
- 数据库操作日志

---

## 💾 数据库备份

### 本地数据库

数据库文件位置：`instance/family_chat.db`

**手动备份**：
```bash
# 复制数据库文件
cp instance/family_chat.db instance/family_chat_backup_$(date +%Y%m%d).db
```

**使用备份脚本**：
```bash
# 创建备份目录
mkdir -p backups

# 备份
cp instance/family_chat.db backups/backup_$(date +%Y%m%d_%H%M%S).db
```

### 云端数据库

Railway 和 Render 都提供持久化存储。

**Railway**:
- 数据自动持久化
- 可在 Settings 中查看存储信息

**Render**:
- 免费层的磁盘不是永久性的
- 建议：定期使用数据库导出功能

### 导出数据库 (Python脚本)

创建 `export_db.py`：

```python
import sqlite3
import json
from datetime import datetime

def export_database():
    conn = sqlite3.connect('instance/family_chat.db')
    cursor = conn.cursor()
    
    # 导出所有表
    tables = ['user', 'message', 'friendship', 'friend_request']
    export_data = {}
    
    for table in tables:
        cursor.execute(f"SELECT * FROM {table}")
        columns = [description[0] for description in cursor.description]
        rows = cursor.fetchall()
        export_data[table] = {
            'columns': columns,
            'rows': [list(row) for row in rows]
        }
    
    # 保存为JSON
    filename = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    with open(filename, 'w', encoding='utf-8') as f:
        json.dump(export_data, f, ensure_ascii=False, indent=2)
    
    print(f"数据库已导出到: {filename}")
    conn.close()

if __name__ == '__main__':
    export_database()
```

运行：
```bash
python export_db.py
```

### 恢复数据库

```bash
# 停止应用
pkill -f "python.*app.py"

# 备份当前数据库
mv instance/family_chat.db instance/family_chat_old.db

# 恢复备份
cp backups/backup_xxx.db instance/family_chat.db

# 重启应用
python app.py
```

---

## 🔧 平台配置详解

### Railway 配置文件

`railway.json` 包含以下配置：

```json
{
  "build": {
    "builder": "NIXPACKS",    // 使用NIXPACKS构建器
    "nixpacks": {
      "image": "python_3.12", // Python版本
      "install": ["pip install -r requirements.txt"]
    }
  },
  "deploy": {
    "numReplicas": 1,         // 副本数
    "restartPolicyType": "OnFailure",  // 重启策略
    "startCommand": "python app.py"    // 启动命令
  }
}
```

### 环境变量说明

| 变量名 | 必须 | 默认值 | 说明 |
|--------|------|--------|------|
| `SECRET_KEY` | 是 | - | Flask应用密钥，用于会话加密 |
| `DATABASE_URL` | 否 | sqlite | 数据库连接字符串 |
| `PORT` | 否 | 8080 | 应用监听端口 |
| `FLASK_ENV` | 否 | production | 运行环境 |

### 安全建议

1. **SECRET_KEY**：
   - 生产环境必须设置
   - 使用随机字符串，至少32字符
   - 定期更换

2. **数据库**：
   - SQLite适合小规模应用
   - 用户量大时可切换到PostgreSQL

3. **HTTPS**：
   - Railway/Render 自动提供 HTTPS
   - 确保强制使用 HTTPS

---

## 🐛 故障排除

### 常见问题

#### 1. 应用无法启动

**症状**：部署后显示错误

**排查步骤**：
1. 检查构建日志
2. 确认 `requirements.txt` 格式正确
3. 验证 `app.py` 无语法错误
4. 检查端口配置

**解决方案**：
```bash
# 本地测试
python app.py

# 检查依赖
pip install -r requirements.txt
```

#### 2. WebSocket 连接失败

**症状**：消息无法实时接收

**排查步骤**：
1. 检查浏览器控制台错误
2. 确认 CORS 配置正确
3. 检查网络连接

**解决方案**：
当前配置已启用 CORS，如仍有问题：
```python
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')
```

#### 3. 数据库错误

**症状**：`Database error` 或连接失败

**排查步骤**：
1. 确认数据库文件存在
2. 检查文件权限
3. 验证 DATABASE_URL 配置

**解决方案**：
```bash
# 重新初始化数据库
rm instance/family_chat.db
python app.py  # 会自动创建
```

⚠️ **警告**：这会删除所有数据！

#### 4. 内存不足 (Railway)

**症状**：`Memory limit exceeded`

**解决方案**：
- Railway 免费层限制 512MB RAM
- 减少并发连接数
- 优化代码

#### 5. 构建超时

**症状**：部署时间过长

**解决方案**：
- 简化 requirements.txt
- 使用预编译的依赖
- 检查网络连接

### 性能优化

#### 减少内存使用

1. 使用 eventlet 作为异步引擎
2. 限制 WebSocket 连接数
3. 优化数据库查询

#### 加快部署速度

1. 使用缓存的依赖
2. 减少 requirements.txt 中的包
3. 使用更小的 Python 基础镜像

### 联系支持

- **Railway**: 通过控制台的 "Help" 获取支持
- **Render**: 访问 [Render Status](https://status.render.com)

---

## 📞 监控和维护清单

### 日常维护

- [ ] 检查应用是否正常运行
- [ ] 查看错误日志
- [ ] 监控用户活跃度

### 每周维护

- [ ] 备份数据库
- [ ] 检查存储使用情况
- [ ] 更新依赖（谨慎操作）

### 每月维护

- [ ] 审查安全配置
- [ ] 清理旧日志
- [ ] 评估性能指标

---

## 🔒 安全检查清单

- [ ] 修改默认 SECRET_KEY
- [ ] 启用 HTTPS
- [ ] 限制管理访问
- [ ] 定期备份数据
- [ ] 监控异常访问
- [ ] 更新依赖包

---

## 📚 资源链接

- [Flask 文档](https://flask.palletsprojects.com/)
- [Flask-SocketIO 文档](https://flask-socketio.readthedocs.io/)
- [Railway 文档](https://docs.railway.app/)
- [Render 文档](https://render.com/docs)
- [GitHub Actions](https://docs.github.com/actions)

---

## ❓ 常见问题 FAQ

**Q: 可以使用自己的域名吗？**
A: 是的，Railway 和 Render 都支持自定义域名。

**Q: 免费层有什么限制？**
A:
- Railway: 500小时/月，512MB RAM
- Render: 750小时/月，免费过期后自动暂停

**Q: 如何扩展到更多用户？**
A: 升级到付费层，或切换到数据库服务（如 Railway PostgreSQL）

**Q: 数据安全性如何？**
A: 云平台提供基础安全，建议：
- 使用 HTTPS
- 设置强密码
- 定期备份

---

如有问题，请提交 GitHub Issue 或联系维护者。
