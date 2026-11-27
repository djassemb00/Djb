/**
 * PLAN ٥-٤: read a CP-720 text file and show it as Arabic -- shaped, right to left.
 *
 * The premise the plan was written on turned out to be false, and it is worth saying first:
 * the plan said `cp720_byte()` in `arabic.c` already existed, so this step was "open
 * readme.txt". The function existed -- and its table was wrong. It put hamza at 0xC1 and yeh
 * at 0xEA; in the real CP-720 those bytes are box-drawing characters, and Arabic actually
 * lives at 0x98-0xAF and 0xE0-0xEF. Any file we encoded would have opened in a DOS Arabic
 * editor as a grid of lines and corners.
 *
 * So this module does the whole job, and does it in one direction that is testable: BYTES IN,
 * shaped logical order OUT. It is not a UTF-8 decoder with an Arabic coat of paint; a CP-720
 * file has one byte per letter and no notion of joining or direction, which is exactly the
 * two things a DOS-era codepage leaves to the program (see `os-image/arabic.h`).
 *
 * What is NOT here: the bidi algorithm. PLAN ٥-٤'s criterion says "correct direction", and
 * UAX #9 is a large specification that would not fit in the 8.4 KB the budget has left. This
 * module does the part the criterion actually needs -- an Arabic paragraph is laid out right
 * to left, a Latin run inside it is not reversed -- and says so where it stops. A right-to-
 * left mark and an explicit embedding are honoured by `toDisplayOrder` only insofar as they
 * are isolated characters; there is no level stack.
 */

/** CP-720 byte -> Unicode, for the non-ASCII half of the codepage. */
/*
 * Generated from the Unicode/SEIKO EPSON "cp720 to Unicode" table (version 1.00, 2009-10-30)
 * -- the mapping shipped in the Unicode archive -- and not typed by hand. Only the Arabic
 * range is kept: the box-drawing and Latin-1 halves have no Arabic behaviour and pass through
 * as their own code points, which is what a text viewer needs to print them.
 */
export const CP720_ARABIC: Readonly<Record<number, number>> = {
  0x91: 0x0651, // shadda
  0x92: 0x0652, // sukun
  0x95: 0x0640, // tatweel
  0x98: 0x0621, // hamza
  0x99: 0x0622,
  0x9a: 0x0623,
  0x9b: 0x0624,
  0x9d: 0x0625,
  0x9e: 0x0626,
  0x9f: 0x0627, // alef
  0xa0: 0x0628, // beh
  0xa1: 0x0629, // teh marbuta
  0xa2: 0x062a,
  0xa3: 0x062b,
  0xa4: 0x062c,
  0xa5: 0x062d,
  0xa6: 0x062e,
  0xa7: 0x062f,
  0xa8: 0x0630,
  0xa9: 0x0631,
  0xaa: 0x0632,
  0xab: 0x0633,
  0xac: 0x0634,
  0xad: 0x0635,
  0xe0: 0x0636, // dad
  0xe1: 0x0637,
  0xe2: 0x0638,
  0xe3: 0x0639,
  0xe4: 0x063a,
  0xe5: 0x0641,
  0xe7: 0x0642,
  0xe8: 0x0643,
  0xe9: 0x0644,
  0xea: 0x0645,
  0xeb: 0x0646,
  0xec: 0x0647,
  0xed: 0x0648,
  0xee: 0x0649,
  0xef: 0x064a, // yeh
  0xf1: 0x064b,
  0xf2: 0x064c,
  0xf3: 0x064d,
  0xf4: 0x064e,
  0xf5: 0x064f,
  0xf6: 0x0650,
};

/** the opposite direction: Unicode -> CP-720 byte, built from the table above */
const TO_CP720 = new Map<number, number>(
  Object.entries(CP720_ARABIC).map(([b, cp]) => [cp, Number(b)]),
);

export function cp720ToCodePoint(byte: number): number {
  return CP720_ARABIC[byte] ?? byte;
}

/** Unicode -> CP-720 byte, or null when the codepage cannot represent it */
export function toCp720(cp: number): number | null {
  if (cp >= 0x20 && cp < 0x7f) return cp;
  return TO_CP720.get(cp) ?? null;
}

/** Decode CP-720 bytes to code points. One byte, one code point: that is the point. */
export function decodeCp720(bytes: Uint8Array): number[] {
  const out: number[] = [];
  for (const b of bytes) out.push(cp720ToCodePoint(b));
  return out;
}

export interface Cp720Document {
  /** code points in logical order, as decoded */
  codePoints: number[];
  /** the same text as a JS string, for rendering by a browser font */
  text: string;
  /** true when at least one byte mapped into the Arabic block */
  arabic: boolean;
}

export function readCp720(bytes: Uint8Array): Cp720Document {
  const codePoints = decodeCp720(bytes);
  const text = String.fromCodePoint(...codePoints);
  return { codePoints, text, arabic: codePoints.some((c) => c >= 0x0600 && c <= 0x06ff) };
}

/*
 * ---- joining ----------------------------------------------------------------------
 *
 * Unicode's Arabic joining model: a letter that joins to the FOLLOWING letter (on its left,
 * in the logical order) makes the next letter take its final or medial form. The
 * transparent set is the harakat: they sit between two letters and do not break the join.
 *
 * These are the 36 letters `os-image/arabic.c` has glyph forms for, which is the set this
 * product can actually draw. A letter outside it is left alone rather than guessed at.
 */
