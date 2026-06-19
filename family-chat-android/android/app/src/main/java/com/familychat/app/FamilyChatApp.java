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

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "FamilyChatApp onCreate - Application started");
        createNotificationChannel();
        // 不提前创建 WebView，由 MainActivity 在需要时创建
        // 但提前启动前台服务以保持进程存活
        ensureForegroundServiceRunning();
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
