package com.familychat.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
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
    private static final long POLL_INTERVAL_MS = 8000;
    private static final long ALARM_RESTART_INTERVAL_MS = 60000;
    private static final int ALARM_RESTART_REQUEST_CODE = 5555;

    private Handler handler;
    private Runnable pollRunnable;
    private boolean isPolling = false;
    private int notificationId = 200;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private BroadcastReceiver connectivityReceiver;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        Log.d(TAG, "ForegroundService created");

        acquireLocks();
        registerConnectivityReceiver();
        scheduleAlarmRestart();
    }

    private void acquireLocks() {
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FamilyChat:SvcWakeLock");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
                Log.d(TAG, "ForegroundService WakeLock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "WakeLock acquire failed: " + e.getMessage());
        }

        try {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "FamilyChat:SvcWifiLock");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
                Log.d(TAG, "ForegroundService WifiLock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "WifiLock acquire failed: " + e.getMessage());
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception e) {}
        try {
            if (wifiLock != null && wifiLock.isHeld()) {
                wifiLock.release();
            }
        } catch (Exception e) {}
    }

    private void registerConnectivityReceiver() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                registerReceiver(connectivityReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        onConnectivityChanged();
                    }
                }, new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION), Context.RECEIVER_NOT_EXPORTED);
            } else {
                IntentFilter filter = new IntentFilter(ConnectivityManager.CONNECTIVITY_ACTION);
                registerReceiver(connectivityReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        onConnectivityChanged();
                    }
                }, filter);
            }
        } catch (Exception e) {
            Log.e(TAG, "registerConnectivityReceiver failed: " + e.getMessage());
        }
    }

    private void unregisterConnectivityReceiver() {
        if (connectivityReceiver != null) {
            try {
                unregisterReceiver(connectivityReceiver);
            } catch (Exception e) {}
            connectivityReceiver = null;
        }
    }

    private void onConnectivityChanged() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
            NetworkInfo net = cm != null ? cm.getActiveNetworkInfo() : null;
            if (net != null && net.isConnected()) {
                Log.d(TAG, "Network connected, resuming poll");
                if (!isPolling) {
                    startPollingFromPrefs();
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "onConnectivityChanged failed: " + e.getMessage());
        }
    }

    private void scheduleAlarmRestart() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am == null) return;
            Intent intent = new Intent("com.familychat.app.RESTART_SERVICE");
            intent.setPackage(getPackageName());
            PendingIntent pi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, intent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            } else {
                pi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, intent,
                        PendingIntent.FLAG_UPDATE_CURRENT);
            }
            long triggerAt = SystemClock.elapsedRealtime() + ALARM_RESTART_INTERVAL_MS;
            am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, ALARM_RESTART_INTERVAL_MS, pi);
            Log.d(TAG, "Alarm restart scheduled at " + triggerAt);
        } catch (Exception e) {
            Log.e(TAG, "scheduleAlarmRestart failed: " + e.getMessage());
        }
    }

    private void cancelAlarmRestart() {
        try {
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am == null) return;
            Intent intent = new Intent("com.familychat.app.RESTART_SERVICE");
            intent.setPackage(getPackageName());
            PendingIntent pi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                pi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, intent,
                        PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_NO_CREATE);
            } else {
                pi = PendingIntent.getBroadcast(this, ALARM_RESTART_REQUEST_CODE, intent,
                        PendingIntent.FLAG_NO_CREATE);
            }
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        } catch (Exception e) {}
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
                    .setContentText("后台服务正在运行，保持消息接收")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_MIN)
                    .setContentIntent(pendingIntent)
                    .setWhen(System.currentTimeMillis())
                    .setShowWhen(false)
                    .build();

            startForeground(1, notification);
        }

        if (wakeLock == null || !wakeLock.isHeld()) {
            acquireLocks();
        }

        if (!isPolling) {
            startPollingFromPrefs();
        }

        return START_REDELIVER_INTENT;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "onTaskRemoved - app task removed, will try to restart");
        try {
            Intent restartIntent = new Intent(this, ForegroundService.class);
            restartIntent.setPackage(getPackageName());
            PendingIntent restartPi;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                restartPi = PendingIntent.getService(getApplicationContext(), 9999,
                        restartIntent, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_ONE_SHOT);
            } else {
                restartPi = PendingIntent.getService(getApplicationContext(), 9999,
                        restartIntent, PendingIntent.FLAG_ONE_SHOT);
            }
            AlarmManager am = (AlarmManager) getSystemService(ALARM_SERVICE);
            if (am != null) {
                am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        SystemClock.elapsedRealtime() + 1000, restartPi);
            }
        } catch (Exception e) {
            Log.e(TAG, "onTaskRemoved restart failed: " + e.getMessage());
        }
        super.onTaskRemoved(rootIntent);
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
        stopPolling();
        releaseLocks();
        unregisterConnectivityReceiver();
        try {
            Intent restartIntent = new Intent(this, ForegroundService.class);
            restartIntent.setPackage(getPackageName());
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartIntent);
            } else {
                startService(restartIntent);
            }
            Log.d(TAG, "ForegroundService self-restarted on destroy");
        } catch (Exception e) {
            Log.e(TAG, "ForegroundService self-restart failed: " + e.getMessage());
        }
        try {
            super.onDestroy();
        } catch (Exception e) {}
        Log.d(TAG, "ForegroundService destroyed (attempting restart)");
    }
}