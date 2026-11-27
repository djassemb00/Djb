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

/**
 * The layers that can be open on the desk, each with the z-index it really paints at
 * (src/styles.css). A back press must close the TOPMOST one first.
 *
 * The app used to pass its handlers in the order `center, launcher, power`, so with the
 * notification centre (z 960) open and the launcher (z 970) or power menu (z 980) also
 * open, back closed the sheet *underneath* the visible one: the power menu stayed on
 * screen and the notification centre vanished behind it. Nobody could see that without
 * opening two sheets at once, which is exactly why it survived.
 *
 * Ordering lives here, as data, so a test can check it against the stylesheet instead of
 * trusting the call site.
 */
export const SHEET_Z: Record<'center' | 'launcher' | 'power', number> = {
  center: 960,
  launcher: 970,
  power: 980,
};

export type BackLayer = 'center' | 'launcher' | 'power' | 'machine' | 'desk';

/** topmost-first order, derived from SHEET_Z rather than written by hand */
export const BACK_ORDER: BackLayer[] = [
  ...(Object.keys(SHEET_Z) as (keyof typeof SHEET_Z)[]).sort((a, b) => SHEET_Z[b] - SHEET_Z[a]),
  'machine',
  'desk',
];

/**
 * Decide what one back press does. Pure, so every ordering case is testable without an
 * Android device.
 */
export function planBack(open: {
  center: boolean;
  launcher: boolean;
  power: boolean;
  machine: boolean;
}): BackLayer {
  for (const layer of BACK_ORDER) {
    if (layer === 'desk') break;
    if (layer === 'machine' ? open.machine : open[layer]) return layer;
  }
  // nothing open: let Android do its normal thing (pause/exit), never App.exitApp()
  return 'desk';
}

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
