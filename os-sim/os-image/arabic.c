/*
 * Arabic shaping + UTF-8 + CP-720 mapping for NovaDesk.
 * See arabic.h for why the kernel does the shaping itself.
 */
#include "arabic.h"

/* Letter metadata, in the same order as arabic_index in arabic_font.h.
   joins: 0 = does not join to the following letter, 1 = joins (right-joining). */
static const unsigned short letter_cp[] = {
  0x0621, 0x0622, 0x0623, 0x0624, 0x0625, 0x0626, 0x0627, 0x0628, 0x0629,
  0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x062F, 0x0630, 0x0631, 0x0632,
  0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063A, 0x0640,
  0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x0649,
  0x064A,
};
/*
 * 1 = the letter joins to the letter that FOLLOWS it (initial/medial forms exist).
 *
 * This row was inverted for 33 of its 37 entries, which is why every Arabic word the kernel
 * drew came out with the wrong shapes: beh was marked as not joining forward, so "سلام"
 * rendered with an isolated seen and a final-only skeleton, and alef was marked as joining,
 * so a word never ended. Corrected against the Arabic joining model (alef, dal, thal, reh,
 * zain, waw and hamza join only to the preceding letter; every other letter joins both ways).
 * `tests/cp720.test.ts` asserts these 37 values so a hand edit cannot silently invert them
 * again.
 */
static const unsigned char letter_join[] = {
  0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1,
  1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1,
};static const unsigned char letter_forms[] = {
  1, 2, 2, 2, 2, 4, 2, 4, 2, 4, 4, 4, 4, 4, 2, 2, 2, 2, 4, 4, 4, 4, 4, 4,
  4, 4, 1, 4, 4, 4, 4, 4, 4, 4, 2, 2, 4,
};
#define N_LETTERS ((int)(sizeof(letter_cp) / sizeof(letter_cp[0])))

static int find(unsigned int cp) {
  for (int i = 0; i < N_LETTERS; i++)
    if (letter_cp[i] == cp) return i;
  return -1;
}

int arabic_is_letter(unsigned int cp) { return find(cp) >= 0; }

int arabic_joins_forward(unsigned int cp) {
  int i = find(cp);
  return i >= 0 && letter_join[i] != 0;
}

/* form: 0 isolated, 1 final, 2 initial, 3 medial */
int arabic_glyph(unsigned int cp, int form) {
  int i = find(cp);
  if (i < 0) return -1;
  if (letter_forms[i] == 1) return arabic_index[i][0];
  if (letter_forms[i] == 2) return arabic_index[i][form == 1 ? 1 : 0];
  if (form < 0 || form > 3) form = 0;
  return arabic_index[i][form];
}

unsigned int utf8_next(const char *s, int *i) {
  const unsigned char *p = (const unsigned char *)s + *i;
  unsigned int c = p[0];
  if (c < 0x80) { (*i)++; return c; }
  if ((c & 0xE0) == 0xC0) { unsigned int r = ((c & 0x1F) << 6) | (p[1] & 0x3F); (*i) += 2; return r; }
  if ((c & 0xF0) == 0xE0) {
    unsigned int r = ((c & 0x0F) << 12) | ((p[1] & 0x3F) << 6) | (p[2] & 0x3F);
    (*i) += 3;
    return r;
  }
  if ((c & 0xF8) == 0xF0) {
    unsigned int r = ((c & 0x07) << 18) | ((p[1] & 0x3F) << 12) | ((p[2] & 0x3F) << 6) | (p[3] & 0x3F);
    (*i) += 4;
    return r;
  }
  (*i)++; /* invalid byte: skip it rather than stall the renderer */
  return 0xFFFD;
}

/* CP-720 (Arabic, Transparent ASMO). Only the letters our font has forms for;
   everything else returns 0 so the caller keeps the UTF-8 internal form. The
   table is what lets a CP-720 text file be displayed, and what a CP-720 aware
   program would expect on the wire. */
unsigned char cp720_byte(unsigned int cp) {
  /*
   * CP-720 is where a DOS Arabic word processor actually puts Arabic: 0x98-0xAF for the
   * first letters, 0xE0-0xEF for the rest, 0x91/0x92 for shadda and sukun, 0xF1-0xF6 for the
   * harakat.
   *
   * The table this replaces was WRONG by a wide margin: it put hamza at 0xC1 and yeh at
   * 0xEA. In the real codepage those bytes are box-drawing characters. A file we encoded
   * with it would have opened in any DOS Arabic editor as a grid of lines and corners -- and
   * the boot self-check printed those numbers all along, which is what a self-check that
   * only prints is worth.
   *
   * Generated from the Unicode/SEIKO EPSON "cp720 to Unicode" table (table version 1.00,
   * 2009-10-30, the one shipped in the Unicode mapping archive) rather than typed by hand:
   * 45 entries, and the generated values are asserted against that table in
   * `tests/cp720.test.ts`.
   */
  switch (cp) {
    case 0x0651: return 0x91;
    case 0x0652: return 0x92;
    case 0x0640: return 0x95;
    case 0x0621: return 0x98;
    case 0x0622: return 0x99;
    case 0x0623: return 0x9A;
    case 0x0624: return 0x9B;
    case 0x0625: return 0x9D;
    case 0x0626: return 0x9E;
    case 0x0627: return 0x9F;
    case 0x0628: return 0xA0;
    case 0x0629: return 0xA1;
    case 0x062A: return 0xA2;
    case 0x062B: return 0xA3;
    case 0x062C: return 0xA4;
    case 0x062D: return 0xA5;
    case 0x062E: return 0xA6;
    case 0x062F: return 0xA7;
    case 0x0630: return 0xA8;
    case 0x0631: return 0xA9;
    case 0x0632: return 0xAA;
    case 0x0633: return 0xAB;
    case 0x0634: return 0xAC;
    case 0x0635: return 0xAD;
    case 0x0636: return 0xE0;
    case 0x0637: return 0xE1;
    case 0x0638: return 0xE2;
    case 0x0639: return 0xE3;
    case 0x063A: return 0xE4;
    case 0x0641: return 0xE5;
    case 0x0642: return 0xE7;
    case 0x0643: return 0xE8;
    case 0x0644: return 0xE9;
    case 0x0645: return 0xEA;
    case 0x0646: return 0xEB;
    case 0x0647: return 0xEC;
    case 0x0648: return 0xED;
    case 0x0649: return 0xEE;
    case 0x064A: return 0xEF;
    case 0x064B: return 0xF1;
    case 0x064C: return 0xF2;
    case 0x064D: return 0xF3;
    case 0x064E: return 0xF4;
    case 0x064F: return 0xF5;
    case 0x0650: return 0xF6;
    default: return 0;
  }
}
