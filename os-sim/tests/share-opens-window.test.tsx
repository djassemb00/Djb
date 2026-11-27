// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import * as nl from '../src/system/nativeLaunch';
import { useOS } from '../src/store/useOS';

/**
 * PLAN ٢-٣, the half that was still missing when the manifest and the plugin were done.
 *
 * NovaOS boots to the desktop. GameSetupApp exists only inside a window the user opens by
 * hand. So a shared file arrived, was classified, and then nothing happened -- visually
 * identical to the file never arriving. Mounting App and asserting a window appeared is
 * the only check that can see this: it lives between two files that were each correct.
 */
const fakePlugin = (share: nl.PendingShare) => ({
  detect: async () => ({ available: false, installed: [], version: '' }),
  openContainer: async () => ({ launched: false }),
  takePendingShare: async () => share,
});

describe('a shared file opens the window that shows it', () => {
  beforeEach(() => {
    nl.__resetSharedFileCache();
    nl.__setNativeLaunchForTest(null);
    document.body.innerHTML = '';
    useOS.setState({ phase: 'desktop', windows: [], focused: null });
  });

  it('opens the setup window when there is a pending share', async () => {
    nl.__setNativeLaunchForTest(
      fakePlugin({ pending: true, name: 'GAME.EXE', type: 'application/x-msdownload', uri: 'c://1' }),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    /*
     * App calls beginBoot() on mount, so the real launch order is desktop -> boot -> lock
     * -> desktop. The card must appear at the END of that, not during the boot screen:
     * unlock() sets `windows: []`, so a window opened early is wiped silently.
     */
    await act(async () => {
      useOS.getState().finishBoot();
      useOS.getState().unlock();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const windows = useOS.getState().windows;
    expect(windows.length, 'the share must survive boot and unlock').toBe(1);
    expect(windows[0].appId).toBe('setup');
    await act(async () => root.unmount());
  });

  /**
   * The phase guard is load-bearing, and I only found out by mutating it: useOS.unlock()
   * sets `{ phase: 'desktop', windows: [] }`, so a window opened while the lock screen is
   * up is WIPED the moment the user unlocks. A share would then have opened the app and
   * shown nothing, which is the original defect wearing a different mask. So the read
   * waits for the desktop.
   */
  it('waits for the desktop instead of opening under the lock screen', async () => {
    useOS.setState({ phase: 'lock', windows: [], focused: null });
    nl.__setNativeLaunchForTest(
      fakePlugin({ pending: true, name: 'GAME.EXE', type: 'application/x-msdownload', uri: 'c://1' }),
    );
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // nothing drawn behind the lock screen
    expect(useOS.getState().windows.length).toBe(0);
    // now unlock, exactly as the lock screen would
    await act(async () => {
      useOS.getState().unlock();
    });
    await act(async () => {
      await Promise.resolve();
    });
    const windows = useOS.getState().windows;
    expect(windows.length, 'the share must survive the unlock that clears all windows').toBe(1);
    expect(windows[0].appId).toBe('setup');
    await act(async () => root.unmount());
  });

  it('opens nothing on a normal launch', async () => {
    nl.__setNativeLaunchForTest(fakePlugin({ pending: false }));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      useOS.getState().finishBoot();
      useOS.getState().unlock();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(useOS.getState().windows.length).toBe(0);
    await act(async () => root.unmount());
  });
});
