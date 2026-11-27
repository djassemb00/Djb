/* PONG — 16-bit real-mode DOS, text cells only, BIOS int 10h.
 * Public domain: written for this project. Player left paddle: W/S. Q quits.
 */
#define TICK_ADDR 0x046C
#define FW 68
#define FH 16
#define OX 6
#define OY 4

static void tty(char c) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0e00 | (unsigned char)c), "b"(0x0007) : "memory");
}
static void put(unsigned char row, unsigned char col, char c) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0200), "d"((unsigned short)((row << 8) | col)), "b"(0) : "memory");
  tty(c);
}
static void clear(void) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0600), "b"(0x0700), "c"(0), "d"(0x184f) : "memory");
  __asm__ __volatile__("int $0x10" : : "a"(0x0200), "d"(0), "b"(0) : "memory");
}
static int key_peek(void) {
  unsigned short ax;
  __asm__ __volatile__("int $0x16" : "=a"(ax) : "a"(0x0100) : "memory");
  return ax >> 8;
}
static int key_get(void) {
  unsigned short ax;
  __asm__ __volatile__("int $0x16" : "=a"(ax) : "a"(0x0000) : "memory");
  return (ax >> 8) ? 0x100 | (ax >> 8) : (ax & 0xff);
}
static unsigned long ticks(void) { return *(volatile unsigned long *)TICK_ADDR; }
static void print(const char *s) { while (*s) tty(*s++); }
static void num(int v) {
  char b[6]; int i = 0;
  if (!v) b[i++] = '0';
  while (v) { b[i++] = (char)('0' + v % 10); v /= 10; }
  while (i--) tty(b[i]);
}
static void exit_dos(void) {
  __asm__ __volatile__("movw $0x4c00, %%ax\n\tint $0x21" : : : "ax");
}

static int py, ay;           /* paddle tops */
static int bx, by, dx, dy;   /* ball */
static int ps, as;           /* scores */

static void draw_frame(void) {
  for (int x = 0; x <= FW + 1; x++) { put(OY - 1, OX + x, '='); put(OY + FH, OX + x, '='); }
  for (int y = 0; y < FH; y++) {
    put(OY + y, OX - 1, '|');
    put(OY + y, OX + FW, '|');
    if (y % 2 == 0) put(OY + y, OX + FW / 2, ':');
  }
}

static void paddle(int x, int top, char c) {
  for (int i = 0; i < 4; i++) put((unsigned char)(OY + top + i), (unsigned char)(OX + x), c);
}
static void score_line(void) {
  put(0, 26, 'P'); put(0, 27, 'O'); put(0, 28, 'N'); put(0, 29, 'G'); put(0, 30, ' ');
  put(0, 31, 'W'); put(0, 32, '/'); put(0, 33, 'S'); put(0, 34, ' ');
  put(0, 36, 'Y'); put(0, 37, 'O'); put(0, 38, 'U'); put(0, 39, ' '); put(0, 40, ':');
  put(0, 42, ' '); put(0, 43, ' ');
  put(0, 44, 'C'); put(0, 45, 'P'); put(0, 46, 'U'); put(0, 47, ' '); put(0, 48, ':');
  put(0, 50, ' '); put(0, 51, ' ');
}

static void update_score(void) {
  put(0, 41, (char)('0' + ps % 10));
  put(0, 49, (char)('0' + as % 10));
}

static void reset_ball(int to_left) {
  bx = FW / 2; by = FH / 2; dx = to_left ? -1 : 1; dy = (ps + as) & 1 ? 1 : -1;
}

__attribute__((section(".text.start"), noreturn)) void _start(void) {
  clear();
  draw_frame();
  score_line();
  py = FH / 2 - 2; ay = py;
  ps = as = 0;
  reset_ball(1);
  update_score();
  paddle(2, py, '#');
  paddle(FW - 3, ay, '#');
  put(OY + by, OX + bx, 'o');

  unsigned long last = ticks();
  for (;;) {
    int k = key_peek();
    if (k) {
      k = key_get();
      if (k == 'q' || k == 'Q') exit_dos();
      if (k == 'w' || k == 'W') { if (py > 0) { put(OY + py + 3, OX + 2, ' '); py--; paddle(2, py, '#'); } }
      if (k == 's' || k == 'S') { if (py < FH - 4) { put(OY + py, OX + 2, ' '); py++; paddle(2, py, '#'); } }
    }
    if (ticks() - last < 3) continue;
    last = ticks();
    /* CPU tracks the ball, one cell at a time */
    if (ay + 2 < by && ay < FH - 4) { put(OY + ay, OX + FW - 3, ' '); ay++; paddle(FW - 3, ay, '#'); }
    else if (ay + 1 > by && ay > 0) { put(OY + ay + 3, OX + FW - 3, ' '); ay--; paddle(FW - 3, ay, '#'); }

    put(OY + by, OX + bx, ' ');
    bx += dx; by += dy;
    if (by <= 0) { by = 0; dy = 1; }
    if (by >= FH - 1) { by = FH - 1; dy = -1; }
    if (bx == 3 && by >= py && by < py + 4) dx = 1;
    if (bx == FW - 4 && by >= ay && by < ay + 4) dx = -1;
    if (bx <= 0 || bx >= FW - 1) {
      if (bx <= 0) as++; else ps++;
      update_score();
      reset_ball(bx >= FW - 1);
    }
    put(OY + by, OX + bx, 'o');
    if (ps >= 10 || as >= 10) {
      put(FH + 2, OX, ' ');
      put(FH + 1, OX + 10, ps >= 10 ? 'Y' : 'C');
      put(FH + 1, OX + 11, 'O'); put(FH + 1, OX + 12, 'U'); put(FH + 1, OX + 13, ' ');
      put(FH + 1, OX + 14, 'W'); put(FH + 1, OX + 15, 'I'); put(FH + 1, OX + 16, 'N'); put(FH + 1, OX + 17, '!');
      put(FH + 1, OX + 18, ' ');
      for (;;) { int j = key_peek(); if (j) exit_dos(); }
    }
  }
}
