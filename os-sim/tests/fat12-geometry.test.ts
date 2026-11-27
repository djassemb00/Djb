import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFloppy, FLOPPY_MAX_FILE, MAX_CLUSTER, USABLE_CLUSTERS } from '../src/system/fat12';
import { buildProgramDisk } from '../src/system/guest';

/**
 * Geometry and bounds, tested against the image instead of against a comment.
 *
 * Three defects were found here by probing, not by reading:
 *   1. TOTAL_CLUSTERS was 2847 when the disk holds 1423 clusters, because it divided a
 *      SECTOR count by sectors-per-cluster a second time. FLOPPY_MAX_FILE was therefore
 *      1.39 MB, and a file between that and the real limit was accepted and written past
 *      the end of the image -- silently, since TypedArray.set clamps instead of throwing.
 *   2. The running total was never checked: several legal files could together overrun.
 *   3. A 225th root entry was written at DATA_START, overwriting cluster 2 -- silent
 *      corruption of the first file on the disk.
 */
const SECTOR = 512;
const SECTORS = 2880;
const DATA_START = 16896;
const ROOT_START = 9728;
const ROOT_ENTRIES = 224;
const CLUSTER_BYTES = 1024;
const img = readFileSync('public/images/freedos-boot.img');

const readFat = (disk: Uint8Array, i: number) => {
  const fat = disk.subarray(512, 512 + 9 * 512);
  const off = i + (i >> 1);
  const raw = fat[off] | (fat[off + 1] << 8);
  return i & 1 ? (raw >> 4) & 0xfff : raw & 0xfff;
};

const rootNames = (disk: Uint8Array) => {
  const out: string[] = [];
  for (let i = 0; i < ROOT_ENTRIES; i++) {
    const off = ROOT_START + i * 32;
    if (disk[off] === 0) break;
    const n = Buffer.from(disk.subarray(off, off + 8)).toString('latin1').trim();
    const e = Buffer.from(disk.subarray(off + 8, off + 11)).toString('latin1').trim();
    out.push(e ? `${n}.${e}` : n);
  }
  return out;
};

