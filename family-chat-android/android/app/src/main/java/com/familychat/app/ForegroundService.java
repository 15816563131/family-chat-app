package com.familychat.app;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class ForegroundService extends Service {
    private static final String TAG = "FamilyChat";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "ForegroundService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "ForegroundService starting");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification notification = new NotificationCompat.Builder(this, "family_chat_foreground")
                    .setContentTitle("FamilyChat Running")
                    .setContentText("Background service is active")
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setOngoing(true)
                    .setPriority(NotificationCompat.PRIORITY_LOW)
                    .build();

            startForeground(1, notification);
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "ForegroundService destroyed");
    }
}