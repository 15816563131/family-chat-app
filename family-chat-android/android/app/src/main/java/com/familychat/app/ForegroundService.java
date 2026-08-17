package com.familychat.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
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

    public static final String ACTION_TRIGGER_POLL = "com.familychat.app.ACTION_TRIGGER_POLL";
    public static final String ACTION_KEEP_ALIVE = "com.familychat.app.ACTION_KEEP_ALIVE";

    private static final int ALARM_POLL_REQUEST_CODE = 5501;
    private static final int ALARM_RESTART_REQUEST_CODE = 5502;
    private static final int NOTIFICATION_ID = 1;
    private static final String CHANNEL_ID = "family_chat_service";
    private static final String MSG_CHANNEL_ID = "family_chat_messages";

    private PowerManager.WakeLock pollWakeLock;
    private BroadcastReceiver connectivityReceiver;
    private BroadcastReceiver screenReceiver;
    private boolean isInDoze = false;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "ForegroundService created");
        createNotificationChannels();
        initWakeLock();
        registerReceivers();
        scheduleAlarms();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) {
                    NotificationChannel serviceChannel = new NotificationChannel(
                            CHANNEL_ID, "后台服务", NotificationManager.IMPORTANCE_LOW);
                    serviceChannel.setDescription("保持消息接收连接");
                    serviceChannel.setShowBadge(false);
                    nm.createNotificationChannel(serviceChannel);

                    NotificationChannel msgChannel = new NotificationChannel(
                            MSG_CHANNEL_ID, "新消息", NotificationManager.IMPORTANCE_HIGH);
                    msgChannel.setDescription("接收好友发来的消息");
                    msgChannel.enableVibration(true);
                    msgChannel.setShowBadge(true);
                    nm.createNotificationChannel(msgChannel);
                }
            } catch (Exception e) {
                Log.e(TAG, "create channels error: " + e.getMessage());
            }
        }
    }

    private void initWakeLock() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                pollWakeLock = pm.newWakeLock(
                        PowerManager.PARTIAL_WAKE_LOCK, "FamilyChat:PollWakeLock");
                pollWakeLock.setReferenceCounted(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "initWakeLock error: " + e.getMessage());
        }
    }

    private void acquirePollWakeLock() {
        try {
            if (pollWakeLock != null && !pollWakeLock.isHeld()) {
                pollWakeLock.acquire(30000);
            }
        } catch (Exception e) {
            Log.e(TAG, "acquirePollWakeLock error: " + e.getMessage());
        }
    }

    private void releasePollWakeLock() {
        try {
            if (pollWakeLock != null && pollWakeLock.isHeld()) {
                pollWakeLock.release();
            }
        } catch (Exception e) {
            Log.e(TAG, "releasePollWakeLock error: " + e.getMessage());
        }
    }

    private void registerReceivers() {
        try {
            IntentFilter connFilter = new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION);
            connectivityReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    Log.d(TAG, "Connectivity changed, triggering poll");
                    FamilyChatApp.isAppForeground = true;
                    FamilyChatApp.lastForegroundTime = System.currentTimeMillis();
                    triggerPollIfPossible();
                    scheduleAlarms();
                }
            };
            registerReceiver(connectivityReceiver, connFilter);
        } catch (Exception e) {
            Log.e(TAG, "register connectivity receiver failed: " + e.getMessage());
        }

        try {
            IntentFilter screenFilter = new IntentFilter();
            screenFilter.addAction(Intent.ACTION_SCREEN_ON);
            screenFilter.addAction(Intent.ACTION_SCREEN_OFF);
            screenReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                        isInDoze = true;
                        Log.d(TAG, "Screen off - switching to doze-compatible polling");
                    } else if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
                        isInDoze = false;
                        FamilyChatApp.isAppForeground = true;
                        FamilyChatApp.lastForegroundTime = System.currentTimeMillis();
                        triggerPollIfPossible();
                    }
                    scheduleAlarms();
                }
            };
            registerReceiver(screenReceiver, screenFilter);
        } catch (Exception e) {
            Log.e(TAG, "register screen receiver failed: " + e.getMessage());
        }
    }

    private long getSmartPollInterval() {
        long now = System.currentTimeMillis();

        if (FamilyChatApp.isAppForeground) {
            return 5000;
        }

        long timeSinceForeground = now - FamilyChatApp.lastForegroundTime;

        if (isInDoze || timeSinceForeground > 300000) {
            return 300000;
        }

        if (timeSinceForeground > 60000) {
            return 60000;
        }

        return 30000;
    }

    private void scheduleAlarms() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am == null) return;

            Intent pollIntent = new Intent(RestartReceiver.ACTION_POLL);
            pollIntent.setPackage(getPackageName());
            PendingIntent pollPi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pollPi = PendingIntent.getBroadcast(this, ALARM_POLL_REQUEST_CODE, pollIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            } else {
                pollPi = PendingIntent.getBroadcast(this, ALARM_POLL_REQUEST_CODE, pollIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT);
            }

            long interval = getSmartPollInterval();
            long triggerAt = SystemClock.elapsedRealtime() + interval;

            am.cancel(pollPi);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pollPi);
            } else {
                am.setRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, interval, pollPi);
            }
            Log.d(TAG, "Alarm scheduled interval=" + interval + "ms (foreground=" + FamilyChatApp.isAppForeground + ")");

            Intent restartIntent = new Intent(RestartReceiver.ACTION_RESTART_SERVICE);
            restartIntent.setPackage(getPackageName());
            PendingIntent restartPi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                restartPi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, restartIntent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            } else {
                restartPi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, restartIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT);
            }
            am.cancel(restartPi);
            am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    SystemClock.elapsedRealtime() + 120000, 120000, restartPi);
        } catch (Exception e) {
            Log.e(TAG, "scheduleAlarms failed: " + e.getMessage());
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "ForegroundService onStartCommand, action=" + (intent != null ? intent.getAction() : "null"));

        startForeground(NOTIFICATION_ID, buildServiceNotification());

        if (intent != null && ACTION_TRIGGER_POLL.equals(intent.getAction())) {
            acquirePollWakeLock();
            triggerPollIfPossible();
            scheduleAlarms();
        } else if (intent != null && ACTION_KEEP_ALIVE.equals(intent.getAction())) {
        } else {
            acquirePollWakeLock();
            triggerPollIfPossible();
        }

        return START_STICKY;
    }

    private Notification buildServiceNotification() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, intent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                            : PendingIntent.FLAG_UPDATE_CURRENT);

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_email)
                    .setContentTitle("FamilyChat 在线")
                    .setContentText("后台运行中，自动接收新消息")
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .setContentIntent(pendingIntent)
                    .setWhen(System.currentTimeMillis())
                    .setShowWhen(false);

            return builder.build();
        } catch (Exception e) {
            Log.e(TAG, "buildServiceNotification failed: " + e.getMessage());
            return new Notification();
        }
    }

    private void triggerPollIfPossible() {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        final int userId = prefs.getInt(KEY_USER_ID, -1);
        if (userId <= 0) {
            Log.d(TAG, "No user ID - will retry later");
            releasePollWakeLock();
            return;
        }

        new Thread(new Runnable() {
            @Override
            public void run() {
                pollForMessages(userId);
                releasePollWakeLock();
            }
        }).start();
    }

    private void pollForMessages(int userId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        long lastCheck = prefs.getLong(KEY_LAST_CHECK, 0);
        long currentTime = System.currentTimeMillis();

        if (!isNetworkAvailable()) {
            Log.d(TAG, "No network - skipping poll");
            return;
        }

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
            conn.setReadTimeout(15000);
            conn.setRequestProperty("Accept", "application/json");
            conn.setUseCaches(false);

            int responseCode = conn.getResponseCode();
            if (responseCode != 200) {
                Log.w(TAG, "Poll response: " + responseCode);
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
            Log.d(TAG, "Got " + messages.length() + " new message(s)");

            for (int i = 0; i < messages.length(); i++) {
                try {
                    JSONObject msg = messages.getJSONObject(i);
                    int msgId = msg.getInt("id");
                    int senderId = msg.getInt("sender_id");
                    if (senderId == userId) continue;

                    String senderName = msg.optString("sender_name", "好友");
                    String content = msg.optString("content", "[图片/语音]");
                    if (content == null || content.isEmpty()) content = "[图片/语音]";

                    String knownKey = KEY_KNOWN_MSG_PREFIX + msgId;
                    if (!prefs.getBoolean(knownKey, false)) {
                        showMessageNotification(senderName, content, msgId);
                        prefs.edit().putBoolean(knownKey, true).apply();
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Error processing message " + i + ": " + e.getMessage());
                }
            }

            prefs.edit().putLong(KEY_LAST_CHECK, currentTime).apply();
        } catch (Exception e) {
            Log.w(TAG, "Poll failed: " + e.getMessage());
        } finally {
            if (conn != null) {
                try { conn.disconnect(); } catch (Exception e) {}
            }
        }
    }

    private boolean isNetworkAvailable() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            if (cm == null) return false;
            NetworkInfo activeNetwork = cm.getActiveNetworkInfo();
            return activeNetwork != null && activeNetwork.isConnectedOrConnecting();
        } catch (Exception e) {
            return false;
        }
    }

    private void showMessageNotification(String senderName, String content, int msgId) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)
                        != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                    Log.w(TAG, "No POST_NOTIFICATIONS permission, skipping notification");
                    return;
                }
            }

            Intent intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            PendingIntent pendingIntent = PendingIntent.getActivity(this, msgId, intent,
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                            : PendingIntent.FLAG_UPDATE_CURRENT);

            String displayContent = content.length() > 80 ? content.substring(0, 80) + "..." : content;

            Notification notification = new NotificationCompat.Builder(this, MSG_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_email)
                    .setContentTitle(senderName)
                    .setContentText(displayContent)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(displayContent))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setContentIntent(pendingIntent)
                    .setAutoCancel(true)
                    .setDefaults(NotificationCompat.DEFAULT_ALL)
                    .setTimeoutAfter(10000)
                    .build();

            NotificationManagerCompat nm = NotificationManagerCompat.from(this);
            nm.notify(10000 + (msgId % 1000), notification);
            Log.d(TAG, "Notification shown: " + senderName);
        } catch (Exception e) {
            Log.e(TAG, "showMessageNotification failed: " + e.getMessage());
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "onTaskRemoved - app task removed");
        try {
            Intent restartIntent = new Intent(this, ForegroundService.class);
            restartIntent.setPackage(getPackageName());
            PendingIntent restartPi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                restartPi = PendingIntent.getService(getApplicationContext(), ALARM_RESTART_REQUEST_CODE,
                        restartIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
            } else {
                restartPi = PendingIntent.getService(getApplicationContext(), ALARM_RESTART_REQUEST_CODE,
                        restartIntent, PendingIntent.FLAG_ONE_SHOT);
            }
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am != null) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 2000, restartPi);
            }
        } catch (Exception e) {
            Log.e(TAG, "onTaskRemoved restart failed: " + e.getMessage());
        }
        try {
            super.onTaskRemoved(rootIntent);
        } catch (Exception e) {}
    }

    @Override
    public void onDestroy() {
        Log.w(TAG, "ForegroundService onDestroy - will restart");
        releasePollWakeLock();
        try {
            if (connectivityReceiver != null) unregisterReceiver(connectivityReceiver);
        } catch (Exception e) {}
        try {
            if (screenReceiver != null) unregisterReceiver(screenReceiver);
        } catch (Exception e) {}

        try {
            Intent restartIntent = new Intent(this, ForegroundService.class);
            restartIntent.setPackage(getPackageName());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent);
            } else {
                startService(restartIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Self-restart failed: " + e.getMessage());
        }

        try {
            stopForeground(true);
        } catch (Exception e) {}
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}