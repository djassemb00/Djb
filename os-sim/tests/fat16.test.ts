import { describe, expect, it } from 'vitest';
import { buildFat16, layoutFor, readFat16File } from '../src/system/fat16';

/**
 * PLAN ٥-٢ unit level: the volume's own arithmetic, checked without a guest.
 *
 * The boot test (`fat16-boot.test.ts`) proves FreeDOS accepts the disk. This file proves the
 * disk is internally consistent, which is what catches the failures that a boot happens not
 * to trip over -- a 64 MB volume whose partition table declared 33 MB booted fine here,
 * because the backing image was still 64 MB long. Ship that disk to anything that trusts the
 * table and the second half of the volume is gone.
 */
const dv = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);

describe('٥-٢ FAT16 layout', () => {
  it.each([16, 32, 64])('is FAT16 for %i MB under Microsoft\'s 4085-cluster rule', (mb) => {
    const l = layoutFor(mb);
    // below 4085 clusters a driver is REQUIRED to treat the volume as FAT12. A volume that
    // formats and then gets mounted as the wrong FAT reads garbage.
    expect(l.clusters).toBeGreaterThan(4085);
    // and it must stay under 65525 or it would be FAT32 territory
    expect(l.clusters).toBeLessThan(65525);
    // the FAT must be large enough to hold one 16-bit entry per cluster
    expect(l.sectorsPerFat * 512).toBeGreaterThanOrEqual(l.clusters * 2);
  });

  it('refuses to build a volume too big to be FAT16', () => {
    // 130 MB is 65912 clusters: over 65525, so a driver is required to mount it as FAT32.
    // The builder used to return that disk without complaint.
    expect(layoutFor(128).clusters).toBeLessThanOrEqual(65525);
    expect(layoutFor(128).clusters).toBeGreaterThan(64_000);
    expect(() => layoutFor(130)).toThrow(/65525/);
    expect(() => buildFat16({ sizeMB: 200, files: [] })).toThrow(/FAT16/);
  });

  it('16 MB is 7658 clusters, not 15834: the measured layout', () => {
    // A remembered "15834 for 16 MB" was wrong and would have meant the FAT was half the
    // size it needed to be. These numbers are measured from layoutFor, not derived by hand.
    expect(layoutFor(16)).toMatchObject({ sectors: 30720, sectorsPerFat: 30, clusters: 7658 });
    expect(layoutFor(32)).toMatchObject({ sectors: 63488, sectorsPerFat: 62, clusters: 15834 });
    expect(layoutFor(64)).toMatchObject({ sectors: 129024, sectorsPerFat: 126, clusters: 32186 });
  });
});

