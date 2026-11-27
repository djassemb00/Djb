import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * "مسح كل البيانات" did not clear all the data.
 *
 * resetAll() rebuilt the virtual filesystem, emptied the notes and notifications and
 * reset the settings -- and left every installed program, and every 1.44 MB disk backing
 * it, in IndexedDB. The button was labelled "مسح شامل" (wipe everything) and the largest
 * objects in the app survived it. Its fine print quietly said so, which is worse: the
 * heading made a claim the body contradicted.
 */
const deleted: string[] = [];
let failNext = false;

vi.mock('../src/system/diskStore', () => ({
  deleteDisk: async (key: string) => {
    if (failNext) throw new Error('idb unavailable');
    deleted.push(key);
  },
  saveDisk: async () => true,
  loadDisk: async () => null,
  hasRoomFor: async () => true,
  storageStatus: async () => ({ persisted: true, usageMB: 0, quotaMB: 1024 }),
  storageAvailable: async () => true,
}));
vi.mock('../src/system/guest', () => ({ buildProgramDisk: () => new Uint8Array(4) }));

const { usePrograms } = await import('../src/store/usePrograms');

const seed = () =>
  usePrograms.setState({
    programs: [
      { id: 'a1', fileName: 'A.EXE', label: 'A', icon: null, size: 1000, launches: 2, healthy: true, installedAt: 1 },
      { id: 'b2', fileName: 'B.COM', label: 'B', icon: null, size: 2000, launches: 0, healthy: false, installedAt: 2 },
    ] as never,
    busy: null,
  });

describe('wipeAll', () => {
  beforeEach(() => {
    deleted.length = 0;
    failNext = false;
    seed();
  });

  it('deletes every program disk, not just the rows', async () => {
    expect(usePrograms.getState().programs).toHaveLength(2);
    const freed = await usePrograms.getState().wipeAll();
    expect(freed).toBe(2);
    expect(deleted).toHaveLength(2);
    // the keys are the ones the store would have written, from diskKey()
    expect(deleted[0]).toMatch(/^program:/);
    expect(usePrograms.getState().programs).toEqual([]);
  });

  it('reports the count it actually freed, not the count it tried', async () => {
    failNext = true;
    const freed = await usePrograms.getState().wipeAll();
    expect(freed, 'a failed delete must not be counted as freed').toBe(0);
  });

  it('empties the rows even when a disk delete throws', async () => {
    failNext = true;
    await usePrograms.getState().wipeAll();
    // a row without its disk is a broken tile the user cannot remove
    expect(usePrograms.getState().programs).toEqual([]);
  });

  it('clears a lingering busy flag so the UI is not stuck', async () => {
    usePrograms.setState({ busy: 'a1' } as never);
    await usePrograms.getState().wipeAll();
    expect(usePrograms.getState().busy).toBeNull();
  });
});

describe('the settings button cannot over-claim again', () => {
  const settings = readFileSync('src/apps/SettingsApp.tsx', 'utf8');
  const strip = settings
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  it('actually CALLS the wipe, not just imports it', () => {
    // asserting that the name appears somewhere was not enough: deleting the call left
    // the selector line `const wipeAll = usePrograms(...)` and the test still passed.
    // The assertion has to be on the invocation, in the same click that resets.
    const card = strip.slice(strip.indexOf('مسح كل البيانات'));
    expect(card).toMatch(/await\s+wipeAll\s*\(\s*\)/);
    expect(card).toContain('resetAll()');
    // and the reset must not be reachable without the wipe having been awaited first
    expect(card.indexOf('await wipeAll()'), 'wipe must precede resetAll').toBeLessThan(
      card.indexOf('resetAll()'),
    );
  });

  it('names the installed programs in what it deletes', () => {
    const card = strip.slice(strip.indexOf('مسح كل البيانات'));
    expect(card).toMatch(/برنامجاً مثبَّتاً|\{programs\.length\}/);
    expect(card).toContain('كل قرص محفوظ');
  });

  it('states what it deliberately keeps, so nothing is implied', () => {
    expect(strip).toContain('يبقى كما هو');
    expect(strip).toContain('لا نمسحها');
  });

  it('does not invent a Wi-Fi network name', () => {
    expect(strip).not.toContain('Nova‑5G');
    expect(strip).not.toContain('إشارة قوية');
    // and it must say the switch is ours, not the phone's radio
    expect(strip).toContain('لا يرى اسم الشبكة');
  });
});

describe('the lock screen does not invent one either', () => {
  it('shows connectivity from navigator.onLine, never an SSID', () => {
    const lock = readFileSync('src/components/LockScreen.tsx', 'utf8');
    expect(lock).not.toContain('Nova‑5G');
    expect(lock).toContain('readNetInfo');
  });
});
