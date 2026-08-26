package com.familychat.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

public class RestartReceiver extends BroadcastReceiver {
    private static final String TAG = "FamilyChat";
    public static final String ACTION_RESTART_SERVICE = "com.familychat.app.RESTART_SERVICE";
    public static final String ACTION_POLL = "com.familychat.app.POLL";
    public static final String ACTION_RENEW_CHECK = "com.familychat.app.RENEW_CHECK";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Log.d(TAG, "RestartReceiver received: " + action);

        try {
            if (ACTION_RESTART_SERVICE.equals(action)) {
                Intent serviceIntent = new Intent(context, ForegroundService.class);
                serviceIntent.setPackage(context.getPackageName());
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, serviceIntent);
                } else {
                    context.startService(serviceIntent);
                }
                Log.d(TAG, "RestartReceiver: ForegroundService started");
            } else if (ACTION_POLL.equals(action)) {
                Intent pollIntent = new Intent(context, ForegroundService.class);
                pollIntent.setPackage(context.getPackageName());
                pollIntent.setAction(ForegroundService.ACTION_TRIGGER_POLL);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    ContextCompat.startForegroundService(context, pollIntent);
                } else {
                    context.startService(pollIntent);
                }
                Log.d(TAG, "RestartReceiver: poll trigger sent");
            } else if (ACTION_RENEW_CHECK.equals(action)) {
                RenewHelper.checkAndRenew(context);
                Log.d(TAG, "RestartReceiver: renew check triggered");
            }
        } catch (Exception e) {
            Log.e(TAG, "RestartReceiver error: " + e.getMessage());
        }
    }
}