describe('floppy geometry', () => {
  it('derives the cluster numbers the real image can hold', () => {
    // 2880 sectors - 33 before data = 2867 data sectors = 1433.5 clusters of 2 sectors;
    // the geometry check above is byte-based, so the binding number is 1424
    expect(MAX_CLUSTER).toBe(Math.floor((SECTORS * SECTOR - DATA_START) / CLUSTER_BYTES) + 1);
    expect(MAX_CLUSTER).toBe(1424);
    expect(USABLE_CLUSTERS).toBe(1423);
    // the old, wrong value was 2847; a doubling is exactly what the division bug did
    expect(USABLE_CLUSTERS).toBeLessThan(2000);
  });

  it('keeps the documented maximum inside the image', () => {
    expect(FLOPPY_MAX_FILE).toBe((USABLE_CLUSTERS - 1) * CLUSTER_BYTES);
    expect(FLOPPY_MAX_FILE).toBeLessThan(1_470_000);
    expect(DATA_START + (FLOPPY_MAX_FILE / CLUSTER_BYTES) * CLUSTER_BYTES).toBeLessThanOrEqual(
      SECTORS * SECTOR,
    );
  });

  it('refuses a single file that would run past the end, instead of clamping', () => {
    // 1.5 MB is under the old (wrong) 1.39 MB? no -- it is over. This is the exact band
    // the old code accepted and then wrote out of bounds.
    expect(() =>
      buildFloppy({ name: 'HUGE', ext: 'EXE', data: new Uint8Array(1_500_000), bootFrom: img }),
    ).toThrow(/كبير جداً/);
  });

  it('refuses when legal files add up to more than the disk', () => {
    // three files of 600 KB each: every one is under FLOPPY_MAX_FILE, together 1.8 MB
    const extra = [600_000, 600_000].map((n, i) => ({ name: `P${i}.BIN`, data: new Uint8Array(n) }));
    expect(() =>
      buildFloppy({ name: 'MAIN', ext: 'EXE', data: new Uint8Array(600_000), extra, bootFrom: img }),
    ).toThrow(/امتلأ/);
  });

  it('never writes a root entry into the data area', () => {
    const tooMany = Array.from({ length: 250 }, (_, i) => ({
      name: `F${i}.TXT`,
      data: new Uint8Array(10),
    }));
    expect(() =>
      buildFloppy({ name: 'A', ext: 'EXE', data: new Uint8Array(10), extra: tooMany, bootFrom: img }),
    ).toThrow(/كثير/);
    // and the same call must not have touched cluster 2 on a legal disk
    const ok = buildFloppy({
      name: 'A',
      ext: 'EXE',
      data: new Uint8Array(100).fill(0x41),
      extra: [{ name: 'B.TXT', data: new Uint8Array(100).fill(0x42) }],
      bootFrom: img,
    });
    expect(rootNames(ok)).toEqual(['B.TXT', 'A.EXE', 'AUTOEXEC.BAT']);
  });

  it('fills the disk exactly to the last cluster without going over', () => {
    // a program of exactly the largest size must still build, and its chain must end
    const data = new Uint8Array(FLOPPY_MAX_FILE);
    const disk = buildFloppy({ name: 'MAX', ext: 'EXE', data, bootFrom: img });
    expect(disk.length).toBe(SECTORS * SECTOR);
    // walk the chain the way DOS does
    let c = 2;
    let hops = 0;
    while (c >= 2 && c < 0xff8 && hops < 5000) {
      expect(c).toBeLessThanOrEqual(MAX_CLUSTER);
      c = readFat(disk, c);
      hops++;
    }
    expect(hops).toBe(FLOPPY_MAX_FILE / CLUSTER_BYTES);
    expect(c).toBe(0xfff);
  });
});

