import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateProfile, toContainerJson } from '../src/system/winePrefix';
import { buildProfile, type Profile } from '../src/system/profileSchema';

/**
 * PLAN ٣-٣: local-first, and a save that did not land must say so.
 *
 * There is no fake IndexedDB here on purpose. The interesting case -- the one this repo
 * has been burned by twice -- is "storage is unavailable": a save that resolves happily
 * while nothing was written. So the unavailable case is tested for real (vitest has no
 * indexedDB), and the working case is tested against a small in-memory store that obeys
 * the same contract, with the module re-imported so its cached connection does not leak
 * between the two worlds.
 */

/** a minimal IDBObjectStore contract: only what profileStore.ts calls */
function fakeIndexedDB() {
  const data = new Map<string, unknown>();
  const store = {
    put: (value: unknown, key: string) => {
      data.set(key, value);
      const req: Record<string, unknown> = {};
      setTimeout(() => (req.onsuccess as () => void)?.(), 0);
      return req;
    },
    get: (key: string) => {
      const req: Record<string, unknown> = { result: data.get(key) };
      setTimeout(() => (req.onsuccess as () => void)?.(), 0);
      return req;
    },
    getAllKeys: () => {
      const req: Record<string, unknown> = { result: [...data.keys()] };
      setTimeout(() => (req.onsuccess as () => void)?.(), 0);
      return req;
    },
    delete: (key: string) => {
      data.delete(key);
      const req: Record<string, unknown> = {};
      setTimeout(() => (req.onsuccess as () => void)?.(), 0);
      return req;
    },
  };
  return {
    data,
    open: () => {
      const req: Record<string, unknown> = {};
      setTimeout(() => {
        req.result = {
          objectStoreNames: { contains: () => true },
              transaction: () => ({ objectStore: () => store, onabort: null }),
        };
        (req.onsuccess as () => void)?.();
      }, 0);
      return req;
    },
  };
}

const sampleProfile = (): Profile => {
  const p = generateProfile({ title: 'GTA V', is32: false, dx9: false });
  const built = buildProfile({
    id: 'gta5',
    title: 'GTA V',
    year: 2013,
    sizeGB: 118,
    soc: 'sd8gen1',
    gpu: 'adreno730',
    ramGB: 8,
    container: JSON.parse(toContainerJson(p)),
    author: 'nova',
    created: '2026-11-27',
    verifiedOnDevice: false,
  });
  if (!built.ok) throw new Error(JSON.stringify(built.issues));
  return built.profile;
};

/** load a fresh copy of the module so its module-level connection is not shared */
async function freshStore() {
  vi.resetModules();
  return import('../src/system/profileStore');
}

describe('٣-٣ profiles persist locally and report failure honestly', () => {
  beforeEach(() => {
    vi.resetModules();
    // the default environment has no indexedDB at all
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
  });

  it('says the profile was NOT stored when storage is unavailable', async () => {
    const store = await freshStore();
    const r = await store.saveProfile(sampleProfile());
    expect(r.stored).toBe(false);
    // and the reason is Arabic prose the user can act on, not "undefined"
    expect(r.reason).toMatch(/[؀-ۿ]/);
    expect(r.reason).toContain('التخزين المحلي');
  });

  it('reports storage as unavailable instead of pretending it exists', async () => {
    const store = await freshStore();
    expect(await store.profileStorageAvailable()).toBe(false);
    expect(await store.listProfiles()).toEqual([]);
    expect(await store.loadProfile('gta5')).toBeNull();
  });

  it('refuses to store a profile carrying a key Winlator ignores', async () => {
    /*
     * The important half: the validation happens on the way IN, not only on import. A
     * hand-built profile with `emulator` must not be persisted, because persisting it
     * means the export keeps writing a line that does nothing, with the UI saying "saved".
     */
    const store = await freshStore();
    const bad = sampleProfile() as Profile & { container: Record<string, unknown> };
    const withBadKey = { ...bad, container: { ...bad.container, emulator: 'FEXCore' } } as Profile;
    const r = await store.saveProfile(withBadKey);
    expect(r.stored).toBe(false);
    expect(r.reason).toContain('emulator');
  });
});

describe('٣-٣ with working storage', () => {
  let fake: ReturnType<typeof fakeIndexedDB>;
  beforeEach(() => {
    vi.resetModules();
    fake = fakeIndexedDB();
    Object.defineProperty(globalThis, 'indexedDB', { value: { open: fake.open }, configurable: true });
  });

  it('saves, reloads and returns the same profile after a restart', async () => {
    const store = await freshStore();
    const p = sampleProfile();
    expect((await store.saveProfile(p)).stored).toBe(true);

    // "restart": a new module instance with its own connection
    const store2 = await freshStore();
    const back = await store2.loadProfile('gta5');
    expect(back).not.toBeNull();
    expect(back?.game.id).toBe('gta5');
    expect(back?.container).toEqual(p.container);
  });

  it('lists what is stored, and names a corrupt entry instead of dropping it', async () => {
    /*
     * A profile written by an older build (or a half-finished write) can fail validation
     * on read. Silently omitting it would look like the user's settings vanished; listing
     * it as broken tells them what happened. The entry is planted directly in the store
     * because saveProfile() would (correctly) refuse to write it.
     */
    const store = await freshStore();
    await store.saveProfile(sampleProfile());
    const stale = sampleProfile();
    fake.data.set(
      'old1',
      JSON.stringify({ ...stale, game: { ...stale.game, id: 'old1' }, container: { ...stale.container, emulator: 'X' } }),
    );

    const list = await store.listProfiles();
    const ids = list.map((l) => l.id);
    expect(ids).toContain('gta5');
    expect(ids, 'a corrupt entry must not vanish from the list').toContain('old1');

    const healthy = list.find((l) => l.id === 'gta5');
    expect(healthy?.profile?.game.title).toBe('GTA V');
    expect(healthy?.broken).toBe('');

    const corrupt = list.find((l) => l.id === 'old1');
    expect(corrupt?.profile).toBeNull();
    expect(corrupt?.broken).toContain('emulator');
  });

  it('deletes a profile', async () => {
    const store = await freshStore();
    await store.saveProfile(sampleProfile());
    await store.deleteProfile('gta5');
    expect(await store.loadProfile('gta5')).toBeNull();
  });
});
