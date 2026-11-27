/*
 * Arabic support for NovaDesk.
 *
 * Why this exists: the Arabic legacy codepages (DOS 720, 864, 862) store only
 * ISOLATED letter shapes. Real DOS-era Arabic software (and Windows 3.1's Arabic
 * support) supplied the joined forms itself, because the codepage cannot express
 * them. On top of that, Arabic is written right to left, so a naive left-to-right
 * renderer draws the sentence backwards and unjoined.
 *
 * So we do the two jobs the codepage leaves to us:
 *   1. shaping   - pick isolated / initial / medial / final form per letter
 *   2. bidi-lite - keep Arabic runs right to left, Latin runs left to right
 *
 * Source text arrives as UTF-8 (that is what a browser keyboard produces), and we
 * map it to our own glyph indices. No codepage is needed internally; CP-720 is a
 * compatibility target for text files, handled by cp720_index().
 */
#ifndef ARABIC_H
#define ARABIC_H

#include "arabic_font.h"

/* Letter classes after Arabic joining rules. */
#define JOIN_NONE 0  /* never joins to the following letter (right side) */
#define JOIN_RIGHT 1 /* joins only to the preceding letter: ا د ذ ر ز و */

/* Return the glyph index (0..ARABIC_GLYPHS-1) for a Unicode Arabic letter in a
   given joining form, or -1 when the letter is not in our table.
   form: 0 isolated, 1 initial, 2 medial, 3 final */
int arabic_glyph(unsigned int cp, int form);

/* Does this letter connect to the letter that follows it? */
int arabic_joins_forward(unsigned int cp);

/* UTF-8 decoding: returns the code point and advances *i past the sequence. */
unsigned int utf8_next(const char *s, int *i);

/* Map a Unicode code point to its CP-720 byte, or 0 when absent. */
unsigned char cp720_byte(unsigned int cp);

/* True when the code point is an Arabic letter we can shape. */
int arabic_is_letter(unsigned int cp);

#endif
