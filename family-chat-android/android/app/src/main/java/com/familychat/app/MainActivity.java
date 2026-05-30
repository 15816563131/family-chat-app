package com.familychat.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.telephony.SmsManager;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

public class MainActivity extends Activity {
    private WebView webView;
    private MessagePollService pollService;
    private PowerManager.WakeLock wakeLock;
    private Handler keepAliveHandler;
    private Runnable keepAliveRunnable;
    private boolean isForeground = true;
    private boolean keepAliveRunning = false;
    private static final String WEB_URL = "https://family-chat-app-production-93b6.up.railway.app";
    private static final int POST_NOTIFICATIONS_REQUEST_CODE = 1002;
    private static final int SMS_PERMISSION_REQUEST_CODE = 1003;
    private static final int BATTERY_OPTIMIZATION_REQUEST_CODE = 1004;
    private static final int OVERLAY_PERMISSION_REQUEST_CODE = 1005;
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 1006;
    private static final int AUDIO_PERMISSION_REQUEST_CODE = 1007;
    private static final String CHANNEL_ID = "family_chat_channel";
    private static final String FOREGROUND_CHANNEL_ID = "family_chat_foreground";
    private static final String CALL_CHANNEL_ID = "family_chat_calls";
    private static final String TAG = "FamilyChat";
    private int notificationId = 1;
    private boolean isInCall = false;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface", "WakelockTimeout"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        pollService = new MessagePollService(this);

        createNotificationChannel();
        createForegroundChannel();

