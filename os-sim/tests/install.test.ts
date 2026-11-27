import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * The install path, tested as a decision rather than through React:
 *   build the disk -> is there room? -> did the write land? -> only then show the icon.
 *
 * Before this cycle the entry was added to the store BEFORE the write was known to
 * have succeeded, and saveDisk could not even report failure. On a full phone that
 * produced an app icon that opens onto a missing disk.
 */
const savedBytes: number[] = [];
let roomAnswer = true;
let saveAnswer = true;

vi.mock('../src/system/diskStore', () => ({
  hasRoomFor: async () => roomAnswer,
  loadDisk: async () => null,
  deleteDisk: async () => undefined,
  saveDisk: async (_k: string, b: Uint8Array) => {
    savedBytes.push(b.byteLength);
    return saveAnswer;
  },
}));

vi.mock('../src/system/guest', () => ({
  buildProgramDisk: async () => new Uint8Array(4_194_304),
}));

const { usePrograms } = await import('../src/store/usePrograms');

describe('install', () => {
  beforeEach(() => {
    roomAnswer = true;
    saveAnswer = true;
    savedBytes.length = 0;
    usePrograms.setState({ programs: [], busy: null });
  });

  it('installs when there is room and the write succeeds', async () => {
    const out = await usePrograms.getState().install({
      fileName: 'DOOM.EXE',
      data: new Uint8Array(1_000_000),
      icon: 'gamepad',
    });
    expect(savedBytes).toEqual([4_194_304]);
    expect(out).toHaveLength(1);
    expect(usePrograms.getState().programs).toHaveLength(1);
    expect(usePrograms.getState().programs[0].command).toBe('DOOM.EXE');
  });

  it('does not show an icon when the write failed', async () => {
    saveAnswer = false;
    await expect(
      usePrograms.getState().install({ fileName: 'BIG.EXE', data: new Uint8Array(10), icon: 'app' }),
    ).rejects.toThrow(/فشل حفظ القرص/);
    // the important assertion: nothing was added to the launcher
    expect(usePrograms.getState().programs).toHaveLength(0);
  });

  it('refuses before writing a single byte when there is no room', async () => {
    roomAnswer = false;
    await expect(
      usePrograms.getState().install({ fileName: 'BIG.EXE', data: new Uint8Array(10), icon: 'app' }),
    ).rejects.toThrow(/مساحة كافية/);
    expect(savedBytes).toHaveLength(0); // it never even tried the write
    expect(usePrograms.getState().programs).toHaveLength(0);
  });

  it('always clears the busy flag, even when the install throws', async () => {
    saveAnswer = false;
    await usePrograms
      .getState()
      .install({ fileName: 'X.EXE', data: new Uint8Array(1), icon: 'app' })
      .catch(() => undefined);
    expect(usePrograms.getState().busy).toBeNull();
  });
});
