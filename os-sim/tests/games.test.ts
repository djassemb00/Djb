import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { V86 } from 'v86';
import { buildFloppy } from '../src/system/fat12';

/**
 * The bundled games disk must behave like a launcher: menu -> game -> menu.
 * It also guards the two silent DOS bugs we hit (timer through DS, extended keys):
 * if either returns, SNAKE stops responding and this test hangs, not passes.
 */
const ROOT = new URL('../public/', import.meta.url).pathname;
const src = readFileSync(ROOT + 'images/freedos-boot.img');
const at = (c: number, n: number) => new Uint8Array(src.subarray(16896 + (c - 2) * 1024, 16896 + (c - 2) * 1024 + n));

function buildGamesDisk() {
  return buildFloppy({
    name: 'MENU',
    ext: 'COM',
    data: new Uint8Array(readFileSync('os-dos/MENU.COM')),
    extra: [
      { name: 'KERNEL.SYS', data: at(7, 45450) },
      { name: 'COMMAND.COM', data: at(56, 66090) },
      { name: 'CONFIG.SYS', data: at(125, 209) },
      { name: 'SNAKE.COM', data: new Uint8Array(readFileSync('os-dos/SNAKE.COM')) },
      { name: 'PONG.COM', data: new Uint8Array(readFileSync('os-dos/PONG.COM')) },
    ],
    command: 'MENU.COM',
    bootFrom: new Uint8Array(src),
  });
}

describe('games disk is a launcher', () => {
  it('shows its menu, starts SNAKE on "1", and returns on Q', async () => {
    const disk = buildGamesDisk();
    // keep the artifact fresh for the app as a side effect of running the test
    writeFileSync(ROOT + 'images/dos-games.img', disk);
    void mkdtempSync(join(tmpdir(), 'nova-'));

    const emu: any = new V86({
      wasm_path: ROOT + 'v86/v86.wasm',
      bios: { url: ROOT + 'roms/seabios.bin' },
      vga_bios: { url: ROOT + 'roms/vgabios.bin' },
      fda: { buffer: disk.buffer },
      memory_size: 32 * 1024 * 1024,
      autostart: true,
    });
    const text = () => {
      const m = emu.v86.cpu.devices.vga.vga_memory;
      let s = '';
      for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(m[i * 2]);
      return s;
    };

    const seen = { menu1: false, snake: false, menu2: false };
    const t0 = Date.now();
    let launched = false;
    await new Promise<void>((resolve) => {
      const id = setInterval(() => {
        const s = text();
        if (!seen.menu1 && s.includes('press 1, 2 or 3')) {
          seen.menu1 = true;
          emu.keyboard_send_scancodes([0x02, 0x82]); // "1"
          launched = true;
        } else if (launched && !seen.snake && s.includes('SNAKE  -')) {
          seen.snake = true;
          emu.keyboard_send_scancodes([0x10, 0x90]); // Q
        } else if (seen.snake && s.includes('press 1, 2 or 3')) {
          seen.menu2 = true;
        }
        if (seen.menu2 || Date.now() - t0 > 20_000) {
          clearInterval(id);
          emu.destroy?.();
          resolve();
        }
      }, 150);
    });

    expect(seen.menu1, 'menu never appeared').toBe(true);
    expect(seen.snake, 'SNAKE never started from the menu').toBe(true);
    expect(seen.menu2, 'menu did not come back after quitting SNAKE').toBe(true);
  }, 40_000);
});
