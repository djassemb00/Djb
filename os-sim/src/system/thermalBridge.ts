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

/** Capacitor injects plugins on `window` at runtime; typed loosely on purpose */
function plugin(): PluginHandle | null {
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, PluginHandle> } }).Capacitor;
  return cap?.Plugins?.NovaThermal ?? null;
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
