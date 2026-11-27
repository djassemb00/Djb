import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFloppy, FLOPPY_MAX_FILE } from '../src/system/fat12';

const SECTOR = 512;
const ROOT = 9728;
const DATA = 16896;

/** read the root directory the way DOS would */
function rootEntries(disk: Uint8Array) {
  const out: { name: string; size: number; cluster: number; attr: number }[] = [];
  for (let i = 0; i < 224; i++) {
    const e = ROOT + i * 32;
    if (disk[e] === 0) break;
    if (disk[e] === 0xe5) continue;
    const name =
      new TextDecoder().decode(disk.subarray(e, e + 8)).replace(/\s+$/, '') +
      '.' +
      new TextDecoder().decode(disk.subarray(e + 8, e + 11)).replace(/\s+$/, '');
    const dv = new DataView(disk.buffer, disk.byteOffset);
    out.push({ name, size: dv.getUint32(e + 28, true), cluster: dv.getUint16(e + 26, true), attr: disk[e + 11] });
  }
  return out;
}

function fat12(disk: Uint8Array, index: number) {
  const fat = disk.subarray(SECTOR, SECTOR + 9 * SECTOR);
  const off = index + (index >> 1);
  return index & 1 ? ((fat[off] >> 4) | (fat[off + 1] << 4)) & 0xfff : (fat[off] | ((fat[off + 1] & 0x0f) << 8)) & 0xfff;
}

describe('FAT12 writer', () => {
  const boot = new Uint8Array(readFileSync('public/images/freedos-boot.img'));

  it('writes a valid BPB and boot signature', () => {
    const disk = buildFloppy({ data: new Uint8Array(100), bootFrom: boot });
    expect(disk.length).toBe(2880 * SECTOR);
    const dv = new DataView(disk.buffer);
    expect(dv.getUint16(11, true)).toBe(512); // bytes per sector
    expect(disk[13]).toBe(2); // sectors per cluster
    expect(dv.getUint16(17, true)).toBe(224); // root entries
    expect(disk[510]).toBe(0x55);
    expect(disk[511]).toBe(0xaa);
  });

  it('copies the boot code, because a bare BPB never starts a machine', () => {
    /*
     * This used to assert the WHOLE 512-byte boot sector was copied, which is what the
     * writer did -- and that is the defect: the donor's BPB came with it, describing a
     * different geometry from the FAT/root/data we then wrote at our own offsets.
     * What has to be true is that the CODE is copied and the BPB is ours.
     */
    const disk = buildFloppy({ data: new Uint8Array(10), bootFrom: boot });
    expect(Array.from(disk.subarray(0, 3))).toEqual(Array.from(boot.subarray(0, 3))); // jump
    expect(Array.from(disk.subarray(62, 510))).toEqual(Array.from(boot.subarray(62, 510))); // code
    expect(disk[510]).toBe(0x55);
    expect(disk[511]).toBe(0xaa);
    // and the BPB is the one that matches the layout below it
    expect(disk[11] | (disk[12] << 8)).toBe(512);
    expect(disk[13]).toBe(2);
    expect(disk[17] | (disk[18] << 8)).toBe(224);
    expect(disk[22] | (disk[23] << 8)).toBe(9);
  });

  it('puts files in the root directory with 8.3 names and sizes', () => {
    const disk = buildFloppy({
      name: 'snake',
      ext: 'com',
      data: new Uint8Array(300).fill(0x90),
      autoexec: '@ECHO OFF\r\nSNAKE.COM\r\n',
    });
    const entries = rootEntries(disk);
    const snake = entries.find((e) => e.name === 'SNAKE.COM');
    expect(snake).toBeTruthy();
    expect(snake!.size).toBe(300);
    expect(entries.map((e) => e.name)).toContain('AUTOEXEC.BAT');
  });

  it('links clusters in the FAT and stores data at the right offset', () => {
    const payload = new Uint8Array(3000).map((_, i) => i & 0xff);
    const disk = buildFloppy({ name: 'BIG', ext: 'BIN', data: payload });
    const entry = rootEntries(disk).find((e) => e.name === 'BIG.BIN')!;
    // 3000 bytes = 3 clusters of 1024
    const c0 = entry.cluster;
    expect(fat12(disk, c0)).toBe(c0 + 1);
    expect(fat12(disk, c0 + 1)).toBe(c0 + 2);
    expect(fat12(disk, c0 + 2)).toBe(0xfff); // end of chain
    const at = DATA + (c0 - 2) * 1024;
    expect(disk[at]).toBe(0);
    expect(disk[at + 1023]).toBe(1023 & 0xff);
    expect(disk[at + 1024]).toBe(0); // second cluster starts with byte 1024
  });

  it('refuses a file that cannot fit, with a readable error', () => {
    expect(() => buildFloppy({ data: new Uint8Array(FLOPPY_MAX_FILE + 1) })).toThrow(/كبير/);
  });
});