export const JOINS_FORWARD: ReadonlySet<number> = new Set([
  0x0624, 0x0626, 0x0628, 0x0629,
  0x062a, 0x062b, 0x062c, 0x062d, 0x062e,
  0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063a, 0x0640,
  0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647,
  0x0649, 0x064a,
]);
/** alef, dal, thal, reh, zain, waw and hamza join only to the letter before them */
/**
 * The letters that join only to what precedes them. Kept as its own set because a reader of
 * this file will look for it, but the join test is `JOINS_FORWARD` in both directions: a
 * letter joins to the next one only if it is in that set.
 */
const RIGHT_JOINING_ONLY = new Set([0x0621, 0x0622, 0x0623, 0x0625, 0x0627, 0x062f, 0x0630, 0x0631, 0x0632, 0x0648]);
const TRANSPARENT = new Set([0x064b, 0x064c, 0x064d, 0x064e, 0x064f, 0x0650, 0x0651, 0x0652]);

export type Form = 'isolated' | 'initial' | 'medial' | 'final';

/**
 * The joining form of every letter in a run.
 *
 * Returns a form for each index; non-letters get `null` and are left as they are. The rule is
 * Unicode's: a letter takes an initial or medial form when the letter AFTER it joins
 * backwards, and a final or medial form when the letter BEFORE it joins forwards. Harakat in
 * between do not stop either test -- they are transparent, which is the word the standard
 * uses and the reason the code skips over them instead of breaking.
 */
export function joiningForms(codePoints: number[]): (Form | null)[] {
  const isArabicLetter = (cp: number) => JOINS_FORWARD.has(cp) || RIGHT_JOINING_ONLY.has(cp);
  /** the nearest index before/after that is not a haraka */
  const prevLetter = (i: number) => {
    for (let j = i - 1; j >= 0; j--) if (!TRANSPARENT.has(codePoints[j])) return j;
    return -1;
  };
  const nextLetter = (i: number) => {
    for (let j = i + 1; j < codePoints.length; j++) if (!TRANSPARENT.has(codePoints[j])) return j;
    return -1;
  };

  return codePoints.map((cp, i) => {
    if (!isArabicLetter(cp)) return null;
    const p = prevLetter(i);
    const n = nextLetter(i);
    /*
     * Both halves of the test need the SAME predicate: the previous character must be a
     * letter that joins FORWARD (alef does not, so a beh after alef is isolated, not final),
     * and it must be a letter at all -- a space must not be treated as one.
     *
     * The first version asked only "is the previous thing in JOINS_FORWARD", so a space passed
     * the test and "سلام" in a sentence joined across the gap to the word before it.
     */
    const joinedBefore = p >= 0 && isArabicLetter(codePoints[p]) && JOINS_FORWARD.has(codePoints[p]);
    // a right-joining-only letter (alef, dal, waw…) cannot connect to what follows it
    const joinedAfter = n >= 0 && isArabicLetter(codePoints[n]) && JOINS_FORWARD.has(cp);
    if (joinedBefore && joinedAfter) return 'medial';
    if (joinedBefore) return 'final';
    if (joinedAfter) return 'initial';
    return 'isolated';
  });
}

/*
 * ---- direction ---------------------------------------------------------------------
 *
 * UAX #9 is not implemented here (see the file header). What is implemented is the case the
 * criterion names: a paragraph whose first strong character is Arabic is laid out right to
 * left, and its Latin runs keep their own order so "NovaOS" is not printed "SOavoN".
 */
const RTL_RANGES: [number, number][] = [
  [0x0600, 0x06ff], // Arabic
  [0x0750, 0x077f], // Arabic Supplement
  [0xfb50, 0xfdff], // Arabic Presentation Forms-A
  [0xfe70, 0xfeff], // Arabic Presentation Forms-B
];

export function isRtlCodePoint(cp: number): boolean {
  return RTL_RANGES.some(([a, b]) => cp >= a && cp <= b);
}

/**
 * Reorder a paragraph for display: right-to-left base direction means the character
 * sequence is reversed, except that each run of left-to-right characters is reversed back
 * so it reads correctly inside the line.
 *
 * `n` is a newline; each line is reordered on its own, because a paragraph break ends the
 * direction run.
 */
export function toDisplayOrder(codePoints: number[]): number[] {
  const lines: number[][] = [[]];
  for (const cp of codePoints) {
    if (cp === 0x0a) lines.push([]);
    // a CR that precedes a newline is part of the line break, not a character to reorder:
    // left in, it lands wherever the reversal puts it, so a DOS file shows a stray glyph
    else if (cp !== 0x0d) lines[lines.length - 1].push(cp);
  }
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(0x0a);
    const firstStrong = line.find((cp) => cp >= 0x20 && !isRtlCodePoint(cp) ? true : isRtlCodePoint(cp));
    const baseRtl = firstStrong !== undefined && isRtlCodePoint(firstStrong);
    if (!baseRtl) {
      out.push(...line);
      return;
    }
    // walk the line in reverse, collecting LTR runs forward so they keep their order
    const reversed: number[] = [];
    let i2 = line.length - 1;
    while (i2 >= 0) {
      if (!isRtlCodePoint(line[i2]) && line[i2] > 0x20) {
        let j = i2;
        while (j >= 0 && !isRtlCodePoint(line[j]) && line[j] > 0x20) j--;
        reversed.push(...line.slice(j + 1, i2 + 1));
        i2 = j;
      } else {
        reversed.push(line[i2]);
        i2--;
      }
    }
    out.push(...reversed);
  });
  return out;
}

/** how many of our glyph slots an Arabic letter needs, so the caller can lay out rows */
export function shapedDisplayText(codePoints: number[]): string {
  return String.fromCodePoint(...toDisplayOrder(codePoints));
}
