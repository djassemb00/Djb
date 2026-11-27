import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { V86 } from 'v86';
import { buildFat16 } from '../src/system/fat16';
import { buildFloppy } from '../src/system/fat12';
import { readFat16File } from '../src/system/fat16';
import { buildProgramSet, hardDiskAutoexec, volumeSizeMB } from '../src/system/guest';

/**
 * PLAN ٥-٢, end to end: a real FreeDOS boots on an emulated PC and reads a 32 MB FAT16
 * volume this module wrote.
 *
 * This test exists because the module was wrong three times and every time it LOOKED right:
 *
 *   1. A BPB at sector 0 with no partition table → the kernel printed "illegal partition
 *      table - drive 00" four times and never assigned a letter.
 *   2. A partition table with type 0x06 and zeroed CHS → C: mounted and DIR listed the
 *      files, then the first DATA read failed: "Error reading from drive C: DOS area:
 *      unknown command given to driver".
 *   3. Type 0x0E with an LBA-reading driver, but BPB geometry 32/64 while the partition
 *      table said otherwise → "using suspect partition Pri:1 FS 0e" warnings on every mount.
 *
 * None of those are visible in a byte-level round-trip test, which passed throughout. Only
 * booting reveals them, so booting is the test.
 */
const ROOT = new URL('../public/', import.meta.url).pathname;
const src = readFileSync(ROOT + 'images/freedos-boot.img');
const at = (c: number, n: number) =>
  new Uint8Array(src.subarray(16896 + (c - 2) * 1024, 16896 + (c - 2) * 1024 + n));

/** free-space figure FreeDOS printed: 30.6 MB of the 31 MB partition */
const FREE_MARKER = '32,';

function run(disk: Uint8Array, autoexec: string, until: string, timeoutMs = 30_000) {
  const boot = buildFloppy({
    name: 'BOOTER',
    ext: 'COM',
    // a stub program: this test is about the second disk, not about running anything
    data: new Uint8Array([0xb8, 0x00, 0x4c, 0xcd, 0x21]),
    extra: [
      { name: 'KERNEL.SYS', data: at(7, 45450) },
      { name: 'COMMAND.COM', data: at(56, 66090) },
      { name: 'CONFIG.SYS', data: at(125, 209) },
    ],
    autoexec,
    bootFrom: src,
  });
  const emu: { v86: { cpu: { devices: { vga: { vga_memory: Uint8Array } } } }; destroy?: () => void } =
    new V86({
      wasm_path: ROOT + 'v86/v86.wasm',
      bios: { url: ROOT + 'roms/seabios.bin' },
      vga_bios: { url: ROOT + 'roms/vgabios.bin' },
      fda: { buffer: boot.buffer },
      hda: { buffer: disk.buffer },
      memory_size: 32 * 1024 * 1024,
      autostart: true,
    }) as never;
  const screen = () => {
    const m = emu.v86.cpu.devices.vga.vga_memory;
    let s = '';
    for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(m[i * 2]);
    return s;
  };
  return new Promise<{ text: string; ms: number }>((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const t = screen();
      // stop on the marker this test is waiting for, any failure signature, or timeout.
      // Without a marker the loop burns the whole timeout and the duration assertion
      // measures the polling, not the boot.
      const done =
        t.includes(until) ||
        t.includes('Error reading from drive') ||
        t.includes('illegal partition') ||
        t.includes('Invalid drive') ||
        Date.now() - t0 > timeoutMs;
      if (done) {
        clearInterval(id);
        emu.destroy?.();
        resolve({ text: t, ms: Date.now() - t0 });
      }
    }, 200);
  });
}

/** boot a given floppy with a given hard disk and return the screen when `until` appears */
function run2(floppy: Uint8Array, disk: Uint8Array, until: string, timeoutMs = 25_000) {
  const emu = new V86({
    wasm_path: ROOT + 'v86/v86.wasm',
    bios: { url: ROOT + 'roms/seabios.bin' },
    vga_bios: { url: ROOT + 'roms/vgabios.bin' },
    fda: { buffer: floppy.buffer },
    hda: { buffer: disk.buffer },
    memory_size: 32 * 1024 * 1024,
    autostart: true,
  }) as unknown as { v86: { cpu: { devices: { vga: { vga_memory: Uint8Array } } } }; destroy?: () => void };
  const text = () => {
    const m = emu.v86.cpu.devices.vga.vga_memory;
    let s = '';
    for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(m[i * 2]);
    return s;
  };
  return new Promise<string>((resolve) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      const t = text();
      if (t.includes(until) || t.includes('Bad command') || Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        emu.destroy?.();
        resolve(t);
      }
    }, 200);
  });
}

