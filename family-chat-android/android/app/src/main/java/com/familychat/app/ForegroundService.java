package com.familychat.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

public class ForegroundService extends Service {
    private static final String TAG = "FamilyChat";
    private static final String PREFS_NAME = "FamilyChatPrefs";
    private static final String KEY_USER_ID = "userId";
    private static final String KEY_LAST_CHECK = "lastCheck";
    private static final String KEY_KNOWN_MSG_PREFIX = "known_msg_";
    private static final String SERVER_URL = "https://family-chat-app-production-93b6.up.railway.app";
    private static final long POLL_INTERVAL_MS = 8000;

    private Handler handler;
    private Runnable pollRunnable;
    private boolean isPolling = false;
    private int notificationId = 200;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        Log.d(TAG, "ForegroundService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "ForegroundService starting");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent notificationIntent = new Intent(this, MainActivity.class);
            notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            Notification notification = new NotificationCompat.Builder(this, "family_chat_foreground")
                    .setContentTitle("FamilyChat Running")
                    .setContentText("Background service is active")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setContentIntent(pendingIntent)
                    .build();

            startForeground(1, notification);
        }

        if (!isPolling) {
            startPollingFromPrefs();
        }

        return START_STICKY;
    }

    private void startPollingFromPrefs() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        int userId = prefs.getInt(KEY_USER_ID, -1);
        if (userId > 0) {
            Log.d(TAG, "ForegroundService: restoring polling for userId=" + userId);
            startPolling(userId);
        } else {
            Log.d(TAG, "ForegroundService: no userId found, will check again later");
            handler.postDelayed(() -> {
                SharedPreferences prefs2 = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                int uid = prefs2.getInt(KEY_USER_ID, -1);
                if (uid > 0) {
                    startPolling(uid);
                }
            }, 5000);
        }
    }

    private void startPolling(int userId) {
        if (isPolling) return;
        isPolling = true;

        pollRunnable = new Runnable() {
            @Override
            public void run() {
                pollForMessages(userId);
                handler.postDelayed(this, POLL_INTERVAL_MS);
            }
        };
        handler.postDelayed(pollRunnable, 2000);
    }

    private void stopPolling() {
        isPolling = false;
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
    }

    private void pollForMessages(int userId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        long lastCheck = prefs.getLong(KEY_LAST_CHECK, 0);
        long currentTime = System.currentTimeMillis();

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String urlStr = SERVER_URL + "/api/recent_messages/" + userId;
                if (lastCheck > 0) {
                    urlStr += "?since=" + lastCheck;
                }

                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("Accept", "application/json");

                int responseCode = conn.getResponseCode();
                if (responseCode != 200) return;

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                JSONArray messages = new JSONArray(response.toString());
                if (messages.length() > 0) {
                    Log.d(TAG, "ForegroundService: " + messages.length() + " new messages");
                }

                for (int i = 0; i < messages.length(); i++) {
                    JSONObject msg = messages.getJSONObject(i);
                    int msgId = msg.getInt("id");
                    int senderId = msg.getInt("sender_id");
                    String senderName = msg.optString("sender_name", "好友");
                    String content = msg.optString("content", "");

                    if (senderId == userId) continue;

                    String knownKey = KEY_KNOWN_MSG_PREFIX + msgId;
                    if (!prefs.getBoolean(knownKey, false)) {
                        showDirectNotification(senderName, content, msgId);
                        prefs.edit().putBoolean(knownKey, true).apply();
                    }
                }

                prefs.edit().putLong(KEY_LAST_CHECK, currentTime).apply();

            } catch (Exception e) {
                Log.w(TAG, "ForegroundService poll failed: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    private void showDirectNotification(String senderName, String content, int msgId) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    return;
                }
            }

            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, msgId, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            String displayContent = content.length() > 100 ? content.substring(0, 100) + "..." : content;

            Notification notification = new NotificationCompat.Builder(this, "family_chat_channel")
                    .setSmallIcon(android.R.drawable.ic_popup_reminder)
                    .setContentTitle(senderName)
                    .setContentText(displayContent)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(displayContent))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .build();

            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            nm.notify(notificationId++, notification);
            Log.d(TAG, "ForegroundService notification: " + senderName);
        } catch (Exception e) {
            Log.e(TAG, "ForegroundService notification failed", e);
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        stopPolling();
        Log.d(TAG, "ForegroundService destroyed");
    }
}