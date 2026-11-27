import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFloppy, DATA_START, ROOT_START, MAX_CLUSTER } from '../src/system/fat12';

/**
 * We have built floppies since the beginning and never once read one back.
 *
 * Round 25 tested the geometry (how many bytes fit). This tests the *format*: that the
 * bytes we write are a FAT12 volume some other system could mount. The reader below is
 * written from the FAT specification and imports nothing from src/ -- if the writer and
 * the reader shared code, they would share blind spots (the same mistake as the
 * hand-built PE fixture in round 26).
 */
const SECTOR = 512;

interface Entry {
  name: string;
  attr: number;
  first: number;
  size: number;
  chain: number[];
  bytes: Uint8Array;
}

function mount(img: Uint8Array): { entries: Entry[]; bpb: Record<string, number> } {
  const bps = img[11] | (img[12] << 8);
  const spc = img[13];
  const reserved = img[14] | (img[15] << 8);
  const nfats = img[16];
  const rootEnts = img[17] | (img[18] << 8);
  const total = img[19] | (img[20] << 8);
  const fatSecs = img[22] | (img[23] << 8);
  if (bps !== SECTOR) throw new Error(`bytes/sector ${bps}`);
  const rootSecs = Math.ceil((rootEnts * 32) / bps);
  const fatOff = reserved * bps;
  const rootOff = (reserved + nfats * fatSecs) * bps;
  const dataOff = rootOff + rootSecs * bps;
  const fat = img.subarray(fatOff, fatOff + fatSecs * bps);
  const at = (i: number) => {
    const o = (i * 3) >> 1;
    const v = fat[o] | (fat[o + 1] << 8);
    return i & 1 ? v >> 4 : v & 0xfff;
  };
  const entries: Entry[] = [];
  for (let k = 0; k < rootEnts; k++) {
    const o = rootOff + k * 32;
    if (img[o] === 0x00) break;
    if (img[o] === 0xe5) continue;
    const n = String.fromCharCode(...img.subarray(o, o + 8)).replace(/ +$/, '');
    const e = String.fromCharCode(...img.subarray(o + 8, o + 11)).replace(/ +$/, '');
    const first = img[o + 26] | (img[o + 27] << 8);
    const size = img[o + 28] | (img[o + 29] << 8) | (img[o + 30] << 16) | (img[o + 31] << 24);
    const chain: number[] = [];
    let c = first;
    while (c >= 2 && c < 0xff8) {
      if (chain.length > 1500) throw new Error(`FAT loop at cluster ${c}`);
      chain.push(c);
      c = at(c);
    }
    const body = new Uint8Array(chain.length * spc * bps);
    chain.forEach((cl, i) => {
      const off = dataOff + (cl - 2) * spc * bps;
      body.set(img.subarray(off, off + spc * bps), i * spc * bps);
    });
    entries.push({ name: e ? `${n}.${e}` : n, attr: img[o + 11], first, size, chain, bytes: body.subarray(0, size) });
  }
  return { entries, bpb: { bps, spc, reserved, nfats, rootEnts, total, fatSecs, dataOff } };
}