        webView = findViewById(R.id.webView);
        setupWebView();
        webView.loadUrl(WEB_URL);

        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FamilyChat:WebViewKeepAlive");
            wakeLock.acquire(30 * 60 * 1000L);
            Log.d(TAG, "WakeLock acquired (30min)");
        }

        startKeepAlive();
        requestNotificationPermission();
        requestAllPermissions();
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void setupWebView() {
        if (webView == null) return;

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webSettings.setGeolocationEnabled(true);
        webSettings.setLoadWithOverviewMode(true);
        webSettings.setUseWideViewPort(true);
        webSettings.setLayoutAlgorithm(WebSettings.LayoutAlgorithm.NARROW_COLUMNS);
        webSettings.setRenderPriority(WebSettings.RenderPriority.HIGH);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webSettings.setAllowUniversalAccessFromFileURLs(true);
        }

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");
        webView.setWebChromeClient(new WebChromeClient());

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
                Log.d(TAG, "Page loaded: " + url);
                if (view == null || isFinishing() || isDestroyed()) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requestNotificationPermissionDelayed();
                }
                try { view.resumeTimers(); } catch (Exception e) {}

                try {
                    view.evaluateJavascript(
                        "(function() {" +
                        "  try {" +
                        "    var saved = localStorage.getItem('currentUser');" +
                        "    if (saved) {" +
                        "      var user = JSON.parse(saved);" +
                        "      if (user && user.id && window.AndroidBridge && window.AndroidBridge.setUserId) {" +
                        "        window.AndroidBridge.setUserId(user.id);" +
                        "      }" +
                        "    }" +
                        "  } catch(e) {}" +
                        "})();",
                        null
                    );
                } catch (Exception e) {
                    Log.w(TAG, "evaluateJavascript failed", e);
                }
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                Log.e(TAG, "WebView error: " + errorCode + " - " + description + " [" + failingUrl + "]");
                if (view == null || isFinishing() || isDestroyed()) return;
                if (errorCode == ERROR_HOST_LOOKUP || errorCode == ERROR_CONNECT || errorCode == ERROR_TIMEOUT) {
                    runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed()) return;
                        try { view.reload(); } catch (Exception e2) {}
                    });
                }
            }
        });
    }

    private void startKeepAlive() {
        if (keepAliveRunning) return;
        keepAliveRunning = true;
        keepAliveHandler = new Handler(Looper.getMainLooper());
        keepAliveRunnable = new Runnable() {
            @Override
            public void run() {
                if (!keepAliveRunning || isFinishing() || isDestroyed()) {
                    keepAliveRunning = false;
                    return;
                }
                if (webView != null) {
                    try {
                        webView.resumeTimers();
                    } catch (Exception e) {
                        Log.w(TAG, "KeepAlive error", e);
                    }
                }
                keepAliveHandler.postDelayed(this, 30000);
            }
        };
        keepAliveHandler.postDelayed(keepAliveRunnable, 30000);
    }

    @Override
    protected void onResume() {
        super.onResume();
        isForeground = true;
        if (webView != null && !isFinishing() && !isDestroyed()) {
            try {
                webView.onResume();
                webView.resumeTimers();
            } catch (Exception e) {
                Log.w(TAG, "onResume error", e);
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        isForeground = false;
        if (webView != null && !isFinishing() && !isDestroyed()) {
            try {
                webView.onPause();
                webView.resumeTimers();
            } catch (Exception e) {
                Log.w(TAG, "onPause error", e);
            }
        }
    }

    @Override
    protected void onDestroy() {
        keepAliveRunning = false;
        if (keepAliveHandler != null && keepAliveRunnable != null) {
            keepAliveHandler.removeCallbacks(keepAliveRunnable);
        }
        keepAliveHandler = null;
        keepAliveRunnable = null;

        if (pollService != null) {
            pollService.stopPolling();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "WakeLock released");
        }

        if (webView != null) {
            try {
                webView.destroy();
            } catch (Exception e) {}
            webView = null;
        }

        super.onDestroy();
        Log.d(TAG, "Activity destroyed");
    }

    public class WebAppInterface {
        @JavascriptInterface
        public void showNotification(String title, String body) {
            Log.d(TAG, "JS notification: " + title);
            showAndroidNotification(title, body);
        }

        @JavascriptInterface
        public void showCallNotification(String callerName, String callType) {
            Log.d(TAG, "JS call notification from: " + callerName + " type: " + callType);
            showIncomingCallNotification(callerName, callType);
        }

        @JavascriptInterface
        public void showVoiceMessageNotification(String senderName) {
            Log.d(TAG, "JS voice message from: " + senderName);
            showAndroidNotification(senderName, "收到一条语音消息");
        }

        @JavascriptInterface
        public void setInCallState(boolean inCall) {
            isInCall = inCall;
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
        public void sendSms(String phoneNumber, String message) {
            Log.d(TAG, "Sending SMS to: " + phoneNumber);
            sendSmsMessage(phoneNumber, message);
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
            if (pollService != null) {
                pollService.setUserId(userId);
            }
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.deleteNotificationChannel(CHANNEL_ID);
            }
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "Chat Notifications", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("New message notifications");
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setVibrationPattern(new long[]{100, 200, 100, 200});
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
                Log.d(TAG, "Notification channel created with HIGH importance");
            }
        }
        createCallNotificationChannel();
    }

    private void createCallNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel callChannel = new NotificationChannel(
                    CALL_CHANNEL_ID, "Call Notifications", NotificationManager.IMPORTANCE_HIGH);
            callChannel.setDescription("Incoming call notifications");
            callChannel.enableVibration(true);
            callChannel.enableLights(true);
            callChannel.setVibrationPattern(new long[]{500, 300, 500, 300});
            callChannel.setShowBadge(true);
            callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            callChannel.setBypassDnd(true);
            callChannel.setSound(null, null);
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(callChannel);
                Log.d(TAG, "Call notification channel created");
            }
        }
    }

    private void createForegroundChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    FOREGROUND_CHANNEL_ID, "Background Service",
                    NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Keeps the app running in background");
            channel.setShowBadge(false);
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    private boolean checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private boolean checkCameraPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean checkAudioPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean checkSmsPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED;
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
            requestBatteryOptimizationPermission();
            requestOverlayPermission();
            requestAutoStartPermission();
            startForegroundService();
        }, 2000);
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
                } else if (manufacturer.contains("oneplus")) {
                    intent.setClassName("com.oneplus.security",
                            "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity");
                } else if (manufacturer.contains("samsung")) {
                    intent.setClassName("com.samsung.android.sm",
                            "com.samsung.android.sm.app.battery.BatteryUsageActivity");
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

    private void sendSmsMessage(String phoneNumber, String message) {
        if (!checkSmsPermission()) {
            Log.w(TAG, "No SMS permission");
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    if (ActivityCompat.shouldShowRequestPermissionRationale(this,
                            Manifest.permission.SEND_SMS)) {
                        showSmsPermissionDialog();
                    } else {
                        ActivityCompat.requestPermissions(this,
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
            Log.d(TAG, "SMS sent to: " + phoneNumber);
        } catch (Exception e) {
            Log.e(TAG, "Failed to send SMS", e);
        }
    }

    private void showPermissionRationaleDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("Enable Notifications")
                .setMessage("Please enable notifications to receive new message alerts.")
                .setPositiveButton("Go to Settings", (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                                POST_NOTIFICATIONS_REQUEST_CODE);
                    }
                })
                .setNegativeButton("Later", (dialog, which) -> {
                    Toast.makeText(MainActivity.this,
                            "You can enable notifications in Settings later", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void showSmsPermissionDialog() {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle("Enable SMS")
                .setMessage("SMS permission is needed so your contacts receive SMS notifications when you message them.")
                .setPositiveButton("Go to Settings", (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.SEND_SMS},
                                SMS_PERMISSION_REQUEST_CODE);
                    }
                })
                .setNegativeButton("Later", null)
                .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == POST_NOTIFICATIONS_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Notifications enabled!", Toast.LENGTH_SHORT).show();
            } else {
                if (!ActivityCompat.shouldShowRequestPermissionRationale(this,
                        Manifest.permission.POST_NOTIFICATIONS)) {
                    showGoToSettingsDialog("Notification Permission Needed",
                            "Please enable notifications in Settings to receive message alerts.");
                }
            }
        } else if (requestCode == SMS_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "SMS permission enabled!", Toast.LENGTH_SHORT).show();
            } else {
                if (!ActivityCompat.shouldShowRequestPermissionRationale(this,
                        Manifest.permission.SEND_SMS)) {
                    showGoToSettingsDialog("SMS Permission Needed",
                            "Please enable SMS permission in Settings so your contacts receive SMS notifications.");
                }
            }
        } else if (requestCode == CAMERA_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Camera permission enabled!", Toast.LENGTH_SHORT).show();
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){ if(window.onCameraPermissionResult) window.onCameraPermissionResult(true); })();",
                        null);
                }
            } else {
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){ if(window.onCameraPermissionResult) window.onCameraPermissionResult(false); })();",
                        null);
                }
            }
        } else if (requestCode == AUDIO_PERMISSION_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Microphone permission enabled!", Toast.LENGTH_SHORT).show();
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){ if(window.onAudioPermissionResult) window.onAudioPermissionResult(true); })();",
                        null);
                }
            } else {
                if (webView != null) {
                    webView.evaluateJavascript(
                        "(function(){ if(window.onAudioPermissionResult) window.onAudioPermissionResult(false); })();",
                        null);
                }
            }
        }
    }

    private void showGoToSettingsDialog(String title, String message) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("Go to Settings", (dialog, which) -> {
                    Intent intent = new Intent();
                    intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.fromParts("package", getPackageName(), null));
                    startActivity(intent);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void showAndroidNotification(String title, String body) {
        if (!checkNotificationPermission()) {
            Log.w(TAG, "No notification permission");
            requestNotificationPermission();
            return;
        }
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setDefaults(NotificationCompat.DEFAULT_ALL);

            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
            notificationManager.notify(notificationId++, builder.build());
            Log.d(TAG, "Android notification shown: " + title);
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

            String typeLabel = "video".equals(callType) ? "视频通话" : "语音通话";
            Notification notification = new NotificationCompat.Builder(this, CALL_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_call)
                    .setContentTitle(callerName)
                    .setContentText("邀请你进行" + typeLabel)
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_CALL)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setOngoing(true)
                    .setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
                    .setFullScreenIntent(pendingIntent, true)
                    .build();

            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            nm.notify(9000, notification);
            Log.d(TAG, "Call notification shown: " + callerName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show call notification", e);
        }
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
        super.onBackPressed();
    }
}