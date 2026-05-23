# 🐍 PythonAnywhere 部署指南（无需 GitHub）

## 什么是 PythonAnywhere？
PythonAnywhere 是一个专门针对 Python 优化的免费托管平台，**非常稳定**，24小时持续运行，不需要开电脑！

---

## ✅ 优点
- ✅ **完全免费**
- ✅ **无需 GitHub**
- ✅ **专门为 Python 设计**
- ✅ **持久化数据库**
- ✅ **稳定不频繁休眠**（免费版只需要每3个月点一下续签）

---

## 📱 详细部署步骤

### 第 1 步：注册账号（2分钟）
1. 打开浏览器访问：**https://www.pythonanywhere.com**
2. 点击右上角的 **"Pricing"** → 往下滚动，找到 **"Create a Beginner account"**（免费版）
3. 填写用户名、邮箱、密码注册
4. 验证邮箱后，登录账号！

### 第 2 步：上传代码（10分钟）
登录后，你会看到仪表板。

#### 2.1 创建文件和文件夹
1. 在顶部点击 **"Files"** 标签
2. 你会看到你的文件列表
3. 创建必要的文件夹和文件：

**首先创建文件夹：**
- 点击 **"New directory"**（新建目录），输入：`templates` → 回车
- 再次点击 **"New directory"**，输入：`static` → 回车

**然后创建文件：**

| 文件名 | 在哪里创建 | 内容来源 |
|--------|-----------|---------|
| `app.py` | 根目录（直接在主页面） | 从 D:\0\app.py 复制全部内容 |
| `requirements.txt` | 根目录 | 从 D:\0\requirements.txt 复制全部内容 |
| `templates/index.html` | 在 templates 文件夹里 | 从 D:\0\templates\index.html 复制 |
| `static/style.css` | 在 static 文件夹里 | 从 D:\0\static\style.css 复制 |
| `static/chat.js` | 在 static 文件夹里 | 从 D:\0\static\chat.js 复制 |

**创建文件方法：**
1. 点击文件列表上方的 **"New file"**（新建文件）
2. 输入文件名（比如 `app.py`）
3. 在编辑区粘贴从 D:\0 对应文件复制的全部内容
4. 点击右上角的 **"Save"** 按钮保存！

### 第 3 步：创建 Web 应用（5分钟）
1. 点击顶部的 **"Web"** 标签
2. 点击 **"Add a new web app"**（添加新 Web 应用）
3. 点击 **"Next"** 继续
4. 选择 **"Flask"** 作为 Web 框架
5. 选择 **"Python 3.10"**（或者最新版本）
6. **重要**：在路径那里选择 **"Manual configuration"**（手动配置）
7. 点击 **"Next"** 直到完成

### 第 4 步：配置 Web 应用（5分钟）
在 Web 标签页面，往下滚动，找到 **"Code"** 部分：

#### 4.1 设置源代码路径
- 在 "Source code"（源代码）那里，输入：`/home/你的用户名/app.py`
（把"你的用户名"换成你注册时的用户名）

#### 4.2 打开虚拟环境控制台
- 在 "Virtualenv"（虚拟环境）那里，点击链接：`/home/你的用户名/.virtualenvs/myvirtualenv`
- 这会打开一个控制台窗口

#### 4.3 安装依赖
在虚拟环境控制台中，输入以下命令并回车：
```
pip install flask flask-socketio flask-sqlalchemy flask-cors python-socketio eventlet
```
等待安装完成（1-2分钟）

#### 4.4 修改 WSGI 文件
回到 Web 标签页面，点击 "WSGI configuration file"（WSGI 配置文件）链接，把内容替换成：
```python
import sys
import os

path = '/home/你的用户名'
if path not in sys.path:
    sys.path.append(path)

from app import app as application
```
注意把"你的用户名"换成你实际的用户名！保存文件！

### 第 5 步：启动应用！
回到 Web 标签页面，点击上方的绿色 **"Reload"** 按钮！

几秒钟后，你的应用就上线了！你的网址是：
```
https://你的用户名.pythonanywhere.com
```

---

## 🔧 每3个月续签（重要！）
PythonAnywhere 免费版需要**每3个月手动续签一次**（只需要点一下！）：
1. 登录 PythonAnywhere
2. 如果有提示，点击"续签"或"延长"按钮
3. 只需要点一下，不用付费！

---

## 📱 完成后
你的应用网址是：`https://你的用户名.pythonanywhere.com`
这个网址可以在任何设备上访问，不需要开你的电脑！

---

## 💡 提示
- 如果在操作过程中遇到问题，随时来问我！
- 确保所有文件内容都复制完整！
- 保存文件时记得点击 "Save" 按钮！
