/* MENU — a tiny application drawer for DOS, written for this project (public domain).
 * Shows the bundled programs, waits for a key, and runs the chosen one with
 * DOS EXEC (int 21h AH=4Bh). Returning from the child brings the menu back.
 */
#define MENU_ROW 3

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
static void print(const char *s) { while (*s) tty(*s++); }
static int key_get(void) {
  unsigned short ax;
  __asm__ __volatile__("int $0x16" : "=a"(ax) : "a"(0x0000) : "memory");
  return ax & 0xff ? (int)(ax & 0xff) : 0x100 | (int)(ax >> 8);
}
static unsigned short my_ds(void) {
  unsigned short v;
  __asm__("movw %%ds, %0" : "=r"(v));
  return v;
}

/* DOS parameter block + command tail, both in our own segment */
static unsigned char tail[8] = { 0, '\r' };
static unsigned short pblock[5];

/* run "NAME.COM", return its exit code (or -1 if DOS refused) */
static int run(const char *name) {
  unsigned short ds = my_ds();
  pblock[0] = 0;                 /* inherit environment */
  pblock[1] = (unsigned short)(unsigned int)tail;
  pblock[2] = ds;
  pblock[3] = 0x005c;            /* default FCB1 at PSP:5C */
  pblock[4] = 0x005c;
  unsigned short rc = 0, fl = 0;
  __asm__ __volatile__(
      "int $0x21\n\t"
      "jc 1f\n\t"
      "xorw %%cx, %%cx\n\t"
      "jmp 2f\n"
      "1:\n\t"
      "movw $1, %%cx\n"
      "2:\n\t"
      : "=a"(rc), "=c"(fl)
      : "a"(0x4b00), "d"((unsigned short)(unsigned int)name), "b"((unsigned short)(unsigned int)pblock)
      : "memory");
  return fl ? -1 : 0;
}

static void goto_rc(unsigned char row, unsigned char col) {
  __asm__ __volatile__("int $0x10" : : "a"(0x0200), "d"((unsigned short)((row << 8) | col)), "b"(0) : "memory");
}
static void line(unsigned char row, unsigned char col, const char *str) {
  goto_rc(row, col);
  while (*str) tty(*str++);
}

static void draw_menu(void) {
  clear();
  line(1, 14, "N O V A   P C");
  line(2, 9, "applications only  -  no Windows");
  line(5, 4, "1  SNAKE");
  line(5, 14, "arrows to move, Q quits");
  line(7, 4, "2  PONG");
  line(7, 14, "W and S to move, Q quits");
  line(9, 4, "3  DOS command line");
  line(9, 26, "DIR, TYPE, CD ...");
  line(13, 4, "press 1, 2 or 3");
  line(15, 4, "every program here is real x86 code running on the emulated CPU");
}

static void exit_dos(void) {
  __asm__ __volatile__("movw $0x4c00, %%ax\n\tint $0x21" : : : "ax");
}

__attribute__((section(".text.start"), noreturn)) void _start(void) {
  for (;;) {
    draw_menu();
    int k = key_get();
    if (k == '1') { run("SNAKE.COM"); }
    else if (k == '2') { run("PONG.COM"); }
    else if (k == '3' || k == 13) { exit_dos(); }
    else if (k == 27) { exit_dos(); }
    else { put(MENU_ROW + 10, 20, '?'); }
  }
}
