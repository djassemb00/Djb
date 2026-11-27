import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGovernor, setNativeThermalReader } from '../src/system/thermal';
import { nativeAvailable, readNative, startThermalBridge, statusLabel } from '../src/system/thermalBridge';

/** a fake Capacitor bridge: the same surface the Kotlin plugin exposes */
function installFake(status: number, headroom?: number) {
  (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
    Plugins: {
      NovaThermal: {
        read: async () => ({ status, headroom, battery: 73, charging: false, sdk: 34, device: 'HONOR BVL-N49' }),
      },
    },
  };
}

describe('thermal bridge', () => {
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = globalThis;
    delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
  });
  afterEach(() => {
    setNativeThermalReader(null);
    delete (globalThis as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it('reports unavailable in a browser and does not pretend the device is cool', async () => {
    expect(nativeAvailable()).toBe(false);
    expect(await readNative()).toBeNull();
    const g = await readGovernor();
    expect(g.thermal).toBe('none');
    expect(g.throttle).toBe(1);
  });

  it('drives the governor from the platform reading', async () => {
    installFake(2, 0.7);
    expect(nativeAvailable()).toBe(true);
    const stop = startThermalBridge(20);
    await new Promise((r) => setTimeout(r, 60));
    const g = await readGovernor();
    stop();
    expect(g.thermal).toBe('moderate');
    expect(g.throttle).toBeLessThan(1);
  });

  it('finds a plugin announced by PluginHeaders and registered lazily', async () => {
    let registered = 0;
    const calls: string[] = [];
    (globalThis as unknown as { Capacitor: unknown }).Capacitor = {
      PluginHeaders: [{ name: 'NovaThermal' }],
      registerPlugin: (name: string) => {
        registered++;
        return {
          read: async () => {
            calls.push(name);
            return { status: 1, battery: 90, charging: true, sdk: 34, device: 'x' };
          },
        };
      },
    };
    expect(nativeAvailable()).toBe(true);
    const r = await readNative();
    expect(registered).toBe(1);
    expect(r?.status).toBe(1);
    expect(calls).toEqual(['NovaThermal']);
  });

  it('labels every status, including an unsupported one', () => {
    expect(statusLabel(-1)).toContain('غير متاح');
    expect(statusLabel(0)).toBe('none');
    expect(statusLabel(2)).toBe('moderate');
    expect(statusLabel(6)).toBe('shutdown');
    expect(statusLabel(99)).toBe('shutdown');
  });
});
