package com.familychat.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class SplashActivity extends Activity {

    private static final String TAG = "SplashActivity";
    private static final String WEB_URL = "https://15816563131.pythonanywhere.com/chat";

    private ProgressBar progressBar;
    private TextView tvProgressText;
    private Handler mainHandler;
    private ExecutorService executor;
    private int currentProgress = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_splash);

        progressBar = findViewById(R.id.progressBar);
        tvProgressText = findViewById(R.id.tvProgressText);
        mainHandler = new Handler(Looper.getMainLooper());
        executor = Executors.newSingleThreadExecutor();

        startLoading();
    }

    private void startLoading() {
        executor.execute(() -> {
            try {
                // 步骤1: 初始化应用 (0-20%)
                updateProgress(5, "正在初始化...");
                Thread.sleep(200);

                updateProgress(15, "正在准备环境...");
                Thread.sleep(200);

                // 步骤2-3: 免服务器模式，跳过服务器连接检测，直接准备本地资源
                updateProgress(20, "正在准备...");
                Thread.sleep(300);
                updateProgress(35, "正在加载应用...");
                Thread.sleep(300);
                updateProgress(50, "即将完成...");
                Thread.sleep(200);

                // 步骤4: 预加载WebView (65-90%)
                updateProgress(70, "正在加载应用...");
                Thread.sleep(300);
                updateProgress(80, "正在准备界面...");
                Thread.sleep(300);
                updateProgress(90, "即将完成...");
                Thread.sleep(200);

                // 步骤5: 完成 (90-100%)
                updateProgress(95, "启动完成");
                Thread.sleep(200);
                updateProgress(100, "欢迎使用家庭聊天");
                Thread.sleep(300);

                // 跳转到主页面
                runOnUiThread(() -> {
                    Intent intent = new Intent(SplashActivity.this, MainActivity.class);
                    startActivity(intent);
                    finish();
                    overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out);
                });

            } catch (Exception e) {
                Log.e(TAG, "加载出错: " + e.getMessage());
                // 出错也跳转到主页面，让WebView自己处理
                runOnUiThread(() -> {
                    Intent intent = new Intent(SplashActivity.this, MainActivity.class);
                    startActivity(intent);
                    finish();
                });
            }
        });
    }

    private void updateProgress(int progress, String text) {
        currentProgress = progress;
        runOnUiThread(() -> {
            progressBar.setProgress(progress);
            tvProgressText.setText(text);
        });
    }

    private boolean checkNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            return activeNetwork != null && activeNetwork.isConnectedOrConnecting();
        } catch (Exception e) {
            Log.e(TAG, "检查网络失败: " + e.getMessage());
            return false;
        }
    }

    private boolean testServerConnection() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(WEB_URL.replace("/chat", "/api/health"));
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("GET");
            conn.setConnectTimeout(8000);
            conn.setReadTimeout(8000);
            int responseCode = conn.getResponseCode();
            Log.d(TAG, "服务器测试响应: " + responseCode);
            return responseCode == 200;
        } catch (IOException e) {
            Log.w(TAG, "服务器连接失败: " + e.getMessage());
            return false;
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (executor != null && !executor.isShutdown()) {
            executor.shutdownNow();
        }
    }
}
