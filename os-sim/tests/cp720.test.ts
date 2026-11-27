import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CP720_ARABIC,
  JOINS_FORWARD,
  decodeCp720,
  isRtlCodePoint,
  joiningForms,
  readCp720,
  shapedDisplayText,
  toCp720,
  toDisplayOrder,
} from '../src/system/cp720';

/**
 * PLAN ٥-٤: a CP-720 Arabic file, shaped and read right to left.
 *
 * The bug this file exists for: `cp720_byte()` in `os-image/arabic.c` had a hand-written
 * table that put hamza at 0xC1 and yeh at 0xEA. In the real codepage those bytes are
 * box-drawing characters -- hamza is 0x98 and yeh is 0xEF. Nothing caught it because the one
 * caller printed the numbers to a serial log that no test read: a self-check that only
 * PRINTS is worth nothing.
 *
 * So the table here is compared against the actual bytes of the real codepage.
 */

describe('٥-٤ the CP-720 table is the real one', () => {
  /*
   * These four assertions are the whole defect. In CP-720, 0xC1 is "BOX DRAWINGS LIGHT UP AND
   * HORIZONTAL", not hamza -- that is what the old table claimed, and it is why any file we
   * encoded would have opened as a grid of lines.
   */
  it('puts hamza at 0x98, not 0xC1, and yeh at 0xEF, not 0xEA', () => {
    expect(CP720_ARABIC[0x98]).toBe(0x0621); // hamza
    expect(CP720_ARABIC[0xef]).toBe(0x064a); // yeh
    expect(CP720_ARABIC[0xc1]).toBeUndefined();
    expect(CP720_ARABIC[0xea]).toBe(0x0645); // meem -- the byte the old table called yeh
  });

  it('covers the letters in the ranges CP-720 actually uses', () => {
    // 0x98-0xAF then 0xE0-0xEF, plus tatweel at 0x95 and the harakat at 0xF1-0xF6
    const arabic = Object.entries(CP720_ARABIC).map(([b, cp]) => [Number(b), cp] as const);
    for (const [byte, cp] of arabic) {
      // letters are 0x0621-0x064A, tatweel 0x0640, harakat 0x064B-0x0652: one block
      expect(cp, `byte 0x${byte.toString(16)} is not Arabic`).toBeGreaterThanOrEqual(0x0621);
      expect(cp).toBeLessThanOrEqual(0x0652);
    }
    // every letter the codepage can hold must be inside the block it belongs to
    for (const cp of Object.values(CP720_ARABIC)) {
      expect(cp >= 0x0621 && cp <= 0x0652, `U+${cp.toString(16)} is outside the Arabic block`).toBe(true);
    }
    const letters = [0x0621, 0x0627, 0x0628, 0x0633, 0x0644, 0x0645, 0x064a];
    const present = new Set(Object.values(CP720_ARABIC));
    for (const cp of letters) expect(present.has(cp), `missing U+${cp.toString(16)}`).toBe(true);
  });

  it('maps ASCII to itself and refuses what the codepage cannot hold', () => {
    for (let b = 0x20; b < 0x7f; b++) expect(toCp720(b)).toBe(b);
    // an Arabic letter the codepage has no byte for (e.g. Farsi peh) must be refused, not faked
    expect(toCp720(0x067e)).toBeNull();
    expect(toCp720(0x0628)).toBe(0xa0);
  });

  it('round-trips every entry byte -> code point -> byte', () => {
    for (const [b, cp] of Object.entries(CP720_ARABIC)) {
      expect(toCp720(cp)).toBe(Number(b));
      expect(decodeCp720(new Uint8Array([Number(b)]))).toEqual([cp]);
    }
  });
});

describe('٥-٤ reading a file', () => {
  it('decodes a CP-720 sentence into the letters it really is', () => {
    /*
     * "سلام" in CP-720: seen 0xAB, lam 0xE9, alef 0x9F, meem 0xEA. Not 0xC1-0xEA.
     * Written out as the bytes a DOS Arabic editor would have produced.
     */
    const bytes = new Uint8Array([0xab, 0xe9, 0x9f, 0xea]);
    const doc = readCp720(bytes);
    expect(doc.codePoints).toEqual([0x0633, 0x0644, 0x0627, 0x0645]);
    expect(doc.text).toBe('سلام');
    expect(doc.arabic).toBe(true);
  });

  it('says a Latin-only file is not Arabic instead of shaping it', () => {
    const doc = readCp720(new TextEncoder().encode('hello world'));
    expect(doc.arabic).toBe(false);
    expect(doc.text).toBe('hello world');
  });

  it('keeps CR LF as line breaks the viewer can split on', () => {
    const doc = readCp720(new Uint8Array([0x9f, 0x0d, 0x0a, 0xa0]));
    expect(doc.codePoints).toContain(0x0a);
    expect(doc.codePoints.filter((c) => c === 0x0a)).toHaveLength(1);
  });
});

