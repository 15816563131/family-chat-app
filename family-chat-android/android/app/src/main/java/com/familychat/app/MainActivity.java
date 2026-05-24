package com.familychat.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
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
    private static final String WEB_URL = "https://family-chat-app-production-93b6.up.railway.app";
    private static final int NOTIFICATION_PERMISSION_CODE = 1001;
    private static final int POST_NOTIFICATIONS_REQUEST_CODE = 1002;
    private static final String CHANNEL_ID = "family_chat_channel";
    private static final String TAG = "FamilyChat";
    private int notificationId = 1;

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        createNotificationChannel();

        webView = findViewById(R.id.webView);

        WebSettings webSettings = webView.getSettings();
        webSettings.setJavaScriptEnabled(true);
        webSettings.setDomStorageEnabled(true);
        webSettings.setCacheMode(WebSettings.LOAD_DEFAULT);
        webSettings.setAllowFileAccess(true);
        webSettings.setAllowContentAccess(true);
        webSettings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webSettings.setGeolocationEnabled(true);
        
        // 启用更多WebView功能以支持通知
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            webSettings.setAllowUniversalAccessFromFileURLs(true);
        }
        
        // 添加JavaScript接口，用于Android原生通知
        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");

        webView.setWebChromeClient(new WebChromeClient() {
            // 可以在这里处理更多WebView通知相关的功能
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
                Log.d(TAG, "页面加载完成: " + url);
                // 页面加载完成后请求通知权限
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    requestNotificationPermissionDelayed();
                }
            }
        });

        webView.loadUrl(WEB_URL);

        // 首次启动时请求权限
        requestNotificationPermission();

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!WEB_URL.equals(webView.getUrl())) {
                showConnectionErrorDialog();
            }
        }, 10000);
    }

    // JavaScript接口类
    public class WebAppInterface {
        @JavascriptInterface
        public void showNotification(String title, String body) {
            Log.d(TAG, "收到JavaScript通知请求: " + title);
            showAndroidNotification(title, body);
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            return checkNotificationPermission();
        }

        @JavascriptInterface
        public void requestAndroidNotificationPermission() {
            runOnUiThread(() -> requestNotificationPermission());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            String channelId = CHANNEL_ID;
            String channelName = "家庭聊天通知";
            String channelDescription = "接收新消息通知";
            int importance = NotificationManager.IMPORTANCE_HIGH;
            
            NotificationChannel channel = new NotificationChannel(channelId, channelName, importance);
            channel.setDescription(channelDescription);
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setVibrationPattern(new long[]{100, 200, 100, 200});
            channel.setShowBadge(true);
            
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
                Log.d(TAG, "通知通道已创建");
            }
        }
    }

    private boolean checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }
        // Android 13以下默认有通知权限
        return true;
    }

    private void requestNotificationPermissionDelayed() {
        new Handler(Looper.getMainLooper()).postDelayed(this::requestNotificationPermission, 1500);
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ 需要动态请求通知权限
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS)) {
                    // 显示权限说明
                    showPermissionRationaleDialog();
                } else {
                    // 直接请求权限
                    ActivityCompat.requestPermissions(this,
                            new String[]{Manifest.permission.POST_NOTIFICATIONS},
                            POST_NOTIFICATIONS_REQUEST_CODE);
                }
            }
        }
    }

    private void showPermissionRationaleDialog() {
        new AlertDialog.Builder(this)
                .setTitle("开启通知")
                .setMessage("为了能及时收到新消息提醒，请开启通知权限。")
                .setPositiveButton("去开启", (dialog, which) -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        ActivityCompat.requestPermissions(MainActivity.this,
                                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                                POST_NOTIFICATIONS_REQUEST_CODE);
                    }
                })
                .setNegativeButton("稍后", (dialog, which) -> {
                    Toast.makeText(MainActivity.this, "您可以在设置中随时开启通知", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == POST_NOTIFICATIONS_REQUEST_CODE) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "✅ 通知权限已开启！", Toast.LENGTH_SHORT).show();
                Log.d(TAG, "通知权限已授权");
            } else {
                // 权限被拒绝
                if (!ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS)) {
                    // 用户勾选了"不再询问"，引导用户去设置页面
                    showGoToSettingsDialog();
                }
            }
        }
    }

    private void showGoToSettingsDialog() {
        new AlertDialog.Builder(this)
                .setTitle("需要通知权限")
                .setMessage("请在设置中开启通知权限，以便接收新消息提醒。")
                .setPositiveButton("去设置", (dialog, which) -> {
                    Intent intent = new Intent();
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        intent.setAction(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                        intent.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    } else {
                        intent.setAction(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        intent.setData(Uri.fromParts("package", getPackageName(), null));
                    }
                    startActivity(intent);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    // 使用Android原生通知系统显示通知
    private void showAndroidNotification(String title, String body) {
        if (!checkNotificationPermission()) {
            Log.w(TAG, "没有通知权限");
            requestNotificationPermission();
            return;
        }

        try {
            // 创建点击通知时打开的Intent
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            // 创建通知
            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setVibrate(new long[]{100, 200, 100, 200});

            // 显示通知
            NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
            notificationManager.notify(notificationId++, builder.build());
            Log.d(TAG, "Android原生通知已显示");
        } catch (Exception e) {
            Log.e(TAG, "显示通知失败", e);
        }
    }

    private void showConnectionErrorDialog() {
        new AlertDialog.Builder(this)
                .setTitle("连接失败")
                .setMessage("无法连接到服务器，请检查网络连接。\n\n点击\"重试\"重新加载页面。")
                .setPositiveButton("重试", (dialog, which) -> {
                    webView.loadUrl(WEB_URL);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}