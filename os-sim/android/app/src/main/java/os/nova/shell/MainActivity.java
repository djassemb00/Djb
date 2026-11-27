package os.nova.shell;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * The only Java in the app.
 *
 * Capacitor needs the plugins registered before the bridge starts, so this class
 * stays deliberately thin: register, then let the web app do everything else. The
 * thermal plugin is ours (see ThermalPlugin.kt); the rest come from Capacitor.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ThermalPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