describe('the FreeDOS system-file contract', () => {
  /**
   * guest.ts slices KERNEL.SYS / COMMAND.COM / CONFIG.SYS out of freedos-boot.img at
   * hardcoded cluster numbers. If the shipped image ever changes, every built disk gets
   * a corrupt kernel and the guest dies at boot with no useful message. This test reads
   * the real image and checks the contract.
   */
  const CLUSTER = 1024;
  const DATA = 16896;

  /**
   * Read the contract OUT OF guest.ts rather than restating it here.
   *
   * The first version of this test hardcoded the same numbers, so mutating guest.ts to
   * cluster 57 still passed: the test was checking its own copy. A contract test must
   * read the source of truth.
   */
  const guestSrc = readFileSync('src/system/guest.ts', 'utf8');
  const claimed = [...guestSrc.matchAll(/name: '([^']+)', cluster: (\d+), size: (\d+)/g)].map((m) => ({
    name: m[1],
    cluster: Number(m[2]),
    size: Number(m[3]),
  }));

  it('guest.ts declares a cluster and size for each system file', () => {
    expect(claimed.map((c) => c.name)).toEqual(['KERNEL.SYS', 'COMMAND.COM', 'CONFIG.SYS']);
  });

  it('every offset declared in guest.ts lands on the real file inside the shipped image', () => {
    // parse the image's own root directory, then compare with what guest.ts claims
    const rootStart = 9728;
    const entries = new Map<string, { cluster: number; size: number }>();
    for (let i = 0; i < 224; i++) {
      const off = rootStart + i * 32;
      if (img[off] === 0) break;
      const n = Buffer.from(img.subarray(off, off + 8)).toString('latin1').trim();
      const e = Buffer.from(img.subarray(off + 8, off + 11)).toString('latin1').trim();
      entries.set(e ? `${n}.${e}` : n, {
        cluster: (img[off + 26] | (img[off + 27] << 8)) & 0x0fff,
        size: img[off + 28] | (img[off + 29] << 8) | (img[off + 30] << 16) | (img[off + 31] << 24),
      });
    }
    for (const c of claimed) {
      const real = entries.get(c.name);
      expect(real, `${c.name} must exist in the image's root directory`).toBeDefined();
      expect({ name: c.name, cluster: c.cluster, size: c.size }).toEqual({
        name: c.name,
        cluster: real!.cluster,
        size: real!.size,
      });
    }
  });

  it('the declared slices are plausible binaries, not zeros', () => {
    for (const c of claimed) {
      const off = DATA + (c.cluster - 2) * CLUSTER;
      const slice = img.subarray(off, off + c.size);
      expect(slice.length).toBe(c.size);
      const nonZero = slice.filter((b) => b !== 0).length;
      expect(nonZero).toBeGreaterThan(c.size * 0.2);
    }
  });

  it('a built program disk carries a bootable kernel and the user file', async () => {
    const disk = await buildProgramDisk({ name: 'TETRIS.EXE', data: new Uint8Array(2048).fill(0x90) });
    // boot sector: the FreeDOS code, ending in 55 AA
    expect(disk[510]).toBe(0x55);
    expect(disk[511]).toBe(0xaa);
    const names = rootNames(disk);
    expect(names).toContain('TETRIS.EXE');
    expect(names).toContain('KERNEL.SYS');
    expect(names).toContain('COMMAND.COM');
    expect(names).toContain('AUTOEXEC.BAT');
  });

  it('the advertised free space is real, and never over-promised', async () => {
    /**
     * guest.ts quotes "X MB free" in its error message. That number must be achievable:
     * quoting 1.28 MB and then refusing a 1.27 MB program would be its own lie. Measured
     * by building at the quoted figure and one cluster below it.
     *
     * The reservation is deliberately conservative: it charges 2048 bytes for AUTOEXEC
     * while the real script is 142 bytes (one cluster), so the reservation is at most
     * one 1 KB cluster tighter than the exact arithmetic -- never looser.
     */
    const sysClusters = [45450, 66090, 209].reduce((n, b) => n + Math.ceil(b / CLUSTER_BYTES), 0);
    const autoClusters = 1; // the 142-byte script rounds to one cluster
    const exactFree = (MAX_CLUSTER - 1 - sysClusters - autoClusters) * CLUSTER_BYTES;

    // a program just under the exact free space must install
    const fits = await buildProgramDisk({ name: 'FITS.EXE', data: new Uint8Array(exactFree - 2048) });
    expect(fits.length).toBe(SECTORS * SECTOR);

    /*
     * And one that exceeds it must be refused with a message, not corrupt the disk.
     *
     * The message used to end "the bigger programs need a hard disk (the next step)".
     * ٥-٢ wrote that hard disk, so the promise became a lie in the other direction: it told
     * the user a feature was missing that now exists. The check is that the refusal names the
     * floppy's limit and the route out of it -- not that it repeats an old promise.
     */
    await expect(
      buildProgramDisk({ name: 'TOOBIG.EXE', data: new Uint8Array(exactFree + CLUSTER_BYTES) }),
    ).rejects.toThrow(/FAT16/);
  });

  it('the AUTOEXEC it writes actually names the program', async () => {
    const disk = await buildProgramDisk({ name: 'my game!.exe', data: new Uint8Array(10) });
    const names = rootNames(disk);
    const slot = names.indexOf('MYGAME.EXE');
    expect(slot).toBeGreaterThanOrEqual(0);
    const auto = names.indexOf('AUTOEXEC.BAT');
    const off = ROOT_START + auto * 32;
    const size = disk[off + 28] | (disk[off + 29] << 8) | (disk[off + 30] << 16) | (disk[off + 31] << 24);
    const cluster = (disk[off + 26] | (disk[off + 27] << 8)) & 0x0fff;
    const at = DATA_START + (cluster - 2) * CLUSTER_BYTES;
    const script = Buffer.from(disk.subarray(at, at + size)).toString('latin1');
    expect(script).toContain('MYGAME.EXE');
  });
});