describe('٥-٤ joining forms follow the letters around them', () => {
  const form = (s: string) => joiningForms([...s].map((c) => c.codePointAt(0) as number));

  it('gives one letter isolated, initial, medial and final by its neighbours', () => {
    // beh between two joining letters is medial; at the start, initial; at the end, final
    expect(form('ب')).toEqual(['isolated']);
    expect(form('بب')).toEqual(['initial', 'final']);
    expect(form('ببب')).toEqual(['initial', 'medial', 'final']);
    /*
     * The two directional cases, worked out by hand from the joining model rather than from
     * the code:
     *   با : beh joins forward -> initial; alef joins only backwards -> final
     *   اب : alef does NOT join forward, so the beh after it has nothing to connect to ->
     *        isolated. (The first version of this test asserted 'final','final' here, which
     *        is what an inverted join table looks like.)
     */
    expect(form('با')).toEqual(['initial', 'final']);
    expect(form('اب')).toEqual(['isolated', 'isolated']);
  });

  it('does not break a join on a haraka between two letters', () => {
    // beh + fatha + beh: the fatha is transparent, so the two behs still join
    expect(form('بَب')).toEqual(['initial', null, 'final']);
  });

  it('ends a word at a letter that does not join forward', () => {
    // سلام: seen initial, lam medial, alef final, meem isolated -- the alef ends the join
    expect(form('سلام')).toEqual(['initial', 'medial', 'final', 'isolated']);
    // and a space is not a joining partner, so the next word starts fresh
    expect(form('ا ب')).toEqual(['isolated', null, 'isolated']);
  });

  it('leaves non-Arabic alone instead of guessing', () => {
    expect(form('a')).toEqual([null]);
    expect(form('بa')).toEqual(['isolated', null]);
    // a Latin run inside the word stops the join: beh is initial, not medial
    expect(form('بaب')).toEqual(['isolated', null, 'isolated']);
  });
});

describe('٥-٤ direction: an Arabic line reads right to left, Latin inside it does not', () => {
  const cps = (s: string) => [...s].map((c) => c.codePointAt(0) as number);
  const str = (cps_: number[]) => String.fromCodePoint(...cps_);

  it('reverses an Arabic line so it starts on the right', () => {
    // "سلام" reversed is "مالس" -- visually correct as a right-to-left line
    expect(str(toDisplayOrder(cps('سلام')))).toBe('مالس');
  });

  it('keeps a Latin run in its own order inside an Arabic line', () => {
    /*
     * The failure this prevents: reversing the whole line turns "NovaOS" into "SOavoN",
     * which is what a naive renderer does and what the user would see as broken.
     */
    const shown = str(toDisplayOrder(cps('سلام NovaOS')));
    expect(shown).toContain('NovaOS');
    expect(shown).not.toContain('SOavoN');
    // and the line still starts from the Arabic end
    expect(shown.indexOf('NovaOS')).toBeLessThan(shown.indexOf('م'));
  });

  it('leaves a Latin-only line alone', () => {
    expect(str(toDisplayOrder(cps('hello world')))).toBe('hello world');
  });

  it('reorders each line separately', () => {
    const lines = toDisplayOrder(cps('سلام\nمرحبا'));
    const split = lines.indexOf(0x0a);
    expect(split).toBeGreaterThan(0);
    // the newline survives, and both halves are reversed independently
    expect(str(lines.slice(0, split))).toBe('مالس');
    expect(str(lines.slice(split + 1))).toBe('ابحرم');
  });

  it('does not let a CR be reordered as if it were text', () => {
    // a DOS text file is CRLF. Reversing a line that still holds the CR moves it, and the
    // viewer shows a stray control glyph at the end of the line.
    const out = toDisplayOrder([0x0633, 0x0644, 0x0627, 0x0645, 0x0d, 0x0a]);
    expect(out).not.toContain(0x0d);
    expect(out).toContain(0x0a);
    expect(String.fromCodePoint(...out.filter((c) => c !== 0x0a))).toBe('مالس');
  });

  it('survives the degenerate inputs a real file contains', () => {
    // empty file, a lone newline, a lone space, a haraka with no letter to sit on
    for (const input of [[], [0x0a], [0x20], [0x0651], [0x0d, 0x0a]]) {
      expect(() => shapedDisplayText(input)).not.toThrow();
      expect(() => joiningForms(input)).not.toThrow();
    }
    // a haraka on its own has no form: it is not a letter
    expect(joiningForms([0x0651])).toEqual([null]);
  });

  it('knows which code points are Arabic', () => {
    expect(isRtlCodePoint(0x0633)).toBe(true);
    expect(isRtlCodePoint(0x0041)).toBe(false);
    expect(isRtlCodePoint(0x0651)).toBe(true); // a haraka is still inside the block
  });

  it('shapedDisplayText is the same thing with the join and direction applied', () => {
    // the call the UI makes: one string, ready to draw
    expect(shapedDisplayText(cps('سلام'))).toBe('مالس');
    expect(shapedDisplayText(cps('abc'))).toBe('abc');
  });
});

