package com.familychat.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class RenewHelper {
    private static final String TAG = "FamilyChat";
    private static final String PREFS_NAME = "FamilyChatPrefs";
    private static final String KEY_LAST_RENEW = "lastRenewTime";
    private static final String KEY_RENEW_HISTORY = "renewHistory";
    private static final String KEY_RENEW_FAIL_COUNT = "renewFailCount";
    private static final long RENEW_INTERVAL_MS = 25L * 24 * 60 * 60 * 1000;
    private static final long FAIL_RETRY_INTERVAL_MS = 6L * 60 * 60 * 1000;
    private static final int MAX_RETRY_COUNT = 3;

    private static final String SERVER_URL = "https://15816563131.pythonanywhere.com";
    private static final String PA_API_URL = "https://www.pythonanywhere.com";
    private static final String PA_USERNAME = "15816563131";
    private static final String PA_TOKEN = "cdcb676f8dd8eb69dea0237d552a83199f9f70b6";
    private static final String RENEW_NOTIFICATION_CHANNEL = "renew_channel";
    private static final int RENEW_NOTIFICATION_ID = 10001;

    public interface RenewCallback {
        void onSuccess(String message);
        void onFailure(String error);
    }

    public static void checkAndRenew(Context context) {
        // 免服务器模式：不再需要续期 PythonAnywhere，直接跳过
        Log.d(TAG, "RenewHelper disabled (serverless mode)");
    }

    public static void forceRenewNow(Context context) {
        new Thread(() -> performRenew(context, false)).start();
    }

    public static void forceRenewWithCallback(Context context, RenewCallback callback) {
        new Thread(() -> {
            boolean success = doRenew();
            if (success) {
                SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                long now = System.currentTimeMillis();
                prefs.edit().putLong(KEY_LAST_RENEW, now).apply();
                addToHistory(context, true, "手动续期成功");
                int failCount = prefs.getInt(KEY_RENEW_FAIL_COUNT, 0);
                if (failCount > 0) {
                    prefs.edit().putInt(KEY_RENEW_FAIL_COUNT, 0).apply();
                }
                if (callback != null) {
                    callback.onSuccess("续期成功");
                }
                Log.i(TAG, "手动续期成功");
            } else {
                addToHistory(context, false, "手动续期失败");
                if (callback != null) {
                    callback.onFailure("续期失败，请稍后重试");
                }
                Log.w(TAG, "手动续期失败");
            }
        }).start();
    }

    private static void performRenew(Context context, boolean isAuto) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int failCount = prefs.getInt(KEY_RENEW_FAIL_COUNT, 0);

        boolean success = false;
        String errorMsg = "";

        for (int attempt = 1; attempt <= MAX_RETRY_COUNT; attempt++) {
            if (attempt > 1) {
                Log.i(TAG, "续期重试第 " + attempt + " 次...");
                try {
                    Thread.sleep(2000L * attempt);
                } catch (InterruptedException e) {
                    break;
                }
            }

            Log.i(TAG, "尝试直接调用PythonAnywhere API续期...");
            RenewResult directResult = doDirectRenew();
            if (directResult.success) {
                Log.i(TAG, "直接续期成功，记录到服务器...");
                doRenewWithDetail();
                success = true;
                break;
            } else {
                errorMsg = directResult.message;
                Log.w(TAG, "直接续期尝试 " + attempt + " 失败: " + directResult.message);
            }
        }

        if (success) {
            long now = System.currentTimeMillis();
            prefs.edit().putLong(KEY_LAST_RENEW, now).apply();
            prefs.edit().putInt(KEY_RENEW_FAIL_COUNT, 0).apply();
            addToHistory(context, true, isAuto ? "自动续期成功" : "续期成功");
            Log.i(TAG, isAuto ? "自动续期成功，已记录时间" : "续期成功");
            sendRenewNotification(context, true, isAuto);
        } else {
            failCount++;
            prefs.edit().putInt(KEY_RENEW_FAIL_COUNT, failCount).apply();
            addToHistory(context, false, (isAuto ? "自动续期失败" : "续期失败") + ": " + errorMsg);
            Log.w(TAG, (isAuto ? "自动续期" : "续期") + "失败，已尝试 " + MAX_RETRY_COUNT + " 次");
            sendRenewNotification(context, false, isAuto);
        }
    }

    private static void sendRenewNotification(Context context, boolean success, boolean isAuto) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null && nm.getNotificationChannel(RENEW_NOTIFICATION_CHANNEL) == null) {
                    NotificationChannel channel = new NotificationChannel(
                            RENEW_NOTIFICATION_CHANNEL,
                            "续期通知",
                            NotificationManager.IMPORTANCE_LOW);
                    channel.setDescription("PythonAnywhere自动续期状态通知");
                    channel.setShowBadge(false);
                    nm.createNotificationChannel(channel);
                }
            }

            String title = success ? "续期成功" : "续期失败";
            String message;
            if (success) {
                message = isAuto ? "PythonAnywhere已自动续期成功，服务继续可用" : "PythonAnywhere续期成功";
            } else {
                message = isAuto ? "PythonAnywhere自动续期失败，请尽快手动续期" : "PythonAnywhere续期失败";
            }

            NotificationCompat.Builder builder = new NotificationCompat.Builder(context, RENEW_NOTIFICATION_CHANNEL)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(message)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(message))
                    .setPriority(success ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH)
                    .setAutoCancel(true)
                    .setWhen(System.currentTimeMillis());

            NotificationManagerCompat.from(context).notify(RENEW_NOTIFICATION_ID, builder.build());
            Log.i(TAG, "续期通知已发送: " + title);
        } catch (Exception e) {
            Log.e(TAG, "发送续期通知失败: " + e.getMessage());
        }
    }

    public static boolean doRenew() {
        RenewResult result = doRenewWithDetail();
        return result.success;
    }

    private static RenewResult doRenewWithDetail() {
        HttpURLConnection conn = null;
        try {
            URL url = new URL(SERVER_URL + "/api/renew-pa");
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setDoOutput(true);

            int responseCode = conn.getResponseCode();

            if (responseCode == 200) {
                String responseBody = readResponse(conn);
                Log.i(TAG, "服务器续期记录成功: " + responseBody);
                return new RenewResult(true, "续期成功");
            } else {
                String errorBody = readErrorResponse(conn);
                Log.w(TAG, "服务器续期记录失败: HTTP " + responseCode + " - " + errorBody);
                return new RenewResult(false, "HTTP " + responseCode + ": " + errorBody);
            }
        } catch (Exception e) {
            Log.e(TAG, "服务器续期记录异常: " + e.getMessage());
            return new RenewResult(false, "网络异常: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static RenewResult doDirectRenew() {
        HttpURLConnection conn = null;
        try {
            String urlStr = PA_API_URL + "/api/v0/user/" + PA_USERNAME + "/webapps/" + PA_USERNAME + ".pythonanywhere.com/reload/";
            URL url = new URL(urlStr);
            conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Authorization", "Token " + PA_TOKEN);

            int responseCode = conn.getResponseCode();

            if (responseCode == 200) {
                String responseBody = readResponse(conn);
                Log.i(TAG, "PythonAnywhere直接续期成功: " + responseBody);
                return new RenewResult(true, "续期成功");
            } else {
                String errorBody = readErrorResponse(conn);
                Log.w(TAG, "PythonAnywhere直接续期失败: HTTP " + responseCode + " - " + errorBody);
                return new RenewResult(false, "HTTP " + responseCode + ": " + errorBody);
            }
        } catch (Exception e) {
            Log.e(TAG, "PythonAnywhere直接续期异常: " + e.getMessage());
            return new RenewResult(false, "网络异常: " + e.getMessage());
        } finally {
            if (conn != null) {
                conn.disconnect();
            }
        }
    }

    private static String readResponse(HttpURLConnection conn) {
        try {
            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
            }
            reader.close();
            return sb.toString();
        } catch (Exception e) {
            return "";
        }
    }

    private static String readErrorResponse(HttpURLConnection conn) {
        try {
            if (conn.getErrorStream() != null) {
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getErrorStream()));
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    sb.append(line);
                }
                reader.close();
                return sb.toString();
            }
        } catch (Exception e) {
        }
        return "无详细错误信息";
    }

    private static void addToHistory(Context context, boolean success, String message) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String history = prefs.getString(KEY_RENEW_HISTORY, "");
            String timestamp = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(new Date());
            String entry = String.format("[%s] %s: %s\n", timestamp, success ? "成功" : "失败", message);

            StringBuilder newHistory = new StringBuilder(entry);
            int lineCount = 1;
            for (char c : history.toCharArray()) {
                if (lineCount >= 50) break;
                newHistory.append(c);
                if (c == '\n') lineCount++;
            }

            prefs.edit().putString(KEY_RENEW_HISTORY, newHistory.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "保存续期历史失败: " + e.getMessage());
        }
    }

    public static long getLastRenewTime(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getLong(KEY_LAST_RENEW, 0);
    }

    public static String getRenewHistory(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_RENEW_HISTORY, "暂无续期记录");
    }

    public static int getFailCount(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_RENEW_FAIL_COUNT, 0);
    }

    public static long getDaysUntilNextRenew(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        long lastRenew = prefs.getLong(KEY_LAST_RENEW, 0);
        if (lastRenew == 0) return 0;
        long remaining = RENEW_INTERVAL_MS - (System.currentTimeMillis() - lastRenew);
        if (remaining <= 0) return 0;
        return remaining / (24 * 60 * 60 * 1000);
    }

    public static String getFormattedLastRenewTime(Context context) {
        long lastRenew = getLastRenewTime(context);
        if (lastRenew == 0) return "从未续期";
        return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.CHINA).format(new Date(lastRenew));
    }

    private static class RenewResult {
        boolean success;
        String message;

        RenewResult(boolean success, String message) {
            this.success = success;
            this.message = message;
        }
    }
}