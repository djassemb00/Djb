// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import * as nl from '../src/system/nativeLaunch';
import { useOS } from '../src/store/useOS';

/**
 * The window a share opens has to fit the phone it opens on.
 *
 * `open()` clamps to the viewport, but the viewport starts at 1280x800 (a desktop guess)
 * and is only correct once something has measured the real screen. On the target device
 * -- HONOR Magic4 Pro, 1312x2848 CSS px at DPR ~3.5 -- a 660x560 window centred with the
 * default arithmetic is a different rectangle than on a laptop, and `open()` marks it
 * `max: narrow` below 760 px. This asserts the reported dimensions are inside the
 * viewport for a real phone size, because "opens a window" is not the same as "opens one
 * the user can see".
 */
const fakePlugin = {
  detect: async () => ({ available: false, installed: [], version: '' }),
  openContainer: async () => ({ launched: false }),
  takePendingShare: async () => ({
    pending: true,
    name: 'GAME.EXE',
    type: 'application/x-msdownload',
    uri: 'c://1',
  }),
};

const mountAt = async (w: number, h: number) => {
  /*
   * jsdom reports 1024x768, and App measures window.innerWidth on mount, so setting the
   * store's viewport alone is overwritten a tick later -- the first version of this test
   * therefore measured a desktop window and called it a phone. The window has to lie
   * about its own size for the test to mean anything.
   */
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
  useOS.setState({ phase: 'desktop', windows: [], focused: null, viewport: { w, h } });
  nl.__setNativeLaunchForTest(null);
  nl.__resetSharedFileCache();
  nl.__setNativeLaunchForTest(fakePlugin);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<App />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  // the real launch order: mount boots the store, so finish it before looking
  await act(async () => {
    useOS.getState().finishBoot();
    useOS.getState().unlock();
  });
  await act(async () => {
    await Promise.resolve();
  });
  const win = useOS.getState().windows[0];
  await act(async () => root.unmount());
  return win;
};

describe('the share window fits the real screen', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fits a phone viewport with no horizontal overflow', async () => {
    // 393x852 CSS px is a Magic4 Pro / Mate-class screen at DPR 3.5
    const win = await mountAt(393, 852);
    expect(win, 'no window was opened').toBeTruthy();
    expect(win.x).toBeGreaterThanOrEqual(0);
    expect(win.x + win.w).toBeLessThanOrEqual(393);
    expect(win.y + win.h).toBeLessThanOrEqual(852);
    expect(win.max, 'a phone window should be maximised, not floating').toBe(true);
  });

  it('fits a 1280x800 desktop without touching the edges', async () => {
    const win = await mountAt(1280, 800);
    expect(win.x + win.w).toBeLessThanOrEqual(1280);
    expect(win.y + win.h).toBeLessThanOrEqual(800);
    expect(win.h).toBeLessThanOrEqual(560);
  });
});
