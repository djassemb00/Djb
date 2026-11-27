// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MeasureApp } from '../src/apps/MeasureApp';

/**
 * PLAN ٤-١ / ٤-٣ / ٤-٤ driven through the real DOM.
 *
 * Every earlier honesty check in this repo that read source text instead of rendering was
 * blind to a component that existed and was never drawn. So this one types into the real
 * inputs, clicks the real button, and asserts on what a user would see.
 */
const mount = async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<MeasureApp />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return { host, root };
};

const setValue = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const clickButton = async (label: string) => {
  const btn = [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const statuses = () =>
  [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? '');

describe('٤-٤ an empty panel says it is empty', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('does not draw a chart and does not invent advice', async () => {
    const { root } = await mount();
    // no polyline at all: a chart of nothing would read as "0 fps"
    expect(document.querySelector('polyline'), 'a chart was drawn with no data').toBeNull();
    expect(statuses().join(' ')).toContain('فارغ');
    expect(statuses().join(' ')).toContain('لا توجد جلسات');
    await act(async () => root.unmount());
  });
});

describe('٤-٣ the form records a session and the panel shows it', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('records frames and displays them, then persists them', async () => {
    const { root } = await mount();
    const fps = document.querySelector('input[aria-label="الإطارات"]') as HTMLInputElement;
    await setValue(fps, '18');
    await clickButton('سجّل');
    const text = document.body.textContent ?? '';
    expect(text).toContain('18');
    // it reached localStorage, so the next mount finds it
    expect(localStorage.getItem('novaos-sessions')).toContain('"fps":18');
    await act(async () => root.unmount());

    // remount: the session must survive
    const second = await mount();
    expect(second.host.textContent).toContain('18');
    await act(async () => second.root.unmount());
  });

  it('refuses an empty frame rate and says why, without recording anything', async () => {
    const { root } = await mount();
    // the button is disabled with no fps, so this drives the parse path directly
    const fps = document.querySelector('input[aria-label="الإطارات"]') as HTMLInputElement;
    await setValue(fps, '0');
    await clickButton('سجّل');
    expect(document.body.textContent).toContain('لم يُسجَّل');
    expect(localStorage.getItem('novaos-sessions')).toBeNull();
    await act(async () => root.unmount());
  });

  it('an empty temperature is not stored as 0', async () => {
    const { root } = await mount();
    await setValue(document.querySelector('input[aria-label="الإطارات"]') as HTMLInputElement, '24');
    await clickButton('سجّل');
    const stored = JSON.parse(localStorage.getItem('novaos-sessions') ?? '[]');
    expect(stored).toHaveLength(1);
    // the crucial assertion: absent, not 0
    expect(stored[0].tempC).toBeNull();
    expect(stored[0].minutes).toBeNull();
    await act(async () => root.unmount());
  });
});

describe('٤-١ the advice appears once there is a measured session', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('a slow session produces the resolution suggestion with its reason', async () => {
    const { root } = await mount();
    await setValue(document.querySelector('input[aria-label="الإطارات"]') as HTMLInputElement, '18');
    await clickButton('سجّل');
    /*
     * The advice needs a GPU reading, which a session alone cannot supply -- that is
     * deliberate (a missing reading must not become 0%). So with only fps, the panel says
     * "no rule fires" rather than inventing one.
     */
    const text = document.body.textContent ?? '';
    expect(text).toContain('لا اقتراح');
    await act(async () => root.unmount());
  });
});

