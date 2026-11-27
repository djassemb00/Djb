import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { V86 } from 'v86';
import { buildFloppy } from '../src/system/fat12';

/**
 * End-to-end: a "user program" is written onto a floppy by us, booted on an emulated
 * PC, and must print its message. This is the product's core promise, so it is a test
 * rather than a probe.
 */
const ROOT = new URL('../public/', import.meta.url).pathname;
const src = readFileSync(ROOT + 'images/freedos-boot.img');
const at = (c: number, n: number) => new Uint8Array(src.subarray(16896 + (c - 2) * 1024, 16896 + (c - 2) * 1024 + n));

const MSG = 'VITEST DROPPED PROGRAM OK\r\n$';
const CODE_LEN = 12;
const code = Buffer.from([
  0xb4, 0x09, 0xba, (0x100 + CODE_LEN) & 0xff, (0x100 + CODE_LEN) >> 8, 0xcd, 0x21,
  0xb8, 0x00, 0x4c, 0xcd, 0x21,
]);
const prog = Buffer.concat([code, Buffer.from(MSG, 'latin1')]);

function bootUntil(disk: Uint8Array, want: string, timeoutMs = 20_000): Promise<boolean> {
  return new Promise((resolve) => {
    const emu: any = new V86({
      wasm_path: ROOT + 'v86/v86.wasm',
      bios: { url: ROOT + 'roms/seabios.bin' },
      vga_bios: { url: ROOT + 'roms/vgabios.bin' },
      fda: { buffer: disk.buffer },
      memory_size: 32 * 1024 * 1024,
      autostart: true,
    });
    /*
     * v86 builds its machine a few hundred milliseconds after the constructor returns, so
     * `emu.v86.cpu` can be undefined on the first ticks. Reading through it unconditionally
     * throws INSIDE a setInterval, where nothing catches it: vitest reports an unhandled
     * "memory access out of bounds" while the test still passes, which is how a broken test
     * looks healthy. Measured: the machine is there by ~100 ms.
     */
    const text = () => {
      const m = emu.v86?.cpu?.devices?.vga?.vga_memory;
      if (!m) return '';
      let s = '';
      for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(m[i * 2]);
      return s;
    };
    const t0 = Date.now();
    const id = setInterval(() => {
      const done = text().includes(want);
      if (done || Date.now() - t0 > timeoutMs) {
        clearInterval(id);
        emu.destroy?.();
        resolve(done);
      }
    }, 150);
  });
}

describe('drop a program and run it', () => {
  it('boots a floppy built around the program and runs it', async () => {
    const disk = buildFloppy({
      name: 'VITEST',
      ext: 'COM',
      data: new Uint8Array(prog),
      extra: [
        { name: 'KERNEL.SYS', data: at(7, 45450) },
        { name: 'COMMAND.COM', data: at(56, 66090) },
        { name: 'CONFIG.SYS', data: at(125, 209) },
      ],
      command: 'VITEST.COM',
      bootFrom: new Uint8Array(src),
    });
    expect(await bootUntil(disk, 'VITEST DROPPED PROGRAM OK')).toBe(true);
  });

  it('does not boot without boot code, which is why we copy it', async () => {
    const noCode = buildFloppy({
      name: 'VITEST',
      ext: 'COM',
      data: new Uint8Array(prog),
      command: 'VITEST.COM',
    });
    expect(await bootUntil(noCode, 'VITEST DROPPED PROGRAM OK', 6000)).toBe(false);
  });
});
