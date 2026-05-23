
# Railway部署指南

Railway是一个简单易用的云平台，完全免费且支持Python Flask应用。

## 前提条件
- 一个GitHub账号（虽然我们不直接用GitHub部署，但需要它登录Railway）
- 您的项目代码已准备好

## 步骤1：访问Railway
1. 打开浏览器，访问 https://railway.app
2. 点击 "Start New Project" 或 "Login"
3. 使用GitHub账号登录

## 步骤2：创建新项目
1. 登录后，点击 "New Project"
2. 选择 "Empty Project"（空项目）
3. 给项目起个名字，比如 "family-chat"

## 步骤3：部署应用
1. 在项目页面，点击 "+ Add" 或 "Add a Service"
2. 选择 "GitHub Repo"（如果您能访问GitHub）或者 "Deploy from CLI"（推荐）

### 方法A：使用CLI部署（推荐，无需GitHub）

1. **安装Railway CLI**
   - Windows：打开PowerShell，运行：
     ```powershell
     iwr https://railway.app/install.ps1 -useb | iex
     ```
   - 或者下载安装：https://docs.railway.app/getting-started/quick-start

2. **登录CLI**
   ```bash
   railway login
   ```
   这会打开浏览器进行登录

3. **初始化项目**
   在项目目录（`d:\0`）打开终端，运行：
   ```bash
   cd d:\0
   railway init
   ```
   选择刚才创建的项目

4. **部署**
   ```bash
   railway up
   ```

### 方法B：使用GitHub（如果能访问）

1. 将代码推送到GitHub仓库
2. 在Railway中连接GitHub仓库
3. 选择要部署的仓库和分支
4. 配置部署设置

## 步骤4：配置环境变量
1. 在Railway服务页面，点击 "Variables"
2. 添加以下变量：
   ```
   FLASK_APP=app.py
   FLASK_ENV=production
   ```

## 步骤5：配置端口
Railway会自动分配端口，确保您的应用监听 `0.0.0.0` 和环境变量 `PORT`。我们的 `app.py` 已经配置好了：

```python
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    socketio.run(app, host='0.0.0.0', port=port, debug=False)
```

## 步骤6：获取访问地址
1. 部署完成后，在Railway服务页面
2. 点击 "Settings" → "Domains"
3. 您会看到一个类似 `https://xxx.up.railway.app` 的地址
4. 这就是您的聊天应用的公网地址！

## 优势
✅ 完全免费（有额度限制，但足够家庭使用）
✅ 24/7持续运行
✅ 自动HTTPS
✅ 简单易用
✅ 支持实时更新

## 更新代码
当您修改代码后，只需在项目目录运行：
```bash
railway up
```
Railway会自动重新部署！

## 需要帮助？
- Railway文档：https://docs.railway.app
- 如果遇到问题，随时告诉我！