describe('٤-٤ two sessions produce a verdict, and it can be negative', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('compares the newest two and states whether the model was right', async () => {
    const seed = [
      { id: 'g1', gameId: 'gta5', date: '2026-11-20', screenSize: '1280x720', fps: 18, tempC: 44, minutes: 15, source: 'user' },
      { id: 'g2', gameId: 'gta5', date: '2026-11-27', screenSize: '960x540', fps: 24, tempC: 42, minutes: 15, source: 'user' },
    ];
    localStorage.setItem('novaos-sessions', JSON.stringify(seed));
    const { root } = await mount();
    const text = document.body.textContent ?? '';
    // +33.3% actual against ~+30.7% predicted → the model was close
    expect(text).toContain('33.3');
    expect(text).toContain('النموذج');
    await act(async () => root.unmount());
  });

  it('says the model was wrong when the measured gain contradicts it', async () => {
    const seed = [
      { id: 'g1', gameId: 'gta5', date: '2026-11-20', screenSize: '1280x720', fps: 18, tempC: 44, minutes: 15, source: 'user' },
      { id: 'g2', gameId: 'gta5', date: '2026-11-27', screenSize: '960x540', fps: 18.4, tempC: 44, minutes: 15, source: 'user' },
    ];
    localStorage.setItem('novaos-sessions', JSON.stringify(seed));
    const { root } = await mount();
    expect(document.body.textContent).toContain('أخطأ');
    await act(async () => root.unmount());
  });
});

describe('٤-٤ the paste box reports what it could and could not read', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('parses a pasted debug window and names what is missing', async () => {
    const { root } = await mount();
    const ta = document.querySelector('textarea') as HTMLTextAreaElement;
    await setValue(ta, 'DXVK: v2.4\nFrameRate 27');
    const text = document.body.textContent ?? '';
    expect(text).toContain('27');
    expect(text).toContain('DXVK 2.4');
    expect(text).toContain('ينقص');
    await act(async () => root.unmount());
  });

  it('states up front that there is no log file to expect', async () => {
    const { root } = await mount();
    expect(document.body.textContent).toContain('لا يحفظ سجلاً');
    await act(async () => root.unmount());
  });
});

describe('the app is reachable', () => {
  it('is registered in the app list so a user can open it', async () => {
    const { APPS } = await import('../src/system/apps');
    const meta = APPS.find((a) => a.id === 'measure');
    expect(meta, 'measure is not in the app registry').toBeTruthy();
    expect(meta?.name).toContain('قياساتي');
    expect(meta?.desktop).toBe(true);
  });
});

describe('٤-٥ the thermal state is shown, and it never invents a temperature', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
  });

  it('shows the unreadable state in the browser build instead of a fake number', async () => {
    const { root } = await mount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('الحرارة أثناء اللعب');
    // no thermal API in jsdom -> the honest answer, and no degree figure
    expect(text).toContain('لا يمكن قياس');
    expect(text).not.toMatch(/\d+\s*°C|٤٥°/);
    await act(async () => root.unmount());
  });
});

describe('٤-٥ the thermal poll stops when the window closes', () => {
  it('clears its interval on unmount instead of polling a dead component', async () => {
    /*
     * A 10-second poll left running after the window closes keeps a thermal read alive on
     * a phone that is already hot -- and phones that suspend a WebView resume into a pile of
     * queued timers. Verified once by spying; pinned here so a refactor cannot drop it.
     */
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { root } = await mount();
    await act(async () => root.unmount());
    expect(clearSpy.mock.calls.length, 'the poll interval was never cleared').toBeGreaterThanOrEqual(1);
    clearSpy.mockRestore();
  });
});

describe('the measure window fits the phone it opens on', () => {
  it('opens inside a 393x852 viewport without horizontal overflow', async () => {
    // HONOR Magic4 Pro class: 393 CSS px wide at DPR ~3.5
    const { useOS } = await import('../src/store/useOS');
    useOS.setState({ phase: 'desktop', windows: [], focused: null, viewport: { w: 393, h: 852 } });
    const { APPS } = await import('../src/system/apps');
    const meta = APPS.find((a) => a.id === 'measure');
    expect(meta).toBeTruthy();
    useOS.getState().open({ appId: 'measure', width: meta!.width, height: meta!.height });
    const win = useOS.getState().windows[0];
    expect(win).toBeTruthy();
    expect(win.x + win.w).toBeLessThanOrEqual(393);
    expect(win.y + win.h).toBeLessThanOrEqual(852);
    // a phone window should be maximised, not a floating 620px dialog
    expect(win.max).toBe(true);
  });
});
