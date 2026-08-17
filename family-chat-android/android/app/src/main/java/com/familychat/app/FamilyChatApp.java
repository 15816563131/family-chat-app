package com.familychat.app;

import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.core.app.NotificationCompat;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.FileWriter;
import java.io.StringWriter;
import java.io.PrintWriter;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicBoolean;

public class FamilyChatApp extends Application {

    public static final String WEB_URL = "https://family-chat-app-production-93b6.up.railway.app";
    public static final String TAG = "FamilyChat";
    public static final String PREFS_NAME = "FamilyChatPrefs";
    public static final String KEY_USER_ID = "userId";

    public static volatile WebView sharedWebView = null;
    public static volatile Object sharedWebViewLock = new Object();
    public static volatile boolean webViewLoaded = false;
    public static volatile MessagePollService pollService = null;
    public static volatile boolean isAppForeground = false;
    public static volatile long lastForegroundTime = 0;
    public static volatile long lastMessageTime = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "FamilyChatApp onCreate - Application started");
        // 安装全局崩溃捕获器
        installCrashHandler();
        createNotificationChannel();
        // 不提前创建 WebView，由 MainActivity 在需要时创建
        // 但提前启动前台服务以保持进程存活
        ensureForegroundServiceRunning();
    }

    /** 应用内崩溃日志目录 */
    public static File getCrashLogDir(Context context) {
        File dir = new File(context.getFilesDir(), "crash_logs");
        if (!dir.exists()) dir.mkdirs();
        return dir;
    }

    /** 全局未捕获异常处理器 — 将崩溃写入文件 */
    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler defaultHandler = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                String timestamp = new SimpleDateFormat("yyyy-MM-dd_HH-mm-ss", Locale.US)
                        .format(new Date());
                File crashFile = new File(getCrashLogDir(this),
                        "crash_" + timestamp + ".txt");

                StringWriter sw = new StringWriter();
                PrintWriter pw = new PrintWriter(sw);
                pw.println("=== FamilyChat Crash Report ===");
                pw.println("Time: " + new Date().toString());
                pw.println("Device: " + Build.MANUFACTURER + " " + Build.MODEL);
                pw.println("Android: " + Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
                pw.println("Thread: " + thread.getName() + " (id=" + thread.getId() + ")");
                pw.println("=== Exception ===");
                throwable.printStackTrace(pw);
                pw.println("=== Cause ===");
                if (throwable.getCause() != null) {
                    throwable.getCause().printStackTrace(pw);
                }
                pw.close();

                FileWriter fw = new FileWriter(crashFile);
                fw.write(sw.toString());
                fw.close();

                Log.e(TAG, "Crash written to: " + crashFile.getAbsolutePath());
            } catch (Exception e) {
                Log.e(TAG, "Failed to write crash log", e);
            } finally {
                // 仍然交给默认处理器（弹出系统崩溃对话框或重启）
                if (defaultHandler != null) {
                    defaultHandler.uncaughtException(thread, throwable);
                }
            }
        });
    }

    /** 读取最近的崩溃日志文本（最多 3 条） */
    public static String getRecentCrashLogs(Context context) {
        File dir = getCrashLogDir(context);
        File[] files = dir.listFiles((d, name) -> name.endsWith(".txt"));
        if (files == null || files.length == 0) return "";

        // 按修改时间降序排序
        java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));

        StringBuilder sb = new StringBuilder();
        int count = 0;
        for (File f : files) {
            if (count >= 3) break;
            sb.append("--- ").append(f.getName()).append(" ---\n");
            try (BufferedReader br = new BufferedReader(new FileReader(f))) {
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line).append('\n');
                }
            } catch (Exception e) {
                sb.append("(read error: ").append(e.getMessage()).append(")\n");
            }
            sb.append('\n');
            count++;
        }
        return sb.toString();
    }

    public static WebView getOrCreateWebView(Context context) {
        synchronized (sharedWebViewLock) {
            if (sharedWebView == null) {
                Log.d(TAG, "Creating persistent shared WebView");
                WebView webView = new WebView(context.getApplicationContext());
                setupSharedWebView(webView, context);
                sharedWebView = webView;
                // 异步加载 URL，避免阻塞主线程
                webView.post(() -> {
                    webView.loadUrl(WEB_URL);
                });
            }
            return sharedWebView;
        }
    }

    private static void setupSharedWebView(WebView webView, Context context) {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setGeolocationEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NARROW_COLUMNS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            settings.setAllowUniversalAccessFromFileURLs(true);
        }
        settings.setDatabaseEnabled(true);
    }

    public static boolean isWebViewReady() {
        return sharedWebView != null && webViewLoaded;
    }

    public static void detachWebViewFromParent(WebView webView) {
        if (webView != null && webView.getParent() != null) {
            try {
                android.view.ViewGroup parent = (android.view.ViewGroup) webView.getParent();
                parent.removeView(webView);
                Log.d(TAG, "WebView detached from parent");
            } catch (Exception e) {
                Log.w(TAG, "Failed to detach WebView: " + e.getMessage());
            }
        }
    }

    private void ensureForegroundServiceRunning() {
        try {
            Intent serviceIntent = new Intent(this, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            Log.d(TAG, "Application: ForegroundService start requested");
        } catch (Exception e) {
            Log.e(TAG, "Application startForegroundService failed: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager notificationManager = getSystemService(NotificationManager.class);
                if (notificationManager != null) {
                    NotificationChannel channel = new NotificationChannel(
                            "family_chat_channel", "消息通知",
                            NotificationManager.IMPORTANCE_HIGH);
                    channel.setDescription("新消息提醒");
                    channel.enableVibration(true);
                    notificationManager.createNotificationChannel(channel);

                    NotificationChannel fgChannel = new NotificationChannel(
                            "family_chat_foreground", "后台服务",
                            NotificationManager.IMPORTANCE_LOW);
                    fgChannel.setDescription("后台运行保持连接");
                    notificationManager.createNotificationChannel(fgChannel);

                    NotificationChannel callChannel = new NotificationChannel(
                            "family_chat_calls", "通话通知",
                            NotificationManager.IMPORTANCE_HIGH);
                    callChannel.setDescription("语音/视频通话");
                    callChannel.enableVibration(true);
                    notificationManager.createNotificationChannel(callChannel);
                }
            } catch (Exception e) {
                Log.w(TAG, "Notification channels may already exist: " + e.getMessage());
            }
        }
    }
}