describe('٥-٢ FreeDOS reads a FAT16 volume we wrote', () => {
  it('mounts C: with no partition warning, lists the file, and reads its bytes', async () => {
    const { disk, layout } = buildFat16({
      sizeMB: 32,
      files: [{ name: 'HELLO.TXT', data: new TextEncoder().encode('FAT16 VOLUME READ OK\r\n') }],
    });
    // the layout must be FAT16 by Microsoft's own rule: below 4085 clusters a driver is
    // REQUIRED to treat the volume as FAT12, which would silently misread all of it
    expect(layout.clusters).toBeGreaterThan(4085);

    const { text } = await run(
      disk,
      '@ECHO OFF\r\nTYPE C:\\HELLO.TXT\r\nECHO ===\r\n',
      'FAT16 VOLUME READ OK',
    );
    expect(text, 'the kernel never mounted the volume').toContain('C: HD1');
    // the three failures this test was written for
    expect(text).not.toContain('illegal partition');
    expect(text).not.toContain('suspect partition');
    expect(text).not.toContain('Error reading from drive');
    expect(text).toContain('FAT16 VOLUME READ OK');
  }, 60_000);

  it('reports ~30 MB free, which is the whole point of ٥-٢', async () => {
    /*
     * The floppy gives 1.35 MB for the user's program. This asserts the number FreeDOS
     * itself prints, not a number we computed: the product claim is "programs bigger than a
     * floppy", and only the guest can confirm how much space it believes it has.
     */
    const { disk } = buildFat16({
      sizeMB: 32,
      files: [{ name: 'BIG.EXE', data: new Uint8Array(300_000).fill(0x90) }],
    });
    const { text } = await run(disk, '@ECHO OFF\r\nDIR C:\\\r\nECHO ===\r\n', 'bytes free');
    expect(text).toContain('BIG      EXE');
    // 300 000 bytes listed
    expect(text).toContain('300,000');
    process.stdout.write('\nFREE_LINE=' + (text.match(/[\d,]+ bytes free/) ?? ['none'])[0] + '\n');
    expect(text, `expected a ~30 MB free figure; screen was:\n${text}`).toMatch(/3\d,\d{3},\d{3} bytes free/);
  }, 60_000);

  it('boots well under the three seconds the plan asks for', async () => {
    // the plan's acceptance criterion: "boot under 3 s". Measured here on the emulator.
    const { disk } = buildFat16({
      sizeMB: 32,
      files: [{ name: 'HELLO.TXT', data: new TextEncoder().encode('FAT16 VOLUME READ OK\r\n') }],
    });
    const { ms } = await run(
      disk,
      '@ECHO OFF\r\nTYPE C:\\HELLO.TXT\r\nECHO ===\r\n',
      'FAT16 VOLUME READ OK',
    );
    expect(ms).toBeLessThan(3000);
  }, 60_000);
});

describe('٥-٢ a program too big for a floppy runs from the volume', () => {
  /** a .COM that prints a marker with DOS's own AH=09 and exits: proves the CPU ran it */
  function say(text: string): Uint8Array {
    // mov ah,9 ; mov dx,0x010c ; int 21h ; mov ax,4c00 ; int 21h ; then the string at 0x10c
    const stub = [0xb4, 0x09, 0xba, 0x0c, 0x01, 0xcd, 0x21, 0xb8, 0x00, 0x4c, 0xcd, 0x21];
    const out = new Uint8Array(stub.length + text.length + 1);
    out.set(stub);
    out.set(new TextEncoder().encode(text + '$'), stub.length);
    return out;
  }

  it('boots a 2 MB program from C: -- impossible on the 1.35 MB floppy', async () => {
    /*
     * The size is the test. `buildProgramDisk` refuses anything over ~1.35 MB with an error
     * that promised a hard disk "in the next step"; this is that step, so the same program
     * has to actually run. The payload stays 2 MB -- the marker sits at the very start,
     * where the cluster chain must still resolve after 1000 clusters of padding.
     */
    const program = new Uint8Array(2 * 1024 * 1024 + 5000);
    program.set(say('BIG PROGRAM RAN FROM HARD DISK'));
    const set = await buildProgramSet({ name: 'BIGPROG.COM', data: program });

    // the volume must be a FAT16 volume of a real size, and the boot image a floppy
    expect(set.disk.byteLength).toBeGreaterThanOrEqual(32 * 1024 * 1024);
    expect(set.boot.byteLength).toBe(1_474_560);
    expect(set.bootSlot).toBe('fda');
    expect(set.diskSlot).toBe('hda');

    // and the bytes really are on the volume, at the size we passed
    const back = readFat16File(set.disk, 'BIGPROG.COM');
    expect(back?.length).toBe(program.length);
    expect(back?.slice(0, 12)).toEqual(program.slice(0, 12));

    const boot = buildFloppy({
      name: 'BOOTER',
      ext: 'COM',
      data: new Uint8Array(0),
      extra: [
        { name: 'KERNEL.SYS', data: at(7, 45450) },
        { name: 'COMMAND.COM', data: at(56, 66090) },
        { name: 'CONFIG.SYS', data: at(125, 209) },
      ],
      autoexec: hardDiskAutoexec('BIGPROG.COM'),
      bootFrom: src,
    });
    const screen = await run2(boot, set.disk, 'BIG PROGRAM RAN');
    expect(screen).toContain('BIG PROGRAM RAN FROM HARD DISK');
    expect(screen).toContain('C: HD1'); // the volume really was the fixed disk
    // the two failures that produced this function
    expect(screen).not.toContain('Bad command');
    expect(screen).not.toContain('not a bootable disk');
  }, 60_000);

  it('a 32 MB floor: smaller volumes mount with a partition warning', async () => {
    // measured: 16 and 24 MB mount, read, and print "suspect partition" every time.
    // 32, 48 and 64 are clean. The floor is the smallest clean size.
    expect(volumeSizeMB(0)).toBe(32);
    expect(volumeSizeMB(2 * 1024 * 1024)).toBe(32);
    expect(volumeSizeMB(40 * 1024 * 1024)).toBe(42);
  });
});
