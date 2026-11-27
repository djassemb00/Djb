/**
 * The web side of the thermal bridge.
 *
 * On the phone, Capacitor exposes `ThermalPlugin.read()`; in the browser it does not
 * exist and we fall back to what the page itself can see. Either way the governor in
 * `thermal.ts` receives the same shape, so there is exactly one code path downstream
 * and no `if (android)` scattered through the UI.
 */
import { setNativeThermalReader, type ThermalLevel } from './thermal';

/** the same order Android uses for THERMAL_STATUS_*, plus "unknown" for older OSes */
const ORDER: ThermalLevel[] = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'];

export interface NativeReading {
  status: number;
  headroom?: number;
  battery: number;
  charging: boolean;
  sdk: number;
  device: string;
}

type PluginHandle = { read: () => Promise<NativeReading> };

/**
 * Two shapes are valid in the wild:
 *  - a plugin registered through `registerPlugin()` (what @capacitor/core produces,
 *    and what a native build always gives us);
 *  - a plain object on `Capacitor.Plugins` (what tests and the browser preview use).
 * Both are accepted here so the rest of the app has one code path.
 */
type CapacitorLike = {
  Plugins?: Record<string, PluginHandle>;
  registerPlugin?: (name: string) => PluginHandle;
  PluginHeaders?: { name: string }[];
};

function cap(): CapacitorLike | null {
  return (window as unknown as { Capacitor?: CapacitorLike }).Capacitor ?? null;
}

function plugin(): PluginHandle | null {
  const c = cap();
  if (!c) return null;
  if (c.Plugins?.NovaThermal) return c.Plugins.NovaThermal;
  // a native build announces the plugin in PluginHeaders before any JS imports it
  const announced = c.PluginHeaders?.some((h) => h.name === 'NovaThermal');
  if (announced && typeof c.registerPlugin === 'function') {
    const p = c.registerPlugin('NovaThermal');
    c.Plugins = { ...(c.Plugins ?? {}), NovaThermal: p };
    return p;
  }
  return null;
}

export function nativeAvailable(): boolean {
  return plugin() !== null;
}

/** one-shot read used by the governor and the monitor card */
export async function readNative(): Promise<NativeReading | null> {
  const p = plugin();
  if (!p) return null;
  try {
    return await p.read();
  } catch {
    return null;
  }
}

/**
 * Install the synchronous reader the governor expects.
 *
 * `thermal.ts` samples on a timer and must not await, so we keep the last reading in
 * a module variable and refresh it in the background. A stale value is worse than no
 * value, so after 30 s of failed refreshes we report "unavailable" instead of an old
 * temperature.
 */
let last: { at: number; status: number; headroom?: number } | null = null;
let timer: number | null = null;

export function startThermalBridge(intervalMs = 10_000): () => void {
  if (!nativeAvailable()) {
    setNativeThermalReader(null);
    return () => undefined;
  }
  const tick = async () => {
    const r = await readNative();
    if (r) last = { at: Date.now(), status: r.status, headroom: r.headroom };
  };
  void tick();
  timer = window.setInterval(() => void tick(), intervalMs);

  setNativeThermalReader(() => {
    if (!last || Date.now() - last.at > 30_000) return null;
    return { thermal: last.status >= 0 ? last.status : undefined, headroom: last.headroom };
  });

  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    last = null;
    setNativeThermalReader(null);
  };
}

/** human label for the native status code, used by the monitor card */
export function statusLabel(status: number): string {
  if (status < 0) return 'غير متاح على هذا الإصدار';
  return ORDER[Math.min(status, ORDER.length - 1)];
}
