// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { GameSetupApp } from '../src/apps/GameSetupApp';
import * as nl from '../src/system/nativeLaunch';

/**
 * The share card, proved by mounting the component and letting its effects run.
 *
 * Every honesty check in this repo until now asserted on file contents, which is why the
 * share lane looked finished while a shared file opened the app onto an empty desktop:
 * the manifest declared a filter, the classifier had tests, and nothing was ever drawn.
 * renderToStaticMarkup does not run useEffect, so that route would have "passed" against
 * a card that never appears. This mounts into jsdom instead and asserts on real DOM.
 */
async function mount(node = <GameSetupApp />) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  // one more turn: the share is read in an effect and resolves a promise
  await act(async () => {
    await Promise.resolve();
  });
  return { host, root };
}

const fakePlugin = (share: nl.PendingShare | null) => ({
  detect: async () => ({ available: false, installed: [], version: '' }),
  openContainer: async () => ({ launched: false }),
  takePendingShare: async () => share ?? { pending: false },
});

describe('the share card', () => {
  beforeEach(() => {
    nl.__resetSharedFileCache();
    nl.__setNativeLaunchForTest(null);
    document.body.innerHTML = '';
  });

  it('draws nothing when the app was opened normally', async () => {
    nl.__setNativeLaunchForTest(fakePlugin(null));
    const { host, root } = await mount();
    expect(host.textContent).not.toContain('ملف جاهز للتثبيت');
    expect(host.textContent).not.toContain('ملف مرفوض');
    await act(async () => root.unmount());
  });

  it('shows an accepted program by name', async () => {
    nl.__setNativeLaunchForTest(
      fakePlugin({ pending: true, name: 'GAME.EXE', type: 'application/x-msdownload', uri: 'content://1' }),
    );
    const { host, root } = await mount();
    expect(host.textContent).toContain('ملف جاهز للتثبيت');
    expect(host.textContent).toContain('GAME.EXE');
    expect(host.textContent).toContain('برنامج Windows');
    await act(async () => root.unmount());
  });

  it('shows the refusal reason, not a green tick, for an unsupported file', async () => {
    nl.__setNativeLaunchForTest(fakePlugin({ pending: true, name: 'photo.jpg', type: 'image/jpeg', uri: 'c://1' }));
    const { host, root } = await mount();
    expect(host.textContent).toContain('ملف مرفوض');
    expect(host.textContent).toContain('photo.jpg');
    expect(host.textContent).toContain('jpg');
    expect(host.textContent).not.toContain('ملف جاهز للتثبيت');
    await act(async () => root.unmount());
  });

  it('refuses a file whose type contradicts its name', async () => {
    // a sender can label anything .exe; the type is the second opinion
    nl.__setNativeLaunchForTest(fakePlugin({ pending: true, name: 'holiday.exe', type: 'image/jpeg', uri: 'c://2' }));
    const { host, root } = await mount();
    expect(host.textContent).toContain('ملف مرفوض');
    expect(host.textContent).toContain('image/jpeg');
    await act(async () => root.unmount());
  });
});
