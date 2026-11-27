import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { V86 } from 'v86';
import { arabicByteFor, arabicInputStatus, encodeForDos, toCp720 } from '../src/system/cp720';

/**
 * PLAN ٥-٥, measured. Every negative result here cost a cycle to discover and is kept so the
 * next person does not pay for it again.
 *
 * The plan's acceptance criterion is "typing سلام shows سلام in DOS". What the measurements
 * support is: the **bytes** can be produced correctly and **code planted in the guest runs**.
 * Making a keystroke reach a DOS program needs a resident stub that does not exist yet, and
 * making it SHOW as Arabic needs a font and codepage the boot image does not carry. Both are
 * written down in `arabicInputStatus()` so the UI cannot claim otherwise.
 */
const ROOT = new URL('../public/', import.meta.url).pathname;
const IMG = new Uint8Array(readFileSync(ROOT + 'images/freedos-boot.img'));

function boot() {
  const emu = new V86({
    wasm_path: ROOT + 'v86/v86.wasm',
    bios: { url: ROOT + 'roms/seabios.bin' },
    vga_bios: { url: ROOT + 'roms/vgabios.bin' },
    fda: { buffer: IMG.buffer },
    memory_size: 32 * 1024 * 1024,
    autostart: true,
  } as never) as unknown as {
    v86?: { cpu?: { mem8?: Uint8Array; devices?: { vga?: Record<string, number | Uint8Array> } } };
    destroy?: () => void;
    keyboard_send_scancodes?: (c: number[]) => void;
    keyboard_send_text?: (t: string) => void;
  };
  return emu;
}

const screen = (emu: unknown) => {
  const vga = (emu as { v86?: { cpu?: { devices?: { vga?: Record<string, number | Uint8Array> } } } })
    .v86?.cpu?.devices?.vga;
  const m = vga?.vga_memory as Uint8Array | undefined;
  if (!m) return '';
  let s = '';
  for (let i = 0; i < 80 * 25; i++) s += String.fromCharCode(m[i * 2]);
  return s;
};
const memOf = (emu: unknown) =>
  (emu as { v86?: { cpu?: { mem8?: Uint8Array } } }).v86?.cpu?.mem8 as Uint8Array;

async function untilPrompt(emu: unknown) {
  for (let w = 0; !(emu as { v86?: unknown }).v86; w += 50) {
    if (w > 15_000) throw new Error('the machine never came up');
    await new Promise((r) => setTimeout(r, 50));
  }
  const t0 = Date.now();
  while (!screen(emu).includes('A:\\>') && Date.now() - t0 < 25_000) {
    await new Promise((r) => setTimeout(r, 100));
  }
  expect(screen(emu), 'FreeDOS never reached a prompt').toContain('A:\\>');
}

describe('٥-٥ the bytes are right', () => {
  it('produces the four real CP-720 bytes of سلام, in order', () => {
    const { bytes, rejected } = encodeForDos('سلام');
    expect(bytes).toEqual([0xab, 0xe9, 0x9f, 0xea]);
    expect(rejected).toEqual([]);
  });

  it('matches the codepage table rather than a second copy of the numbers', () => {
    // cross-check: if cp720.ts changes, this must change with it or fail
    expect(arabicByteFor('س')).toBe(toCp720(0x0633));
    expect(arabicByteFor('م')).toBe(toCp720(0x0645));
  });

  it('names a character it cannot encode instead of substituting one', () => {
    // Farsi peh has no CP-720 byte. Writing '?' would say the word arrived when it did not.
    const { bytes, rejected } = encodeForDos('پ');
    expect(bytes).toEqual([]);
    expect(rejected).toEqual(['پ']);
    // and the rest of a mixed word still encodes
    const mixed = encodeForDos('سپ');
    expect(mixed.bytes).toEqual([0xab]);
    expect(mixed.rejected).toEqual(['پ']);
  });

  it('passes ASCII through unchanged', () => {
    expect(encodeForDos('abc 123').bytes).toEqual([0x61, 0x62, 0x63, 0x20, 0x31, 0x32, 0x33]);
  });
});

