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
static const unsigned char letter_join[] = {
  0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0,
};
static const unsigned char letter_forms[] = {
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
  switch (cp) {
    case 0x0621: return 0xC1;
    case 0x0622: return 0xC2;
    case 0x0623: return 0xC3;
    case 0x0624: return 0xC4;
    case 0x0625: return 0xC5;
    case 0x0626: return 0xC6;
    case 0x0627: return 0xC7;
    case 0x0628: return 0xC8;
    case 0x0629: return 0xC9;
    case 0x062A: return 0xCA;
    case 0x062B: return 0xCB;
    case 0x062C: return 0xCC;
    case 0x062D: return 0xCD;
    case 0x062E: return 0xCE;
    case 0x062F: return 0xCF;
    case 0x0630: return 0xD0;
    case 0x0631: return 0xD1;
    case 0x0632: return 0xD2;
    case 0x0633: return 0xD3;
    case 0x0634: return 0xD4;
    case 0x0635: return 0xD5;
    case 0x0636: return 0xD6;
    case 0x0637: return 0xD7;
    case 0x0638: return 0xD8;
    case 0x0639: return 0xD9;
    case 0x063A: return 0xDA;
    case 0x0640: return 0xE0;
    case 0x0641: return 0xE1;
    case 0x0642: return 0xE2;
    case 0x0643: return 0xE3;
    case 0x0644: return 0xE4;
    case 0x0645: return 0xE5;
    case 0x0646: return 0xE6;
    case 0x0647: return 0xE7;
    case 0x0648: return 0xE8;
    case 0x0649: return 0xE9;
    case 0x064A: return 0xEA;
    default: return 0;
  }
}