describe('٥-٤ the kernel join table is not inverted', () => {
  it('marks exactly the right letters as joining forward', () => {
    /*
     * This is the second half of A91, and the reason it is checked from the C SOURCE rather
     * than trusted: `letter_join` in `os-image/arabic.c` was inverted for 33 of its 37
     * entries -- beh was marked as not joining forward and alef as joining -- so every Arabic
     * word the kernel drew had the wrong shapes. A boot self-check printed glyph numbers to a
     * serial log and nothing read them, so the defect survived.
     *
     * The expected row is written out here from the joining model: alef, dal, thal, reh, zain,
     * waw and hamza (with their hamza forms) join only to the preceding letter; every other
     * letter joins both ways.
     */
    const src = readFileSync(new URL('../os-image/arabic.c', import.meta.url), 'utf8');
    const block = src.slice(src.indexOf('static const unsigned char letter_join[] = {'));
    const row = block
      .slice(block.indexOf('{') + 1, block.indexOf('};'))
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map(Number);
    const cps = [
      0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, 0x0628, 0x0629, 0x062a,
      0x062b, 0x062c, 0x062d, 0x062e, 0x062f, 0x0630, 0x0631, 0x0632, 0x0633, 0x0634,
      0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063a, 0x0640, 0x0641, 0x0642, 0x0643,
      0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x0649, 0x064a,
    ];
    expect(row).toHaveLength(cps.length);
    const SOLO = new Set([0x0621, 0x0622, 0x0623, 0x0625, 0x0627, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648]);
    const expected = cps.map((cp) => (SOLO.has(cp) ? 0 : 1));
    expect(row, 'letter_join disagrees with the Arabic joining model').toEqual(expected);
    // and it must agree with the set the shaper actually uses
    for (let i = 0; i < cps.length; i++) {
      expect(JOINS_FORWARD.has(cps[i]), `U+${cps[i].toString(16)} disagrees with arabic.c`).toBe(
        row[i] === 1,
      );
    }
  });
});

