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
    // 'unknown', NOT 'none': the test name and the assertion used to disagree, and the
    // old assertion (none = "طبيعية" in the UI) was exactly the lie the name denied.
    expect(g.thermal).toBe('unknown');
    expect(g.throttle).toBe(1);
    expect(g.reason).toContain('لا يمكن قراءة');
  });

  it('throttles for heat and says so, and never mixes the two reasons up', async () => {
    const { setNativeThermalReader: set } = await import('../src/system/thermal');
    set(() => ({ thermal: 3, headroom: 0.1 })); // severe
    const severe = await readGovernor();
    expect(severe.thermal).toBe('severe');
    expect(severe.throttle).toBe(0.4);
    expect(severe.reason).toContain('مرتفعة');

    // a real 'none' (0) from the platform is what "normal" looks like; a *missing*
    // reading must never be shown as normal, so that case is asserted separately above
    set(() => ({ thermal: 0, headroom: 0.2 }));
    const cool = await readGovernor();
    expect(cool.thermal).toBe('none');
    expect(cool.throttle).toBe(1);
    expect(cool.reason).toContain('طبيعية');
  });

  it('lets headroom tighten the throttle but never loosen a severe status', async () => {
    const { setNativeThermalReader: set } = await import('../src/system/thermal');
    // cool status but a forecast that says throttling is imminent -> half speed
    set(() => ({ thermal: 1, headroom: 0.95 }));
    const forecast = await readGovernor();
    expect(forecast.throttle).toBe(0.5);
    expect(forecast.reason).toContain('الخنق الحراري');

    // severe status with a reassuring forecast must stay severe (the old code let the
    // later branch overwrite this back up to 0.5)
    set(() => ({ thermal: 4, headroom: 0.2 }));
    const severe = await readGovernor();
    expect(severe.throttle).toBe(0.2);
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
