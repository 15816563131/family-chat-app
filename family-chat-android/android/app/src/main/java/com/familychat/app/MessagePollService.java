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
    private static final String KEY_USER_ID = "userId";
    private static final String KEY_LAST_CHECK = "lastCheck";
    private static final String KEY_KNOWN_MSG_PREFIX = "known_msg_";
    private static final String SERVER_URL = "https://family-chat-app-production-93b6.up.railway.app";
    private static final long POLL_INTERVAL_MS = 10000;
    private static final long RETRY_INTERVAL_MS = 3000;
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
        Log.d(TAG, "MessagePollService started");
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                pollForMessages();
                long interval = consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && !hasEverSucceeded
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
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int prevId = prefs.getInt(KEY_USER_ID, -1);
        if (prevId == userId) {
            if (!isRunning) {
                startPolling();
            }
            return;
        }
        prefs.edit().putInt(KEY_USER_ID, userId).apply();
        prefs.edit().remove(KEY_LAST_CHECK).apply();
        Log.d(TAG, "User ID set: " + userId);
        if (!isRunning) {
            startPolling();
        }
    }

    private void pollForMessages() {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        int userId = prefs.getInt(KEY_USER_ID, -1);
        if (userId < 0) {
            Log.w(TAG, "No user ID set, skipping poll");
            return;
        }

        long lastCheck = prefs.getLong(KEY_LAST_CHECK, 0);
        long currentTime = System.currentTimeMillis();

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                String urlStr = SERVER_URL + "/api/recent_messages/" + userId;
                if (lastCheck > 0) {
                    urlStr += "?since=" + lastCheck;
                }
                Log.d(TAG, "Polling: " + urlStr);

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

                if (messages.length() > 0) {
                    Log.d(TAG, "Polled " + messages.length() + " new messages");
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
                        Log.d(TAG, "New message from " + senderName + ": " + content.substring(0, Math.min(content.length(), 20)));
                        showPollNotification(senderName, content, msgId);
                        prefs.edit().putBoolean(knownKey, true).apply();
                    }
                }

                prefs.edit().putLong(KEY_LAST_CHECK, currentTime).apply();

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

    private void showPollNotification(String senderName, String content, int msgId) {
        try {
            Intent intent = new Intent(context, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(context, msgId, intent,
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