describe('٥-٥ what the UI is allowed to claim', () => {
  it('does not claim the guest can show Arabic', () => {
    /*
     * This is the assertion the acceptance criterion fails on, honestly. Typing is possible;
     * showing is not, because the shipped kernel renders CP437 where these bytes are
     * box-drawing characters. A keyboard that promises «سلام» and paints «««« is the defect.
     */
    const s = arabicInputStatus();
    expect(s.canShow).toBe(false);
    // and it must not claim typing works either: delivery is the missing half
    expect(s.canType).toBe(false);
    expect(s.why).toContain('CP437');
    // and it must say WHERE input does not work either: hardware-reading games
    expect(s.why).toContain('العتاد');
  });
});

describe('٥-٥ the three dead ends, kept as measurements', () => {
  it('a scancode cannot carry a high byte: 0xab types nothing, "abc" types "abc"', async () => {
    /*
     * The obvious design -- "map Arabic letters to scancodes" -- cannot work: PS/2 set 1 has
     * no make code for 0xAB. Measured, so that "just send scancodes" is settled by evidence
     * and not by opinion.
     */
    const emu = boot();
    await untilPrompt(emu);
    // the control: real scancodes type real letters
    emu.keyboard_send_scancodes?.([0x1e, 0x9e, 0x30, 0xb0, 0x2e, 0xae]); // a b c
    await new Promise((r) => setTimeout(r, 500));
    const withAbc = screen(emu);
    expect(withAbc, 'ASCII scancodes did not type').toContain('abc');
    // and the byte we would need for Arabic has no scancode: sending 0xab types nothing
    emu.keyboard_send_scancodes?.([0xab]);
    await new Promise((r) => setTimeout(r, 500));
    const lastLine = screen(emu).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim()).at(-1) ?? '';
    expect(lastLine.endsWith('abc'), 'a high scancode produced a character').toBe(true);
    emu.destroy?.();
  }, 60_000);

  it('the BIOS keyboard buffer swallows the byte: pointers move, the screen does not', async () => {
    /*
     * Measured, and this is the dead end that ends the "just inject a key" design:
     *
     *   single 0xAB   head/tail 0x1e -> 0x20, screen unchanged for 3 seconds
     *   single 'A'    the same: the pointer moves and nothing is typed
     *   'A' then 0xAB the guest dies with "Error reading from device CON: unknown command"
     *
     * The pointer moving looked like success in the first version of this test. What moves it
     * is the BIOS discarding the entry -- and when COMMAND.COM does read a high byte it
     * treats it as part of a command and the session ends. So there is no arrangement of
     * buffer injection that gives a user a typed Arabic word at a DOS prompt.
     */
    const emu = boot();
    await untilPrompt(emu);
    const mem = memOf(emu);
    expect(mem).toBeDefined();
    const rd16 = (a: number) => mem[a] | (mem[a + 1] << 8);
    const before = rd16(0x41c);
    const cellBefore = screen(emu);
    const t = before;
    mem[t] = 0xab;
    mem[t + 1] = 0x00;
    mem[0x41c] = (t + 2) & 0xff;
    mem[0x41c + 1] = ((t + 2) >> 8) & 0xff;
    /*
     * Wait for the CONDITION, not for a duration. A fixed 900 ms is a guess about how busy the
     * machine is: under the full suite's load this test failed once with a screen that had
     * not settled yet, and a test that fails depending on what else is running teaches people
     * to re-run it rather than to read it.
     */
    for (let w = 0; rd16(0x41c) === before && w < 5000; w += 25) {
      await new Promise((r) => setTimeout(r, 25));
    }
    // the pointer moved: the BIOS took the entry
    expect(rd16(0x41c), 'the BIOS never touched the entry').not.toBe(before);
    // and the user got nothing: measured 6 out of 6 trials, the screen is byte-identical
    expect(screen(emu), 'the guest showed the injected byte').toBe(cellBefore);
    emu.destroy?.();
  }, 60_000);

  it('a high byte after a letter KILLS the guest session -- the reason not to ship injection', async () => {
    /*
     * The single most important measurement of this cycle. Injecting 'A' and then 0xAB at a
     * FreeDOS prompt does not draw a character and does not ignore it: COMMAND.COM reads the
     * high byte as part of a command and dies with
     *
     *     Error reading from device CON: unknown command given to driver
     *
     * That is a crash the user would see, from a feature that is meant to type a letter. No
     * test asserted it before because the first version only checked that bytes "arrived".
     * The injection path is therefore not shipped at all -- see STUB_NOT_WRITTEN.
     */
    const emu = boot();
    await untilPrompt(emu);
    const mem = memOf(emu);
    const push = (b: number) => {
      const t = mem[0x41c] | (mem[0x41c + 1] << 8);
      mem[t] = b;
      mem[t + 1] = 0;
      mem[0x41c] = (t + 2) & 0xff;
      mem[0x41c + 1] = ((t + 2) >> 8) & 0xff;
    };
    push(0x41); // 'A' -- a letter the shell accepts
    await new Promise((r) => setTimeout(r, 400));
    push(0xab); // the byte Arabic needs
    await new Promise((r) => setTimeout(r, 700));
    const s = screen(emu);
    expect(s, 'the shell survived a high byte; the dead end is different from what is documented').toMatch(
      /Error reading from device CON|unknown command|halted/i,
    );
    emu.destroy?.();
  }, 60_000);

  it('code planted inside the guest DOES run: an INT 1Ch stub executes', async () => {
    /*
     * The mechanism that works, and the reason ٥-٥ is possible at all: hook the BIOS timer
     * tick, which fires ~18.2 times a second, and the stub runs inside the guest. Measured:
     * 23 executions in 1.2 s, no crash. A resident input stub would be built on this.
     */
    const emu = boot();
    await untilPrompt(emu);
    const mem = memOf(emu);
    const rd32 = (a: number) => (mem[a] | (mem[a + 1] << 8) | (mem[a + 2] << 16) | (mem[a + 3] << 24)) >>> 0;
    const ivt = 0x1c * 4;
    const oldOff = rd32(ivt) & 0xffff;
    const oldSeg = rd32(ivt) >>> 16;
    const SEG = 0x9000;
    const lin = SEG * 16;
    // push ax,bx,cx ; mov ah,0x0e ; mov al,'Z' ; mov bl,0 ; int 10h ; pop cx,bx,ax ;
    // jmp far cs:[slot]
    const code = [
      0x50, 0x53, 0x51, 0xb4, 0x0e, 0xb0, 0x5a, 0xb3, 0x00, 0xcd, 0x10, 0x59, 0x5b, 0x58,
      0x2e, 0xff, 0x2e, 0x13, 0x00, 0, 0, 0, 0,
    ];
    code.forEach((b, i) => (mem[lin + i] = b));
    const slot = lin + code.length - 4;
    mem[slot] = oldOff & 0xff;
    mem[slot + 1] = (oldOff >> 8) & 0xff;
    mem[slot + 2] = oldSeg & 0xff;
    mem[slot + 3] = (oldSeg >> 8) & 0xff;
    mem[ivt] = 0x00;
    mem[ivt + 1] = 0x00;
    mem[ivt + 2] = SEG & 0xff;
    mem[ivt + 3] = (SEG >> 8) & 0xff;
    await new Promise((r) => setTimeout(r, 1200));
    const s = screen(emu);
    expect(s, 'the hooked stub crashed the guest').not.toMatch(/Invalid Opcode|halted/i);
    const zCount = (s.match(/Z/g) ?? []).length;
    expect(zCount, 'the stub never ran').toBeGreaterThan(5);
    emu.destroy?.();
  }, 60_000);
});
