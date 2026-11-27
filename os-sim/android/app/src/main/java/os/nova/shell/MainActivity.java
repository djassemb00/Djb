package os.nova.shell;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * The only Java in the app.
 *
 * Capacitor needs the plugins registered before the bridge starts, so this class
 * stays deliberately thin: register, then let the web app do everything else. The
 * thermal and launch plugins are ours (ThermalPlugin.kt, NativeLaunchPlugin.kt); the rest
 * come from Capacitor.
 *
 * PLAN ٢-٣ forced one thing in here. The manifest declares two intent filters, so Android
 * can start this activity with a file attached. Nothing reads a window's intent on its
 * own: without the two overrides below, tapping "Share -> NovaPC" on a downloaded .exe
 * opened the app and then did exactly nothing, which looks identical to a crash. The
 * intent is handed to NativeLaunchPlugin (see `takePendingShare`) and never acted on here,
 * because the web app is the layer that decides what a file means.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThermalPlugin.class);
        registerPlugin(NativeLaunchPlugin.class);
        super.onCreate(savedInstanceState);
        NativeLaunchPlugin.stash(this, getIntent());
    }

    /**
     * The activity is singleTask (see the manifest), so a second share while the app is
     * already running arrives here rather than in onCreate. Without this override the
     * second file is dropped silently, which is the same class of bug as not reading the
     * intent at all, so it gets its own override.
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        NativeLaunchPlugin.stash(this, intent);
    }
}
