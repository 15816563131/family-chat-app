# 家庭聊天 Android 应用项目

## 快速开始

### 方法1：使用 Android Studio 打开并构建（推荐）

1. **安装 Android Studio**
   - 下载地址：https://developer.android.com/studio
   - 安装时选择 "Custom" 安装，勾选：
     - Android SDK
     - Android Virtual Device

2. **打开项目**
   - 启动 Android Studio
   - 选择 "Open an existing project"
   - 选择 `D:\family-chat-android\android` 文件夹

3. **等待 Gradle 同步完成**
   - 首次打开会下载依赖，请耐心等待（约5-10分钟）

4. **构建 APK**
   - 点击菜单：Build → Build Bundle(s) / APK(s) → Build APK(s)
   - 等待构建完成
   - 在右下角通知中点击 "locate" 查看 APK 文件

### 方法2：使用命令行构建

```bash
cd D:\family-chat-android\android
.\gradlew assembleDebug
```

APK 文件会在 `app\build\outputs\apk\debug\app-debug.apk`

---

## 项目说明

本项目使用 WebView 将你的聊天网站包装成 Android 应用：

- **网址**: https://family-chat-app-production-93b6.up.railway.app
- **应用包名**: com.familychat.app
- **应用名称**: 家庭聊天

### 主要功能

- ✅ 全屏显示，无浏览器地址栏
- ✅ 支持系统通知
- ✅ 后台运行能力
- ✅ 保留所有聊天功能
- ✅ 实时消息推送
- ✅ 好友系统
- ✅ 黑名单功能

---

## 项目结构

```
android/
├── app/
│   └── src/
│       └── main/
│           ├── java/com/familychat/app/
│           │   └── MainActivity.java    # 主界面
│           └── res/
│               └── drawable/
│                   └── icon.png          # 应用图标
├── build.gradle                          # 项目配置
├── settings.gradle                       # Gradle 设置
└── gradle.properties                    # Gradle 属性
```

---

## 常见问题

### Q: Gradle 下载失败？
A: 中国大陆用户建议配置国内镜像。在 `build.gradle` 中添加：

```groovy
maven { url 'https://maven.aliyun.com/repository/google' }
maven { url 'https://maven.aliyun.com/repository/public' }
```

### Q: Android SDK 找不到？
A: 确保 ANDROID_HOME 环境变量已设置。路径示例：
- `C:\Users\用户名\AppData\Local\Android\Sdk`

### Q: 构建太慢？
A: 首次构建需要下载大量依赖，后续会快很多。建议保持网络连接。

---

## 安装 APK 到手机

1. 将生成的 `app-debug.apk` 文件复制到手机
2. 打开手机设置 → 安全 → 允许安装未知来源应用
3. 点击 APK 文件进行安装
4. 打开应用即可使用

---

## 技术支持

如果遇到问题，请检查：
1. Android Studio 版本是否最新
2. Gradle 版本是否兼容
3. Android SDK 是否完整安装
4. 网络连接是否稳定
