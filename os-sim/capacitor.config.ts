import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'os.nova.shell',
  appName: 'NovaOS',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#05070d',
    // targetSdk 36 forces edge-to-edge, so the WebView runs under the status bar and
    // the gesture bar. WebView's env(safe-area-inset-*) is not reliable across OEM
    // WebView builds, so let Capacitor inset the WebView itself: 'force' applies the
    // real systemBar + displayCutout insets as margins on every API level (verified
    // in CapacitorWebView.edgeToEdgeHandler). The CSS --safe-* vars then resolve to
    // 0 and we do not double-pad.
    adjustMarginsForEdgeToEdge: 'force',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
