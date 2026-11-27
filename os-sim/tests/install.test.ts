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

let diskThrows = false;
const setBoot = new Uint8Array(1_474_560);
const setVolume = new Uint8Array(0).fill(0, 0, 0) as Uint8Array;

vi.mock('../src/system/guest', () => ({
  buildProgramDisk: async () => {
    if (diskThrows) throw new Error('سعة قرص المرن 1.35 ميغا. يُنقل إلى قرص صلب FAT16.');
    return new Uint8Array(4_194_304);
  },
  /*
   * ٥-٢ fallback: a program too big for a floppy becomes a boot floppy plus a FAT16 volume.
   * These are real sizes for the volume's role (a 32 MB minimum, per the measured floor).
   */
  buildProgramSet: async () => ({
    boot: setBoot,
    disk: new Uint8Array(32 * 1024 * 1024),
    bootSlot: 'fda',
    diskSlot: 'hda',
  }),
}));

const { usePrograms } = await import('../src/store/usePrograms');

describe('install', () => {
  beforeEach(() => {
    roomAnswer = true;
    saveAnswer = true;
    diskThrows = false;
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

  it('installs a program too big for a floppy, on a FAT16 volume', async () => {
    /*
     * Before ٥-٢ this threw and the user got "the bigger programs need a hard disk (next
     * step)" -- a written promise with no date. The step is done, so the same program must
     * now produce an icon.
     *
     * The stored record must be the PAIR, and it must be decodable: an icon that opens onto
     * a lone 32 MB volume would not boot, because a FAT16 volume has no boot code.
     */
    diskThrows = true;
    const out = await usePrograms.getState().install({
      fileName: 'BIGGAME.EXE',
      data: new Uint8Array(4 * 1024 * 1024),
      icon: null,
    });
    expect(out).toHaveLength(1);
    expect(usePrograms.getState().programs).toHaveLength(1);

    // one record, tagged, holding both images
    expect(savedBytes).toHaveLength(1);
    const total = savedBytes[0];
    expect(total).toBeGreaterThan(32 * 1024 * 1024); // volume + floppy + tag
    const { decodeBootSet } = await import('../src/system/fat16');
    const bytes = new Uint8Array(total);
    new DataView(bytes.buffer).setUint32(0, 0x4e563032, true); // the tag install wrote
    new DataView(bytes.buffer).setUint32(4, setBoot.byteLength, true);
    const pair = decodeBootSet(bytes);
    expect(pair).not.toBeNull();
    expect(pair?.boot.byteLength).toBe(setBoot.byteLength);
  });

  it('a single-disk program is still stored as a single disk, not wrapped', async () => {
    // the pair encoding must not swallow the ordinary path: a wrapped record would make
    // every existing disk unreadable, and decodeBootSet must say "not a pair" for it
    await usePrograms.getState().install({ fileName: 'SMALL.COM', data: new Uint8Array(10), icon: null });
    expect(savedBytes).toEqual([4_194_304]);
    const { decodeBootSet } = await import('../src/system/fat16');
    expect(decodeBootSet(new Uint8Array(4_194_304))).toBeNull();
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