const PATTERN = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe('what we write is a FAT12 volume someone else can mount', () => {
  it('the BPB describes the layout the module actually writes', () => {
    const { bpb } = mount(buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(10) }));
    expect(bpb.bps).toBe(512);
    expect(bpb.spc).toBe(2);
    expect(bpb.reserved).toBe(1);
    expect(bpb.nfats).toBe(2);
    expect(bpb.rootEnts).toBe(224);
    expect(bpb.total).toBe(2880);
    expect(bpb.fatSecs).toBe(9);
    // the single number that matters: where the data area starts, per the BPB
    expect(bpb.dataOff).toBe(DATA_START);
  });

  it('lists the program and AUTOEXEC, and nothing else', () => {
    const { entries } = mount(buildFloppy({ name: 'SNAKE', ext: 'COM', data: PATTERN(1408) }));
    expect(entries.map((e) => e.name)).toEqual(['SNAKE.COM', 'AUTOEXEC.BAT']);
  });

  it('the bytes read back are the bytes written', () => {
    const data = PATTERN(1408);
    const { entries } = mount(buildFloppy({ name: 'SNAKE', ext: 'COM', data }));
    const file = entries.find((e) => e.name === 'SNAKE.COM')!;
    expect(file.size).toBe(1408);
    expect(Array.from(file.bytes)).toEqual(Array.from(data));
  });

  it('a multi-cluster file reads back whole, not just its first 1 KB', () => {
    // 1 KB clusters: 1024 = one cluster exactly, 1025 spills into a second
    for (const n of [1024, 1025, 5000]) {
      const data = PATTERN(n);
      const { entries } = mount(buildFloppy({ name: 'BIG', ext: 'BIN', data }));
      const file = entries.find((e) => e.name === 'BIG.BIN')!;
      expect(file.chain.length).toBe(Math.ceil(n / 1024));
      expect(Array.from(file.bytes)).toEqual(Array.from(data));
    }
  });

  it('a zero-byte file is legal, occupies a cluster, and reads back empty', () => {
    // FAT requires a first cluster even for an empty file; size 0 is what the reader uses
    const { entries } = mount(buildFloppy({ name: 'EMPTY', ext: 'TXT', data: new Uint8Array(0) }));
    const f = entries.find((e) => e.name === 'EMPTY.TXT')!;
    expect(f.size).toBe(0);
    expect(f.first).toBeGreaterThanOrEqual(2);
    expect(f.bytes.length).toBe(0);
  });

  it('the FAT chain is terminated, not left pointing at a number', () => {
    const { entries } = mount(buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(3000) }));
    const f = entries.find((e) => e.name === 'A.COM')!;
    expect(f.chain.length).toBe(3);
    // the last cluster must read back as an end-of-chain marker
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(3000) });
    const fat = img.subarray(512, 512 + 9 * 512);
    const last = f.chain[f.chain.length - 1];
    const o = (last * 3) >> 1;
    const v = fat[o] | (fat[o + 1] << 8);
    const marker = last & 1 ? v >> 4 : v & 0xfff;
    expect(marker).toBe(0xfff);
  });

  it('both FAT copies are identical', () => {
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(3000) });
    const fat1 = img.subarray(512, 512 + 4608);
    const fat2 = img.subarray(512 + 4608, 512 + 9216);
    expect(Buffer.compare(Buffer.from(fat1), Buffer.from(fat2))).toBe(0);
  });

  it('the root directory starts where the BPB says, not where a constant guesses', () => {
    const { bpb } = mount(buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(10) }));
    expect(bpb.dataOff - 14 * 512).toBe(ROOT_START);
  });

  it('refuses a duplicate name instead of writing an unreachable entry', () => {
    expect(() =>
      buildFloppy({
        name: 'P',
        ext: 'COM',
        data: PATTERN(5),
        extra: [
          { name: 'DATA.BIN', data: PATTERN(10) },
          { name: 'data.bin', data: PATTERN(20) },
        ],
      }),
    ).toThrow(/متطابقان/);
  });

  it('refuses a program whose own name is AUTOEXEC.BAT', () => {
    // The message must name the RESERVED NAME, not "duplicate": both guards catch this
    // case, and asserting on /AUTOEXEC/ passed even with the reserved-name guard deleted
    // (the duplicate check picked it up). Assert the reason, not just the throw.
    expect(() => buildFloppy({ name: 'AUTOEXEC', ext: 'BAT', data: PATTERN(10) })).toThrow(/محجوز/);
  });

  it('the duplicate guard is what catches a colliding system file', () => {
    // here there is no reserved-name involvement at all: KERNEL.SYS comes in as an extra
    // and as the program name, so ONLY the duplicate check can refuse it
    expect(() =>
      buildFloppy({
        name: 'KERNEL',
        ext: 'SYS',
        data: PATTERN(10),
        extra: [{ name: 'KERNEL.SYS', data: PATTERN(9) }],
      }),
    ).toThrow(/متطابقان/);
  });
});

describe('a donor boot sector may not rewrite our geometry', () => {
  it('a donor with no BPB at all still yields our BPB', () => {
    /*
     * nova-desk.img is a boot sector with no BPB: bytes 11..61 are code. Copying its
     * boot sector wholesale made the BPB read "36544 bytes/sector, 188 reserved
     * sectors" while the FAT and root stayed at our offsets.
     */
    const donor = readFileSync('public/images/nova-desk.img');
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(100), bootFrom: donor });
    const { bpb, entries } = mount(img);
    expect(bpb).toMatchObject({ bps: 512, spc: 2, reserved: 1, rootEnts: 224, fatSecs: 9 });
    expect(bpb.dataOff).toBe(DATA_START);
    expect(entries.map((e) => e.name)).toContain('A.COM');
  });

  it('a donor with a 4-sector root directory still yields our BPB', () => {
    const donor = readFileSync('public/images/kolibri.img');
    expect((donor[17] | (donor[18] << 8)) !== 224 || (donor[13] !== 2), 'kolibri geometry').toBe(true);
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(100), bootFrom: donor });
    expect(mount(img).bpb.dataOff).toBe(DATA_START);
  });

  it('the boot code is still copied, so the disk still boots', () => {
    const donor = readFileSync('public/images/freedos-boot.img');
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(100), bootFrom: donor });
    // same jump and same code bytes, different BPB
    expect(Array.from(img.subarray(0, 3))).toEqual(Array.from(donor.subarray(0, 3)));
    expect(Array.from(img.subarray(62, 200))).toEqual(Array.from(donor.subarray(62, 200)));
    expect(img[510]).toBe(0x55);
    expect(img[511]).toBe(0xaa);
  });

  it('ignores a donor too short to be a boot sector', () => {
    const img = buildFloppy({ name: 'A', ext: 'COM', data: PATTERN(10), bootFrom: new Uint8Array(100) });
    expect(img[0]).toBe(0xeb);
    expect(mount(img).bpb.dataOff).toBe(DATA_START);
  });
});

describe('the largest legal file still reads back', () => {
  it('reads a file of exactly MAX_CLUSTER-2 clusters', () => {
    const clusters = MAX_CLUSTER - 2;
    const data = PATTERN(clusters * 1024);
    const { entries } = mount(buildFloppy({ name: 'MAX', ext: 'BIN', data }));
    const f = entries.find((e) => e.name === 'MAX.BIN')!;
    expect(f.size).toBe(clusters * 1024);
    expect(f.chain.length).toBe(clusters);
    expect(f.bytes[0]).toBe(data[0]);
    expect(f.bytes[f.bytes.length - 1]).toBe(data[data.length - 1]);
  });
});
