package com.familychat.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
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

public class MessagePollService {
    private static final String TAG = "FamilyChat";
    private static final String PREFS_NAME = "FamilyChatPrefs";
    private static final String KEY_ROOM = "room";
    private static final String KEY_UID = "uid";
    private static final String NTFY_BASE = "https://ntfy.sh";
    private static final long POLL_INTERVAL_MS = 15000;
    private static final long RETRY_INTERVAL_MS = 5000;
    private static final int MAX_CONSECUTIVE_FAILURES = 3;

    private Context context;
    private Handler handler;
    private Runnable pollRunnable;
    private boolean isRunning = false;
    private int notificationId = 100;
    private int consecutiveFailures = 0;
    private boolean hasEverSucceeded = false;

    public MessagePollService(Context context) {
        this.context = context;
        this.handler = new Handler(Looper.getMainLooper());
    }

    public void startPolling() {
        if (isRunning) return;
        isRunning = true;
        consecutiveFailures = 0;
        Log.d(TAG, "MessagePollService started (ntfy relay)");
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                pollForMessages();
                long interval = (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !hasEverSucceeded)
                        ? RETRY_INTERVAL_MS : POLL_INTERVAL_MS;
                handler.postDelayed(this, interval);
            }
        };
        handler.postDelayed(pollRunnable, 3000);
    }

    public void stopPolling() {
        isRunning = false;
        if (handler != null && pollRunnable != null) {
            handler.removeCallbacks(pollRunnable);
        }
        Log.d(TAG, "MessagePollService stopped");
    }

    public void setUserId(int userId) {
        // 保留兼容：也写入 userId，但新逻辑主要使用 room + uid
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putInt("userId", userId).apply();
        Log.d(TAG, "User ID set: " + userId);
        if (!isRunning) {
            startPolling();
        }
    }

    public void setRoom(String room) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_ROOM, room).apply();
        startIfReady();
    }

    public void setUid(String uid) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_UID, uid).apply();
        startIfReady();
    }

    private void startIfReady() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getString(KEY_ROOM, "").isEmpty() && !prefs.getString(KEY_UID, "").isEmpty()) {
            if (!isRunning) startPolling();
        }
    }

    private void pollForMessages() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String room = prefs.getString(KEY_ROOM, "");
        String myUid = prefs.getString(KEY_UID, "");
        if (room.isEmpty() || myUid.isEmpty()) {
            Log.w(TAG, "No room/uid set, skipping poll");
            return;
        }

        long lastCheck = prefs.getLong("lastNtfyTs", 0);

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String urlStr = NTFY_BASE + "/" + room + "/json?since=" + (lastCheck > 0 ? lastCheck : 1);
                Log.d(TAG, "Polling ntfy: " + urlStr);

                URL url = new URL(urlStr);
                conn = (HttpURLConnection) url.openConnection();
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                conn.setRequestProperty("Accept", "application/json");

                int responseCode = conn.getResponseCode();
                if (responseCode != 200) {
                    Log.w(TAG, "Poll response code: " + responseCode);
                    consecutiveFailures++;
                    return;
                }

                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
                StringBuilder response = new StringBuilder();
                String line;
                while ((line = reader.readLine()) != null) {
                    response.append(line);
                }
                reader.close();

                JSONArray messages = new JSONArray(response.toString());
                hasEverSucceeded = true;
                consecutiveFailures = 0;

                long maxTs = lastCheck;
                SharedPreferences known = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                boolean changed = false;

                for (int i = 0; i < messages.length(); i++) {
                    JSONObject msg = messages.getJSONObject(i);
                    String msgId = msg.optString("id", "");
                    String senderUid = "";
                    JSONArray tags = msg.optJSONArray("tags");
                    if (tags != null && tags.length() > 0) {
                        senderUid = tags.optString(0, "");
                    }
                    if (senderUid.equals(myUid)) continue; // 跳过自己发的

                    String senderName = msg.optString("title", "家人");
                    String content = msg.optString("message", "");
                    long t = msg.optLong("time", 0);
                    if (t > maxTs) maxTs = t;

                    // 仅在后台时由原生弹通知，避免与网页内通知重复
                    if (!FamilyChatApp.isAppForeground) {
                        String knownKey = "known_ntfy_" + msgId;
                        if (!known.getBoolean(knownKey, false) && !content.isEmpty()) {
                            showPollNotification(senderName, content);
                            known.edit().putBoolean(knownKey, true).apply();
                            changed = true;
                        }
                    }
                }

                if (maxTs > lastCheck || changed) {
                    prefs.edit().putLong("lastNtfyTs", maxTs).apply();
                }

            } catch (Exception e) {
                Log.w(TAG, "Poll failed: " + e.getMessage());
                consecutiveFailures++;
                if (consecutiveFailures >= 3) {
                    Log.e(TAG, consecutiveFailures + " consecutive poll failures");
                }
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }

    private void showPollNotification(String senderName, String content) {
        try {
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, notificationId, intent,
                    PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);

            String displayContent = content.length() > 100 ? content.substring(0, 100) + "..." : content;

            String channelId = "family_chat_channel";
            Notification notification = new NotificationCompat.Builder(context, channelId)
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
                    .setTimeoutAfter(0)
                    .build();

            NotificationManagerCompat nm = NotificationManagerCompat.from(context);
            nm.notify(notificationId++, notification);
            Log.d(TAG, "Poll notification shown for: " + senderName);
        } catch (Exception e) {
            Log.e(TAG, "Failed to show poll notification", e);
        }
    }
}
