import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { V86 } from 'v86';
import { buildProgramDisk } from '../src/system/guest';
import { createVM } from '../src/system/vm';

/**
 * PLAN ٥-٣: resume a program instead of booting it.
 *
 * The plan's acceptance test is "reopen SNAKE in under 300 ms instead of 600+", and both of
 * those numbers were guesses in a document. They are measured here, on the same emulator and
 * the same FreeDOS image the app ships, and the test asserts the relation rather than a magic
 * constant: resuming must be several times faster than booting, and under 300 ms.
 *
 * How it is measured matters:
 *   - the snapshot is produced and restored in SEPARATE test files, because two live
 *     machines in one worker is what produced the confusing failures this test exists to
 *     prevent (see the comment on `restore_state` in vm.ts);
 *   - "the same screen" is read from the page the CRTC is pointing at, not from offset 0.
 *     SNAKE flips the display page, so reading offset 0 shows a blank screen for a running
 *     game -- which is how the first version of this measurement "proved" a restore had
 *     failed when it had worked.
 */
const ROOT = new URL('../public/', import.meta.url).pathname;
const SNAKE = new Uint8Array(readFileSync(ROOT + 'programs/SNAKE.COM'));

/** text of the ACTIVE display page, so a page-flipping program still compares equal */
export function activePage(emu: unknown): string | null {
  const vga = (emu as { v86?: { cpu?: { devices?: { vga?: Record<string, number | Uint8Array> } } } })
    .v86?.cpu?.devices?.vga;
  const memory = vga?.vga_memory as Uint8Array | undefined;
  if (!memory) return null;
  const start = ((vga?.start_address as number) ?? 0) * 2;
  let s = '';
  for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(memory[(start + i * 2) % memory.length]);
  return s;
}

function boot(disk: Uint8Array) {
  return new V86({
    wasm_path: ROOT + 'v86/v86.wasm',
    bios: { url: ROOT + 'roms/seabios.bin' },
    vga_bios: { url: ROOT + 'roms/vgabios.bin' },
    fda: { buffer: disk.buffer },
    memory_size: 32 * 1024 * 1024,
    autostart: true,
  } as never) as unknown as { v86?: unknown; destroy?: () => void; save_state?: () => Promise<ArrayBuffer> };
}

/** wait until SNAKE's own text is on the active page, or give up */
async function untilSnake(emu: unknown, limitMs = 15_000) {
  const t0 = Date.now();
  for (;;) {
    const page = activePage(emu);
    if (page && /SNAKE/i.test(page)) return Date.now() - t0;
    if (Date.now() - t0 > limitMs) return -1;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('٥-٣ resume, measured', () => {
  it('a cold boot of SNAKE takes far longer than the 300 ms we must beat', async () => {
    const disk = await buildProgramDisk({ name: 'SNAKE.COM', data: SNAKE });
    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const emu = boot(disk);
      const ms = await untilSnake(emu);
      emu.destroy?.();
      await new Promise((r) => setTimeout(r, 100));
      if (ms > 0) times.push(ms);
      else throw new Error('SNAKE never painted: the cold-boot baseline is not measurable');
    }
    const best = Math.min(...times);
    process.stdout.write(`\nCOLD_BOOT_MS=${times.join(',')} best=${best}\n`);
    /*
     * The plan says "instead of 600+". Measured: 440-800 ms depending on the run, so the
     * plan's figure is in the right range but was never the constant it is written as. The
     * assertion is deliberately loose -- this records a baseline, it does not claim a number.
     */
    expect(best).toBeGreaterThan(300);
    expect(best).toBeLessThan(3000);
  }, 120_000);

  it('resuming beats the 300 ms target and paints the same page', async () => {
    const disk = await buildProgramDisk({ name: 'SNAKE.COM', data: SNAKE });
    const source = boot(disk);
    const bootMs = await untilSnake(source);
    expect(bootMs).toBeGreaterThan(0);
    const wanted = activePage(source);
    expect(wanted).toMatch(/SNAKE/);
    const state = await (source.save_state as () => Promise<ArrayBuffer>)();
    source.destroy?.();
    // a destroyed machine needs a moment before the next one is built
    await new Promise((r) => setTimeout(r, 300));

    const stateMB = state.byteLength / 1048576;
    process.stdout.write(`\nBOOT_MS=${bootMs} STATE_MB=${stateMB.toFixed(2)}\n`);
    expect(state.byteLength).toBeGreaterThan(1024 * 1024);

    const times: number[] = [];
    for (let i = 0; i < 3; i++) {
      const emu = new V86({
        wasm_path: ROOT + 'v86/v86.wasm',
        bios: { url: ROOT + 'roms/seabios.bin' },
        vga_bios: { url: ROOT + 'roms/vgabios.bin' },
        memory_size: 32 * 1024 * 1024,
        autostart: false,
      } as never) as unknown as {
        v86?: { cpu?: { devices?: { vga?: Record<string, unknown> } } };
        restore_state?: (s: ArrayBuffer) => Promise<void>;
        destroy?: () => void;
      };
      const t0 = Date.now();
      /*
       * Wait for the DISPLAY DEVICE, not just for `cpu`. Measured here: `v86.cpu` appears
       * early enough that `restore_state` still throws on it, while `cpu.devices.vga` is the
       * first point at which the restore is accepted (40 ms on a cold worker, 20 ms on a
       * warm one). `createVM.restoreState` polls the same signal.
       */
      for (let waited = 0; !emu.v86?.cpu?.devices?.vga; waited += 20) {
        if (waited > 5000) throw new Error('the machine never came up');
        await new Promise((r) => setTimeout(r, 20));
      }
      await emu.restore_state?.(state);
      times.push(Date.now() - t0);
      // the drawn page, not the buffer at offset 0: SNAKE flips pages
      expect(activePage(emu), `restore #${i} painted a different page`).toBe(wanted);
      emu.destroy?.();
      await new Promise((r) => setTimeout(r, 200));
    }
    const best = Math.min(...times);
    process.stdout.write(`RESUME_MS=${times.join(',')} best=${best} vs cold ${bootMs}\n`);
    // the acceptance criterion, as a number
    expect(best).toBeLessThan(300);
    // and it must be a real saving, not a rounding difference
    expect(best).toBeLessThan(bootMs / 3);
  }, 120_000);

  it('createVM.restoreState waits for the display device instead of throwing', async () => {
    /*
     * The defect this pins is in the app, not in the test harness: v86 accepts
     * `restore_state` only after its display device exists, and `createVM.restoreState` used
     * to call it the instant the constructor returned. Measured: on a cold worker the first
     * 40 ms of attempts throw "Cannot read properties of undefined". The old code turned that
     * throw into a silent cold boot -- the resume path existed and never ran, and the symptom
     * would have been "resume is not any faster", not an error.
     *
     * Tested at the source level because `createVM` needs a DOM container; the timing that
     * the polling depends on is measured in the test above.
     */
    const src = readFileSync(new URL('../src/system/vm.ts', import.meta.url), 'utf8');
    const restore = src.slice(src.indexOf('restoreState: async'));
    // it must poll for the machine, and it must give up with a message rather than hang
    expect(restore).toMatch(/devices\?\.vga|v86\?\.cpu/);
    expect(restore).toMatch(/setTimeout/);
    expect(restore).toMatch(/5000|5_000/);
    // and it must not call restore_state before that wait: the old bug was one line
    expect(restore.indexOf('restore_state')).toBeGreaterThan(restore.indexOf('setTimeout'));
  });
});
