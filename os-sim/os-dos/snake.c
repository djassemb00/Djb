/* SNAKE — a 16-bit real-mode DOS game, built with gcc -m16 and BIOS calls only.
 * Public domain: we wrote it, so it ships with the app without any licence risk.
 * Controls: arrow keys, Q quits.
 */
#define TICK_ADDR 0x046C

#define W 38
#define H 18
#define OX 20
#define OY 3

static void bios_tty(char c) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0e00 | (unsigned char)c), "b"(0x0007) : "memory");
}
static void goto_rc(unsigned char row, unsigned char col) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0200), "d"((unsigned short)((row << 8) | col)), "b"(0) : "memory");
}
static void put_rc(unsigned char row, unsigned char col, char c) {
  goto_rc(row, col);
  bios_tty(c);
}
static void clear(void) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0600), "b"(0x0700), "c"(0), "d"(0x184f) : "memory");
}
static int key_peek(void) {
  unsigned short ax;
  __asm__ __volatile__("int $0x16" : "=a"(ax) : "a"(0x0100) : "memory");
  return (ax & 0xff00) ? (ax & 0xff) : 0;
}
static int key_get(void) {
  unsigned short ax;
  __asm__ __volatile__("int $0x16" : "=a"(ax) : "a"(0x0000) : "memory");
  return ax & 0xff ? ax & 0xff : 0x100 | (ax >> 8);
}
static unsigned long ticks(void) {
  return *(volatile unsigned long *)TICK_ADDR;
}
static unsigned int seed = 12345;
static unsigned int rnd(unsigned int n) {
  seed = seed * 1103515245u + 12345u;
  return (seed >> 16) % n;
}
static void print(const char *s) {
  while (*s) bios_tty(*s++);
}
static void num(unsigned int v) {
  char b[6];
  int i = 0;
  if (!v) b[i++] = '0';
  while (v) { b[i++] = (char)('0' + v % 10); v /= 10; }
  while (i--) bios_tty(b[i]);
}

static unsigned char body_x[220], body_y[220];
static int len;
static int dir; /* 0 up,1 right,2 down,3 left */
static int fx, fy;

static void draw_border(void) {
  for (int x = 0; x <= W + 1; x++) {
    put_rc(OY - 1, OX + x, '-');
    put_rc(OY + H, OX + x, '-');
  }
  for (int y = 0; y < H; y++) {
    put_rc(OY + y, OX - 1, '|');
    put_rc(OY + y, OX + W, '|');
  }
}

static void spawn_food(void) {
  int tries = 0;
  do {
    fx = (int)rnd(W);
    fy = (int)rnd(H);
  } while (++tries < 200 && fx < 2 && fy < 2);
  put_rc(OY + fy, OX + fx, '*');
}

static int collide(int x, int y) {
  for (int i = 0; i < len; i++)
    if (body_x[i] == x && body_y[i] == y) return 1;
  return 0;
}

__attribute__((section(".text.start"), noreturn)) void _start(void) {
  clear();
  goto_rc(1, 20);
  print("SNAKE  -  arrows to move, Q to quit");
  draw_border();
  len = 3;
  body_x[0] = 8; body_y[0] = 9;
  body_x[1] = 7; body_y[1] = 9;
  body_x[2] = 6; body_y[2] = 9;
  dir = 1;
  for (int i = 0; i < len; i++) put_rc(OY + body_y[i], OX + body_x[i], 'o');
  spawn_food();

  unsigned long last = ticks();
  for (;;) {
    int k = key_peek();
    if (k) {
      k = key_get();
      if (k == 'q' || k == 'Q') break;
      if (k == 0x148) dir = 0;      /* up    */
      else if (k == 0x14d) dir = 1; /* right */
      else if (k == 0x150) dir = 2; /* down  */
      else if (k == 0x14b) dir = 3; /* left  */
    }
    if (ticks() - last < 6) continue; /* ~6 ticks per step (18.2 Hz clock) */
    last = ticks();

    int hx = body_x[0], hy = body_y[0];
    if (dir == 0) hy--;
    else if (dir == 1) hx++;
    else if (dir == 2) hy++;
    else hx--;
    if (hx < 0 || hy < 0 || hx >= W || hy >= H) break;
    if (collide(hx, hy)) break;

    int ate = (hx == fx && hy == fy);
    if (!ate) {
      put_rc(OY + body_y[len - 1], OX + body_x[len - 1], ' ');
      for (int i = len - 1; i > 0; i--) {
        body_x[i] = body_x[i - 1];
        body_y[i] = body_y[i - 1];
      }
    } else {
      if (len < 219) {
        body_x[len] = body_x[len - 1];
        body_y[len] = body_y[len - 1];
        len++;
      }
      spawn_food();
      goto_rc(0, 55);
      print("score ");
      num((unsigned int)(len - 3) * 10);
    }
    body_x[0] = (unsigned char)hx;
    body_y[0] = (unsigned char)hy;
    for (int i = 0; i < len; i++) put_rc(OY + body_y[i], OX + body_x[i], 'o');
  }
  goto_rc(24, 0);
  print("GAME OVER - score ");
  num((unsigned int)(len - 3) * 10);
  print("  reboot to play again.");
  for (;;) __asm__ __volatile__("hlt");
}
