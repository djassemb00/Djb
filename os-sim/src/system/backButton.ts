/**
 * Hardware / gesture back for the Android shell.
 *
 * Android 13+ replaces the three-button bar with a back gesture, and in a WebView it
 * does the only thing a browser knows: it leaves. Our shell has several levels (boot ->
 * lock -> desk -> machine -> sheets), so a single accidental edge swipe used to throw
 * the user out of a running VM and back to the launcher, losing nothing but looking
 * broken.
 *
 * Registered through @capacitor/app's `backButton` listener. That listener is what
 * disables Capacitor's default "go back in WebView history" behaviour, so we own the
 * decision completely: each handler answers "did I consume it?". If nobody does, we call
 * `minimizeApp()` — which is what a home-level app is expected to do. We never call
 * `App.exitApp()`: killing a running VM on a stray swipe is hostile.
 *
 * On the web this is a no-op: there is no back button to intercept.
 */
type Handler = () => boolean;

export function installBackHandler(stack: Handler[]): () => void {
  let disposed = false;
  let remove: (() => void) | null = null;

  void (async () => {
    try {
      // Imported lazily: @capacitor/app is a native module and the browser preview
      // has no reason to evaluate it during boot.
      const mod = await import('@capacitor/app');
      const App = mod.App;
      if (!App) return;
      const handle = await App.addListener('backButton', () => {
        // topmost first: the LAST registered sheet is the one on screen
        for (const h of [...stack].reverse()) {
          if (h()) return;
        }
        void App.minimizeApp();
      });
      if (disposed) void handle.remove();
      else remove = () => void handle.remove();
    } catch {
      /* web build, or the plugin is not installed: nothing to intercept */
    }
  })();

  return () => {
    disposed = true;
    remove?.();
  };
}
