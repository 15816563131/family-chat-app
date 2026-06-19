package com.familychat.app;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {

    private static final String TAG = "FamilyChat";
    private static final String WEB_URL = "https://family-chat-app-production-93b6.up.railway.app";
    private static final int POST_NOTIFICATIONS_REQUEST_CODE = 1002;
    private static final int SMS_PERMISSION_REQUEST_CODE = 1003;
    private static final int BATTERY_OPTIMIZATION_REQUEST_CODE = 1004;
    private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1005;
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1006;
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1007;

    private FrameLayout webViewContainer;
    private WebView webView;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private Handler keepAliveHandler;
    private Runnable keepAliveRunnable;
    private boolean keepAliveRunning = false;
    private MessagePollService pollService;
    private WebAppInterface webAppInterface;
    private boolean isFirstStart = true;
    private static Context appContext = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        appContext = getApplicationContext();
        Log.d(TAG, "=== MainActivity onCreate ===");

        // 创建容器
        webViewContainer = new FrameLayout(this);
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT);
        webViewContainer.setLayoutParams(params);
        setContentView(webViewContainer);

        // 获取或创建持久化 WebView
        webView = FamilyChatApp.getOrCreateWebView(this);
        isFirstStart = !FamilyChatApp.webViewLoaded;

        // 从旧父 View 分离 WebView（如果有）
        FamilyChatApp.detachWebViewFromParent(webView);

        // 添加到当前 Activity
        webViewContainer.addView(webView, params);

        // 设置 WebView 桥接（如果还没设置）
        if (webAppInterface == null) {
            webAppInterface = new WebAppInterface();
            webView.addJavascriptInterface(webAppInterface, "AndroidBridge");
        }

        // 设置 WebView 客户端（只在第一次创建时设置）
        if (isFirstStart) {
            setupWebViewClients();
            createNotificationChannel();
            requestNotificationPermission();
            requestAllPermissions();
            startForegroundService();
        }

        // 启动轮询服务
        if (pollService == null) {
            pollService = new MessagePollService(this);
        }

        // 获取锁
        acquireWakeLocks();

        // 启动 WebView 保活机制
        startKeepAlive();

        // 启动前台服务
        ensureForegroundServiceRunning();

        Log.d(TAG, "WebView ready, isFirstStart=" + isFirstStart);
    }

    private void setupWebViewClients() {
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                String[] requestedResources = request.getResources();
                boolean wantsCamera = false;
                boolean wantsAudio = false;
                for (String res : requestedResources) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                        wantsCamera = true;
                    } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(res)) {
                        wantsAudio = true;
                    }
                }

                boolean hasCameraPerm = ContextCompat.checkSelfPermission(MainActivity.this,
                        Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
                boolean hasAudioPerm = ContextCompat.checkSelfPermission(MainActivity.this,
                        Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;

                // 复制到final变量供lambda使用
                final boolean needCamera = wantsCamera && !hasCameraPerm;
                final boolean needAudio = wantsAudio && !hasAudioPerm;

                if (needCamera || needAudio) {
                    request.deny();
                    runOnUiThread(() -> {
                        if (needCamera) requestCameraPermission();
                        if (needAudio) requestAudioPermission();
                    });
                    return;
                }

                boolean shouldGrant = wantsCamera || wantsAudio;
                if (shouldGrant) {
                    request.grant(requestedResources);
                } else {
                    request.deny();
                }
            }
        });

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("tel:") || url.startsWith("mailto:") || url.startsWith("sms:")) {
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    startActivity(intent);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                FamilyChatApp.webViewLoaded = true;
                Log.d(TAG, "WebView page loaded: " + url);
                try { view.resumeTimers(); } catch (Exception e) {}
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requestNotificationPermissionDelayed();
                }
                // 通知页面已加载（用户可能已登录）
                try {
                    view.evaluateJavascript(
                        "(function() { try { var saved = localStorage.getItem('currentUser'); if (saved) { var user = JSON.parse(saved); if (user && user.id && window.AndroidBridge) { window.AndroidBridge.setUserId(user.id); } } } catch(e) {} })();",
                        null
                    );
                } catch (Exception e) {}
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                Log.e(TAG, "WebView error: " + errorCode + " - " + description);
                if (errorCode == ERROR_HOST_LOOKUP || errorCode == ERROR_CONNECT || errorCode == ERROR_TIMEOUT) {
                    runOnUiThread(() -> {
                        try { view.loadUrl(WEB_URL); } catch (Exception e2) {}
                    });
                }
            }
        });
    }

    private void acquireWakeLocks() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK,
                        "FamilyChat:MainWakeLock");
                wakeLock.setReferenceCounted(false);
                if (!wakeLock.isHeld()) {
                    wakeLock.acquire();
                    Log.d(TAG, "WakeLock acquired");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "WakeLock failed: " + e.getMessage());
        }

        try {
            WifiManager wifiManager = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wifiManager != null) {
                wifiLock = wifiManager.createWifiLock(
                        WifiManager.WIFI_MODE_FULL_HIGH_PERF,
                        "FamilyChat:MainWifiLock");
                wifiLock.setReferenceCounted(false);
                if (!wifiLock.isHeld()) {
                    wifiLock.acquire();
                    Log.d(TAG, "WifiLock acquired");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "WifiLock failed: " + e.getMessage());
        }
    }

    private void startKeepAlive() {
        if (keepAliveRunning) return;
        keepAliveRunning = true;
        keepAliveHandler = new Handler(Looper.getMainLooper());
        keepAliveRunnable = new Runnable() {
            @Override
            public void run() {
                if (!keepAliveRunning) return;
                if (webView != null) {
                    try {
                        webView.resumeTimers();
                    } catch (Exception e) {
                        Log.w(TAG, "KeepAlive timer resume failed", e);
                    }
                }
                keepAliveHandler.postDelayed(this, 20000);
            }
        };
        keepAliveHandler.postDelayed(keepAliveRunnable, 20000);
        Log.d(TAG, "KeepAlive started (20s interval)");
    }

    private void stopKeepAlive() {
        keepAliveRunning = false;
        if (keepAliveHandler != null && keepAliveRunnable != null) {
            keepAliveHandler.removeCallbacks(keepAliveRunnable);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "=== onResume ===");
        // 关键：不调用 webView.onResume()，保持 JS 持续运行
        if (webView != null) {
            try {
                webView.resumeTimers();
            } catch (Exception e) {
                Log.w(TAG, "resumeTimers error", e);
            }
        }
        ensureForegroundServiceRunning();
        // 重新获取锁
        if (wakeLock != null && !wakeLock.isHeld()) {
            try { wakeLock.acquire(); } catch (Exception e) {}
        }
        if (wifiLock != null && !wifiLock.isHeld()) {
            try { wifiLock.acquire(); } catch (Exception e) {}
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "=== onPause ===");
        // 关键：不调用 webView.onPause()，JavaScript 继续运行
        // 保持 WebSocket 连接不断开
        // 保持定时器运行
        // 只退到后台，不销毁 Activity
        ensureForegroundServiceRunning();
    }

    @Override
    protected void onStart() {
        super.onStart();
        Log.d(TAG, "=== onStart ===");
    }

    @Override
    protected void onStop() {
        super.onStop();
        Log.d(TAG, "=== onStop ===");
    }

    @Override
    protected void onDestroy() {
        Log.d(TAG, "=== onDestroy ===");
        // 只分离 WebView，不销毁它！Application 会保持它
        try {
            FamilyChatApp.detachWebViewFromParent(webView);
        } catch (Exception e) {
            Log.w(TAG, "detach webView error", e);
        }

        // 停止本 Activity 特定的保活逻辑（但不销毁 WebView）
        stopKeepAlive();

        // 保持 Wake/Wifi 锁（由 Application 管理）
        // 不要释放锁，因为 WebView 仍在运行

        // 确保前台服务在运行
        ensureForegroundServiceRunning();

        Log.d(TAG, "Activity destroyed (WebView kept alive in Application)");
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            try {
                if (webView.canGoBack()) {
                    webView.goBack();
                    return;
                }
            } catch (Exception e) {}
        }
        try {
            moveTaskToBack(true);
            ensureForegroundServiceRunning();
            Log.d(TAG, "App moved to background (kept running)");
        } catch (Exception e) {
            Log.e(TAG, "moveTaskToBack failed: " + e.getMessage());
        }
    }

    private void ensureForegroundServiceRunning() {
        try {
            Intent serviceIntent = new Intent(this, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "ensureForegroundServiceRunning failed: " + e.getMessage());
        }
    }

    // ============ 通知 / 权限处理 ============

    public class WebAppInterface {
        @JavascriptInterface
        public void showNotification(String title, String body) {
            showAndroidNotification(title, body);
        }

        @JavascriptInterface
        public void showCallNotification(String callerName, String callType) {
            showIncomingCallNotification(callerName, callType);
        }

        @JavascriptInterface
        public void showVoiceMessageNotification(String senderName) {
            showAndroidNotification(senderName, "收到一条语音消息");
        }

        @JavascriptInterface
        public void setInCallState(boolean inCall) {
            Log.d(TAG, "In call state: " + inCall);
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            return checkNotificationPermission();
        }

        @JavascriptInterface
        public void requestAndroidNotificationPermission() {
            runOnUiThread(() -> requestNotificationPermission());
        }

        @JavascriptInterface
        public boolean hasCameraPermission() {
            return checkCameraPermission();
        }

        @JavascriptInterface
        public boolean hasAudioPermission() {
            return checkAudioPermission();
        }

        @JavascriptInterface
        public void requestCameraPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.CAMERA},
                            CAMERA_PERMISSION_REQUEST_CODE);
                }
            });
        }

        @JavascriptInterface
        public void requestAudioPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            AUDIO_PERMISSION_REQUEST_CODE);
                }
            });
        }

        @JavascriptInterface
        public void openAppSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent();
                intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", getPackageName(), null));
                try {
                    startActivity(intent);
                } catch (Exception e) {
                    Log.e(TAG, "Failed to open settings", e);
                }
            });
        }

        @JavascriptInterface
        public void sendSms(String phoneNumber, String message) {
            Log.d(TAG, "Sending SMS to: " + phoneNumber);
            if (!checkSmsPermission()) {
                runOnUiThread(() -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        if (ActivityCompat.shouldShowRequestPermissionRationale(MainActivity.this,
                                Manifest.permission.SEND_SMS)) {
                            showSmsPermissionDialog();
                        } else {
                            ActivityCompat.requestPermissions(MainActivity.this,
                                    new String[]{Manifest.permission.SEND_SMS},
                                    SMS_PERMISSION_REQUEST_CODE);
                        }
                    }
                });
                return;
            }
            try {
                SmsManager smsManager = SmsManager.getDefault();
                smsManager.sendTextMessage(phoneNumber, null, message, null, null);
            } catch (Exception e) {
                Log.e(TAG, "Failed to send SMS", e);
            }
        }

        @JavascriptInterface
        public boolean hasSmsPermission() {
            return checkSmsPermission();
        }

        @JavascriptInterface
        public void requestSmsPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    ActivityCompat.requestPermissions(MainActivity.this,
                            new String[]{Manifest.permission.SEND_SMS},
                            SMS_PERMISSION_REQUEST_CODE);
                }
            });
        }

        @JavascriptInterface
        public void setUserId(int userId) {
            Log.d(TAG, "User ID from JS: " + userId);
            // 保存到 SharedPreferences，供 ForegroundService 持久化读取
            try {
                SharedPreferences prefs = appContext.getSharedPreferences("FamilyChatPrefs", MODE_PRIVATE);
                prefs.edit().putInt("userId", userId).apply();
                Log.d(TAG, "userId saved to SharedPreferences: " + userId);
            } catch (Exception e) {
                Log.e(TAG, "Failed to save userId: " + e.getMessage());
            }
            if (pollService != null) {
                pollService.setUserId(userId);
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.deleteNotificationChannel("family_chat_channel");
            }
            NotificationChannel channel = new NotificationChannel(
                    "family_chat_channel", "消息通知",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("新消息提醒");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{100, 200, 100, 200});
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private boolean checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(this,
                    Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private boolean checkCameraPermission() {
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean checkAudioPermission() {
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean checkSmsPermission() {
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestNotificationPermissionDelayed() {
        new Handler(Looper.getMainLooper()).postDelayed(this::requestNotificationPermission, 1500);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(this,
                        Manifest.permission.POST_NOTIFICATIONS)) {
                    showPermissionRationaleDialog();
                } else {
                    ActivityCompat.requestPermissions(this,
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            POST_NOTIFICATIONS_REQUEST_CODE);
                }
            }
        }
    }

    private void requestAllPermissions() {
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            requestSmsPermission();
            requestCameraAndAudioPermissions();
            requestBatteryOptimizationPermission();
            requestOverlayPermission();
            requestAutoStartPermission();
            startForegroundService();
        }, 2000);
    }

    private void requestCameraAndAudioPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            requestCameraPermission();
            requestAudioPermission();
        }
    }

    private void requestCameraPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.CAMERA},
                        CAMERA_PERMISSION_REQUEST_CODE);
            }
        }
    }

    private void requestAudioPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.RECORD_AUDIO},
                        AUDIO_PERMISSION_REQUEST_CODE);
            }
        }
    }

    private void requestSmsPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[]{Manifest.permission.SEND_SMS},
                        SMS_PERMISSION_REQUEST_CODE);
            }
        }
    }

    private void requestBatteryOptimizationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent intent = new Intent();
            intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            if (intent.resolveActivity(getPackageManager()) != null) {
                try {
                    startActivityForResult(intent, BATTERY_OPTIMIZATION_REQUEST_CODE);
                } catch (Exception e) {
                    Log.w(TAG, "Battery opt intent failed", e);
                }
            }
        }
    }

    private void requestOverlayPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (!Settings.canDrawOverlays(this)) {
                Intent intent = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:" + getPackageName()));
                try {
                    startActivityForResult(intent, OVERLAY_PERMISSION_REQUEST_CODE);
                } catch (Exception e) {
                    Log.w(TAG, "Overlay intent failed", e);
                }
            }
        }
    }

    private void requestAutoStartPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent intent = new Intent();
                String manufacturer = Build.MANUFACTURER.toLowerCase();
                if (manufacturer.contains("xiaomi")) {
                    intent.setAction("miui.intent.action.OP_AUTO_START");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                } else if (manufacturer.contains("huawei") || manufacturer.contains("honor")) {
                    intent.setClassName("com.huawei.systemmanager",
                            "com.huawei.systemmanager.optimize.process.ProtectActivity");
                } else if (manufacturer.contains("oppo")) {
                    intent.setClassName("com.coloros.safecenter",
                            "com.coloros.safecenter.permission.startup.StartupAppListActivity");
                } else if (manufacturer.contains("vivo")) {
                    intent.setClassName("com.vivo.permissionmanager",
                            "com.vivo.permissionmanager.activity.BrightActivity");
                }
                if (intent.getComponent() != null && intent.resolveActivity(getPackageManager()) != null) {
                    startActivity(intent);
                }
            } catch (Exception e) {
                Log.w(TAG, "Auto-start permission intent failed", e);
            }
        }
    }

    private void startForegroundService() {
        try {
            Intent serviceIntent = new Intent(this, ForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(this, serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForegroundService failed", e);
        }
    }

    private void showPermissionRationaleDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("启用通知")
                .setMessage("请启用通知权限以接收新消息提醒")
                .setPositiveButton("前往设置", (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ActivityCompat.requestPermissions(this,
                                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                                POST_NOTIFICATIONS_REQUEST_CODE);
                    }
                })
                .setNegativeButton("稍后", null)
                .show();
    }

    private void showSmsPermissionDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("启用短信")
                .setMessage("短信权限用于发送短信提醒")
                .setPositiveButton("前往设置", (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        ActivityCompat.requestPermissions(this,
                                new String[]{Manifest.permission.SEND_SMS},
                                SMS_PERMISSION_REQUEST_CODE);
                    }
                })
                .setNegativeButton("稍后", null)
                .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == POST_NOTIFICATIONS_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "通知已启用", Toast.LENGTH_SHORT).show();
            } else {
                if (!ActivityCompat.shouldShowRequestPermissionRationale(this,
                        Manifest.permission.POST_NOTIFICATIONS)) {
                    showGoToSettingsDialog("需要通知权限", "请在设置中启用通知权限");
                }
            }
        } else if (requestCode == SMS_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "短信权限已启用", Toast.LENGTH_SHORT).show();
            }
        } else if (requestCode == CAMERA_PERMISSION_REQUEST_CODE ||
                requestCode == AUDIO_PERMISSION_REQUEST_CODE) {
            boolean cameraGranted = requestCode == CAMERA_PERMISSION_REQUEST_CODE &&
                    grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            boolean audioGranted = requestCode == AUDIO_PERMISSION_REQUEST_CODE &&
                    grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (cameraGranted || audioGranted) {
                String msg = cameraGranted ? "摄像头权限已启用" : "录音权限已启用";
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
            }
        }
    }

    private void showGoToSettingsDialog(String title, String message) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("前往设置", (dialog, which) -> {
                    Intent intent = new Intent();
                    intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    private void showAndroidNotification(String title, String body) {
        if (!checkNotificationPermission()) {
            requestNotificationPermission();
            return;
        }
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            Notification notification = new NotificationCompat.Builder(this, "family_chat_channel")
                    .setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .build();

            NotificationManagerCompat.from(this).notify((int)(System.currentTimeMillis() % 100000), notification);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show notification", e);
        }
    }

    private void showIncomingCallNotification(String callerName, String callType) {
        if (!checkNotificationPermission()) return;
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 9999, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            Notification notification = new NotificationCompat.Builder(this, "family_chat_calls")
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentTitle(callerName)
                    .setContentText("邀请你进行" + (callType != null && callType.contains("video") ? "视频" : "语音") + "通话")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setOngoing(true)
                    .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
                    .setFullScreenIntent(pendingIntent, true)
                    .build();

            NotificationManagerCompat.from(this).notify(9000, notification);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show call notification", e);
        }
    }
}