describe('٥-٢ what the partition table promises', () => {
  it.each([16, 32, 64])('a %i MB volume declares its WHOLE size in the MBR', (mb) => {
    /*
     * The bug this test exists for: the size field was clamped with
     * Math.min(sectors, 0xffff), a rule that only applies to type 0x06 (CHS-only) partitions.
     * We write type 0x0E, an LBA type, where the field is a full 32-bit LBA count. The clamp
     * silently truncated every volume above 33.5 MB.
     */
    const { disk, layout } = buildFat16({ sizeMB: mb, files: [] });
    expect(dv(disk).getUint32(446 + 12, true)).toBe(layout.sectors);
    // the volume starts at LBA 2048, so it is one MB smaller than the disk: 64 MB of image
    // carries a 63 MB partition, and the two together are the whole file
    expect(layout.sectors).toBe((mb - 1) * 2048);
    expect(disk.length).toBe(mb * 1024 * 1024);
  });

  it('the MBR CHS triplets are the real 16-head/63-sector geometry', () => {
    /*
     * With these bytes zeroed FreeDOS printed "using suspect partition Pri:1 FS 0e: with
     * calculated values 2-0-33 instead of 0-0-0". It mounted anyway, which is exactly why
     * this is worth a test: the warning is the only evidence, and a stricter driver would
     * have refused the disk.
     *
     * Note the start head IS zero -- LBA 2048 is cylinder 2, head 0, sector 33 in this
     * geometry, and that is the same 2-0-33 the kernel printed. A test asserting "head > 0"
     * would be asserting something false.
     */
    const { disk } = buildFat16({ sizeMB: 32, files: [] });
    const pe = 446;
    const chsOf = (o: number) => ({
      head: disk[o],
      sector: disk[o + 1] & 0x3f,
      cyl: ((disk[o + 1] & 0xc0) << 2) | disk[o + 2],
    });
    expect(chsOf(pe + 1)).toEqual({ head: 0, sector: 33, cyl: 2 });
    // not the all-zero triplet that produced the warning
    expect(disk.subarray(pe + 1, pe + 4).some((b) => b !== 0)).toBe(true);
    // the end triplet must be a legal geometry too
    const end = chsOf(pe + 5);
    expect(end.sector).toBeGreaterThanOrEqual(1);
    expect(end.sector).toBeLessThanOrEqual(63);
    expect(end.head).toBeLessThan(16);
    // and it must actually end where the partition ends: 2048 + 63488 - 1 = 65535
    expect(end.cyl * 16 * 63 + end.head * 63 + end.sector - 1).toBe(65535);
  });

  it('the boot sectors carry 55AA and the BPB points back at the partition', () => {
    const { disk } = buildFat16({ sizeMB: 32, files: [] });
    expect([disk[510], disk[511]]).toEqual([0x55, 0xaa]); // MBR
    expect([disk[2048 * 512 + 510], disk[2048 * 512 + 511]]).toEqual([0x55, 0xaa]); // VBR
    // hidden sectors: the BPB's own record of where the volume lives
    expect(dv(disk).getUint32(2048 * 512 + 28, true)).toBe(2048);
    // 63488 sectors fits the 16-bit field, so the 32-bit field must be zero: a driver reads
    // the 16-bit one first, and a volume declaring both is ambiguous
    expect(dv(disk).getUint16(2048 * 512 + 19, true)).toBe(63488);
    expect(dv(disk).getUint32(2048 * 512 + 32, true)).toBe(0);
    // a 64 MB volume does NOT fit, so it must use the 32-bit field and zero the 16-bit one
    const big = buildFat16({ sizeMB: 64, files: [] });
    expect(dv(big.disk).getUint16(2048 * 512 + 19, true)).toBe(0);
    expect(dv(big.disk).getUint32(2048 * 512 + 32, true)).toBe(129024);
  });
});

describe('٥-٢ reading back what we wrote', () => {
  it('round-trips several files across cluster boundaries', () => {
    // 5000 bytes is not a multiple of the 2048-byte cluster, so the last cluster is partial
    // and the size field, not the cluster count, must decide the end of the file.
    const a = new Uint8Array(5000).map((_, i) => i & 0xff);
    const b = new TextEncoder().encode('second file');
    const c = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 7) & 0xff); // 3 MB, 1536 clusters
    const { disk } = buildFat16({
      sizeMB: 32,
      files: [
        { name: 'A.BIN', data: a },
        { name: 'B.TXT', data: b },
        { name: 'C.BIN', data: c },
      ],
    });
    expect(Array.from(readFat16File(disk, 'A.BIN'))).toEqual(Array.from(a));
    expect(new TextDecoder().decode(readFat16File(disk, 'B.TXT'))).toBe('second file');
    expect(Array.from(readFat16File(disk, 'C.BIN'))).toEqual(Array.from(c));
  });

  it('reads by 8.3 name regardless of case and rejects names that are not there', () => {
    const { disk } = buildFat16({
      sizeMB: 32,
      files: [{ name: 'hello.txt', data: new TextEncoder().encode('x') }],
    });
    expect(readFat16File(disk, 'HELLO.TXT').length).toBe(1);
    // the contract is null, not a throw: a missing file is an answer, not an exception
    expect(readFat16File(disk, 'NOPE.TXT')).toBeNull();
  });

  it('refuses to write past the end of the volume instead of corrupting it', () => {
    // the check must run BEFORE any bytes are written, so a too-big payload cannot leave a
    // half-written volume behind
    const huge = new Uint8Array(33 * 1024 * 1024);
    expect(() => buildFat16({ sizeMB: 32, files: [{ name: 'HUGE.BIN', data: huge }] })).toThrow();
  });
});
