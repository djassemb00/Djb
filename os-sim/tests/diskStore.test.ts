import { beforeEach, describe, expect, it } from 'vitest';
import { hasRoomFor, storageStatus, saveDisk, loadDisk, WANTED_QUOTA } from '../src/system/diskStore';

/**
 * IndexedDB does not exist under vitest, and that is exactly the interesting case:
 * a save that cannot happen must REPORT failure. The old saveDisk was
 * `tx(...).then(() => undefined)` -- it resolved unconditionally, so a full disk and a
 * blocked upgrade looked identical to a successful write. That is how "محفوظ في
 * المتصفح" could be shown while nothing was stored.
 */
const withStorage = (storage: Partial<StorageManager> | undefined) => {
  Object.defineProperty(globalThis, 'navigator', { value: { storage }, configurable: true });
};

describe('disk storage', () => {
  beforeEach(() => withStorage(undefined));

  it('reports a save that could not happen instead of resolving quietly', async () => {
    // no indexedDB in this environment -> the write cannot land
    const ok = await saveDisk('k', new Uint8Array([1, 2, 3]));
    expect(ok).toBe(false);
  });

  it('returns null for a disk that was never saved', async () => {
    expect(await loadDisk('missing')).toBeNull();
  });

  it('does not pretend storage is available when navigator.storage is missing', async () => {
    const st = await storageStatus();
    expect(st.supported).toBe(false);
    expect(st.quota).toBeNull();
    expect(st.persisted).toBe(false);
  });

  it('asks the browser to persist and reports the grant honestly', async () => {
    let persistAsked = 0;
    withStorage({
      estimate: async () => ({ quota: 100_000_000, usage: 10_000_000 }),
      persisted: async () => false,
      persist: async () => {
        persistAsked++;
        return false; // the browser said no; we must not claim it said yes
      },
    });
    const st = await storageStatus();
    expect(persistAsked).toBe(1);
    expect(st.supported).toBe(true);
    expect(st.persisted).toBe(false);
    expect(st.quota).toBe(100_000_000);
  });

  it('does not ask twice when the origin is already persisted', async () => {
    let persistAsked = 0;
    withStorage({
      estimate: async () => ({ quota: 1, usage: 0 }),
      persisted: async () => true,
      persist: async () => {
        persistAsked++;
        return true;
      },
    });
    expect((await storageStatus()).persisted).toBe(true);
    expect(persistAsked).toBe(0);
  });

  it('refuses an import that cannot fit, and allows one that can', async () => {
    withStorage({ estimate: async () => ({ quota: 10_000_000, usage: 1_000_000 }) });
    expect(await hasRoomFor(1_000_000)).toBe(true); // 9 MB free, 1 MB wanted
    expect(await hasRoomFor(9_000_000)).toBe(false); // would leave nothing for the FAT copy
  });

  it('never blocks the user when the browser will not disclose a quota', async () => {
    withStorage({ estimate: async () => ({}) });
    expect(await hasRoomFor(50_000_000)).toBe(true);
  });

  it('plans against a 1 GiB budget, and says so in one place', () => {
    expect(WANTED_QUOTA).toBe(1_073_741_824);
  });
});