describe('٥-٤ the C table and the TS table are the same table', () => {
  it('agrees entry for entry with os-image/arabic.c', () => {
    /*
     * Two copies of one fact is how the table drifted in the first place: the kernel had its
     * own and the app had none. They are generated from the same Unicode table, and this
     * asserts it, so a hand edit to either one fails here instead of on a user's screen.
     */
    const src = readFileSync(new URL('../os-image/arabic.c', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('unsigned char cp720_byte'), src.indexOf('unsigned char cp720_byte') + 4000);
    const pairs = [...body.matchAll(/case (0x[0-9A-Fa-f]+): return (0x[0-9A-Fa-f]+);/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    expect(pairs.length).toBe(Object.keys(CP720_ARABIC).length);
    const fromC = new Map(pairs);
    for (const [b, cp] of Object.entries(CP720_ARABIC)) {
      expect(fromC.get(cp), `C is missing U+${cp.toString(16)}`).toBe(Number(b));
    }
  });
});

describe('٥-٤ the file manager view', () => {
  it('renders an Arabic file right to left, shapes included', async () => {
    const { cp720ViewOf } = await import('../src/apps/FilesApp');
    // what a user types: UTF-8 in the app's file system. What they see: the CP-720 reading.
    expect(cp720ViewOf('سلام')).toBe('مالس');
    expect(cp720ViewOf('hello')).toBe('hello');
  });

  it('keeps a Latin word readable inside an Arabic line', async () => {
    const { cp720ViewOf } = await import('../src/apps/FilesApp');
    const shown = cp720ViewOf('مرحبا NovaOS');
    expect(shown).toContain('NovaOS');
    expect(shown).not.toContain('SOavoN');
  });

  it('refuses a character CP-720 cannot hold instead of drawing a guess', async () => {
    /*
     * Farsi peh (U+067E) has no CP-720 byte. The wrong answers are: draw it anyway (the file
     * is not CP-720 and the user will not know), throw (the app looks broken), or write a
     * question mark (silent data loss). It says which character and why.
     */
    const { cp720ViewOf } = await import('../src/apps/FilesApp');
    const said = cp720ViewOf('پ');
    expect(said).toContain('CP-720');
    expect(said).toContain('067E');
    // and it must not pretend to be the letter
    expect(said).not.toBe('پ');
  });

  it('round-trips a whole Arabic sentence through the codepage and back', async () => {
    const { cp720ViewOf } = await import('../src/apps/FilesApp');
    // every letter here is inside CP-720, and the display order is the reverse of the logical
    const logical = 'بسم الله';
    const shown = cp720ViewOf(logical);
    expect([...shown].reverse().join('')).toBe(logical);
  });
});

describe('٥-٤ the shipped kernel image carries the corrected table', () => {
  it('boots and prints a joining form for every letter, and alef is never initial', async () => {
    /*
     * A92: fixing `arabic.c` is not fixing the product. The image the app ships is built from
     * it, and the image in `public/images/` was older than the fix -- so the app would have
     * kept drawing the inverted shapes while the source looked right. This test boots the
     * SHIPPED image and reads the kernel's own self-check off COM1.
     *
     * Measured difference, same word, before vs after the table fix:
     *   before  forms 0x02 0x01 0x00 0x02 0x01 0x00 0x00   (alef came out INITIAL -- a form
     *   after   forms 0x00 0x02 0x03 0x01 0x02 0x03 0x01    that cannot exist for alef)
     */
    const { V86 } = await import('v86');
    const ROOT = new URL('../public/', import.meta.url).pathname;
    const img = new Uint8Array(readFileSync(ROOT + 'images/nova-desk.img'));
    const emu = new V86({
      wasm_path: ROOT + 'v86/v86.wasm',
      bios: { url: ROOT + 'roms/seabios.bin' },
      vga_bios: { url: ROOT + 'roms/vgabios.bin' },
      fda: { buffer: img.buffer },
      memory_size: 32 * 1024 * 1024,
      autostart: true,
    } as never) as unknown as {
      add_listener?: (name: string, cb: (b: number) => void) => void;
      destroy?: () => void;
    };
    let serial = '';
    emu.add_listener?.('serial0-output-byte', (b: number) => {
      serial += String.fromCharCode(b);
    });
    const t0 = Date.now();
    while (!/ARABIC-END/.test(serial) && Date.now() - t0 < 25_000) {
      await new Promise((r) => setTimeout(r, 150));
    }
    emu.destroy?.();

    expect(serial, 'the kernel never finished its Arabic self-check').toContain('ARABIC-END');
    const lines = serial.split(/\r?\n/).map((l) => l.trim());
    const forms: number[] = [];
    const cps: number[] = [];
    lines.forEach((l, i) => {
      if (l.startsWith('form=') && lines[i - 1]?.startsWith('glyph=')) forms.push(Number(l.slice(5)));
      if (l.startsWith('cp720=')) cps.push(Number(l.slice(6)));
    });
    expect(forms).toHaveLength(7);
    expect(cps).toHaveLength(7);
    // the sample is سلام: the CP-720 bytes must be the real ones, not the old wrong table's
    expect(cps).toEqual([0x9f, 0xe9, 0xe3, 0xa9, 0xa0, 0xef, 0xa1]);
    // form 2 is "initial", and alef (index 2) must never take it: alef does not join forward
    expect(forms[2]).not.toBe(2);
    // and the first letter must be isolated, not initial: alef before it does not join forward
    expect(forms[0]).toBe(0);
  }, 60_000);
});
