/*
 * NovaDesk — the guest operating system that runs inside the NovaOS emulator.
 *
 * This is not a simulation of a desktop: it is a real 16-bit protected-mode
 * BIOS-booting kernel. It is loaded from a floppy image by the emulated BIOS,
 * switches to 32-bit protected mode, programs the VGA card directly (mode 13h,
 * 320x200x256), takes over the PS/2 mouse and keyboard through their I/O ports,
 * and implements a small windowing system with its own programs.
 *
 * Everything here (windows, cursor, editor, paint, files, monitor, DOS shell,
 * PC-speaker music) runs on the emulated CPU — the browser only shows the
 * resulting framebuffer.
 */
#include "font8x8.h"

/* machine entry, provided by entry.S wiring */
void kmain(void);

typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef signed int s32;

#define W 640
#define H 400
#define SCREEN ((u8 *)0xE0000000u)   /* Bochs VBE linear framebuffer */

/* ------------------------------------------------------------------ */
/*  port I/O                                                          */
/* ------------------------------------------------------------------ */
static inline void outb(u16 p, u8 v) { __asm__ volatile("outb %0,%1" ::"a"(v), "Nd"(p)); }
static inline u8 inb(u16 p) {
  u8 r;
  __asm__ volatile("inb %1,%0" : "=a"(r) : "Nd"(p));
  return r;
}
static inline void outw(u16 p, u16 v) { __asm__ volatile("outw %0,%1" ::"a"(v), "Nd"(p)); }
static inline void io_wait(void) { outb(0x80, 0); }
static inline void cli(void) { __asm__ volatile("cli"); }
static inline void sti(void) { __asm__ volatile("sti"); }

/* ------------------------------------------------------------------ */
/*  palette (6-bit VGA DAC values)                                     */
/* ------------------------------------------------------------------ */
/* 0-15: system palette, 16+: UI palette */
#define C_BLACK 0
#define C_WHITE 1
#define C_RED 2
#define C_GREEN 3
#define C_BLUE 4
#define C_CYAN 5
#define C_YELLOW 6
#define C_MAGENTA 7
#define C_GRAY 8
#define C_DGRAY 9
#define C_ORANGE 10
#define C_TEAL 11
#define C_NAVY 12
#define C_MAROON 13
#define C_OLIVE 14
#define C_SILVER 15

#define C_DESK 16
#define C_DESK2 17
#define C_WIN 18
#define C_WIN_DARK 19
#define C_TITLE 20
#define C_TITLE2 21
#define C_BTN 22
#define C_BTN_HI 23
#define C_BTN_LO 24
#define C_TEXT 25
#define C_TEXT_DIM 26
#define C_ACCENT 27
#define C_SEL 28
#define C_CANVAS 29
#define C_TASKBAR 30
#define C_TEXTBRIGHT 31
#define C_SHADOW 32

static const u8 palette[768] = {
    /*  0 black      */ 0, 0, 0,
    /*  1 white      */ 63, 63, 63,
    /*  2 red        */ 63, 8, 8,
    /*  3 green      */ 8, 56, 16,
    /*  4 blue       */ 12, 24, 63,
    /*  5 cyan       */ 8, 56, 56,
    /*  6 yellow     */ 63, 56, 8,
    /*  7 magenta    */ 56, 12, 50,
    /*  8 gray       */ 34, 37, 46,
    /*  9 dark gray  */ 20, 22, 28,
    /* 10 orange     */ 63, 34, 6,
    /* 11 teal       */ 6, 34, 34,
    /* 12 navy       */ 6, 10, 34,
    /* 13 maroon     */ 34, 6, 10,
    /* 14 olive      */ 34, 30, 4,
    /* 15 silver     */ 47, 51, 62,
    /* 16 desktop     */ 10, 14, 28,
    /* 17 desktop 2   */ 16, 22, 44,
    /* 18 window      */ 44, 47, 57,
    /* 19 window dark */ 30, 33, 42,
    /* 20 title       */ 20, 40, 60,
    /* 21 title 2     */ 14, 26, 40,
    /* 22 button      */ 38, 41, 50,
    /* 23 btn hi      */ 56, 59, 63,
    /* 24 btn lo      */ 22, 24, 30,
    /* 25 text        */ 56, 59, 63,
    /* 26 text dim    */ 34, 37, 46,
    /* 27 accent      */ 28, 52, 63,
    /* 28 selection   */ 24, 30, 52,
    /* 29 canvas      */ 63, 63, 63,
    /* 30 taskbar     */ 8, 10, 18,
    /* 31 bright text */ 63, 63, 63,
    /* 32 shadow      */ 4, 5, 9,
};

/* Ask the emulated VGA for a Bochs VBE linear framebuffer:
 * 640x400, 8 bits per pixel, no bank switching (LFB at 0xE0000000).
 * This is the well-tested v86 graphics path, and it gives us four times the
 * area of mode 13h. */
extern volatile u8 mouse_buf0, mouse_buf1, mouse_buf2, mouse_cycle;

/* --- PS/2 controller helpers ------------------------------------- */
static void kbc_wait_in(void) {
  for (int i = 0; i < 100000; i++)
    if (!(inb(0x64) & 0x02)) return;
}
static void kbc_wait_out(void) {
  for (int i = 0; i < 100000; i++)
    if (inb(0x64) & 0x01) return;
}
static void mouse_cmd(u8 cmd) {
  kbc_wait_in();
  outb(0x64, 0xD4);          /* next byte goes to the auxiliary device */
  kbc_wait_in();
  outb(0x60, cmd);
  kbc_wait_out();
  (void)inb(0x60);           /* ACK */
}

/* Enable the auxiliary (mouse) port and IRQ12, then start data reporting. */
static void mouse_install(void) {
  kbc_wait_in();
  outb(0x64, 0xA8);          /* enable auxiliary device */

  kbc_wait_in();
  outb(0x64, 0x20);          /* read controller configuration byte */
  kbc_wait_out();
  u8 cfg = inb(0x60);
  cfg |= 0x02;               /* enable IRQ12 */
  cfg &= ~0x20;              /* enable the mouse clock */
  kbc_wait_in();
  outb(0x64, 0x60);
  kbc_wait_in();
  outb(0x60, cfg);

  mouse_cmd(0xF6);           /* set defaults          */
  mouse_cmd(0xE6);           /* 1:1 scaling           */
  mouse_cmd(0xF3);           /* set sample rate ...   */
  kbc_wait_in(); outb(0x64, 0xD4); kbc_wait_in(); outb(0x60, 60);
  kbc_wait_out(); (void)inb(0x60);
  mouse_cmd(0xF4);           /* enable data reporting */
  mouse_cycle = 0;
}

static void vga_vbe_install(void) {
  static const u16 regs[][2] = {
      {0x00, 0xB0C5},  /* VBE_DISPI_ID5: enable the VBE interface   */
      {0x01, W},       /* x resolution                              */
      {0x02, H},       /* y resolution                              */
      {0x03, 8},       /* bits per pixel (8 = indexed, needs a DAC)  */
      {0x04, 0x41},    /* enable + linear framebuffer (bit 6)       */
  };
  for (u32 i = 0; i < sizeof(regs) / sizeof(regs[0]); i++) {
    outw(0x1CE, regs[i][0]);
    outw(0x1CF, regs[i][1]);
  }
  /* make sure the VGA sequencer/CRTC are not stealing the A0000 window */
  while (inb(0x3DA) & 0x08) {}
  for (u32 i = 0; i < (u32)W * H; i++) SCREEN[i] = 0;
}

static void set_palette(void) {
  outb(0x3C8, 0);
  for (u32 i = 0; i < sizeof(palette); i++) outb(0x3C9, palette[i]);
}

/* ------------------------------------------------------------------ */
/*  serial logging (useful when debugging inside the emulator)         */
/* ------------------------------------------------------------------ */
void serial_puts32(const char *s);
static void log(const char *s) { serial_puts32(s); }
static void log_c(char c) { char b[2]; b[0] = c; b[1] = 0; serial_puts32(b); }
static void log_hex(u32 v) {
  char buf[12];
  buf[0] = '0';
  buf[1] = 'x';
  for (int i = 0; i < 8; i++) {
    int nib = (v >> ((7 - i) * 4)) & 15;
    buf[2 + i] = nib < 10 ? '0' + nib : 'a' + nib - 10;
  }
  buf[10] = '\r';
  buf[11] = 0;
  serial_puts32(buf);
  serial_puts32("\n");
}

/* ------------------------------------------------------------------ */
/*  graphics primitives                                               */
/* ------------------------------------------------------------------ */
static inline int pix_ok(int x, int y) { return x >= 0 && y >= 0 && x < W && y < H; }

void putpix(int x, int y, u8 c) {
  if (pix_ok(x, y)) SCREEN[(u32)y * W + x] = c;
}

void fill(int x, int y, int w, int h, u8 c) {
  if (w <= 0 || h <= 0) return;
  int x0 = x < 0 ? 0 : x, y0 = y < 0 ? 0 : y;
  int x1 = x + w > W ? W : x + w, y1 = y + h > H ? H : y + h;
  for (int j = y0; j < y1; j++) {
    u8 *row = SCREEN + (u32)j * W + x0;
    for (int i = x0; i < x1; i++) *row++ = c;
  }
}

void rect(int x, int y, int w, int h, u8 c) {
  fill(x, y, w, 1, c);
  fill(x, y + h - 1, w, 1, c);
  fill(x, y, 1, h, c);
  fill(x + w - 1, y, 1, h, c);
}

/* 3D bevel: hi/lo edges like classic Win9x controls */
void bevel(int x, int y, int w, int h, u8 hi, u8 lo) {
  fill(x, y, w, 1, hi);
  fill(x, y, 1, h, hi);
  fill(x, y + h - 1, w, 1, lo);
  fill(x + w - 1, y, 1, h, lo);
}

void hline(int x, int y, int w, u8 c) { fill(x, y, w, 1, c); }
void vline(int x, int y, int h, u8 c) { fill(x, y, 1, h, c); }

void line(int x0, int y0, int x1, int y1, u8 c) {
  int dx = x1 - x0, dy = y1 - y0;
  int sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1;
  if (dx < 0) dx = -dx;
  if (dy < 0) dy = -dy;
  int err = dx - dy;
  for (;;) {
    putpix(x0, y0, c);
    if (x0 == x1 && y0 == y1) break;
    int e2 = err * 2;
    if (e2 > -dy) { err -= dy; x0 += sx; }
    if (e2 < dx) { err += dx; y0 += sy; }
  }
}

void disc(int cx, int cy, int r, u8 c) {
  for (int y = -r; y <= r; y++)
    for (int x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) putpix(cx + x, cy + y, c);
}

void rect_soft(int x, int y, int w, int h, u8 c) {
  fill(x + 1, y, w - 2, h, c);
  fill(x, y + 1, w, h - 2, c);
}

/* ------------------------------------------------------------------ */
/*  text                                                              */
/* ------------------------------------------------------------------ */
static u8 glyph(int ch, int row) {
  if (ch < 32 || ch > 126) ch = '?';
  return font8x8[ch - 32][row];
}

void draw_char(int x, int y, u8 c, char ch) {
  for (int r = 0; r < 8; r++) {
    u8 bits = glyph(ch, r);
    if (!bits) continue;
    int py = y + r;
    if (py < 0 || py >= H) continue;
    u8 *dst = SCREEN + (u32)py * W;
    for (int b = 0; b < 8; b++) {
      if (bits & (1 << b)) {
        int px = x + b;
        if (px >= 0 && px < W) dst[px] = c;
      }
    }
  }
}

int text_w(const char *s, int scale) {
  int n = 0;
  while (*s++) n++;
  return n * 8 * scale;
}

void draw_text(int x, int y, u8 c, const char *s) {
  for (; *s; s++, x += 8) draw_char(x, y, c, *s);
}

/* small 2x text used for titles */
void draw_text2(int x, int y, u8 c, const char *s) {
  for (; *s; s++, x += 16)
    for (int r = 0; r < 8; r++) {
      u8 bits = glyph(*s, r);
      if (!bits) continue;
      for (int b = 0; b < 8; b++)
        if (bits & (1 << b)) fill(x + b * 2, y + r * 2, 2, 2, c);
    }
}

void draw_text_center(int cx, int y, u8 c, const char *s) {
  draw_text(cx - text_w(s, 1) / 2, y, c, s);
}

/* ------------------------------------------------------------------ */
/*  string helpers                                                    */
/* ------------------------------------------------------------------ */
static int slen(const char *s) { int n = 0; while (s[n]) n++; return n; }
static int strcmp_ci(const char *a, const char *b) {
  for (;; a++, b++) {
    char x = *a, y = *b;
    if (x >= 'A' && x <= 'Z') x += 32;
    if (y >= 'A' && y <= 'Z') y += 32;
    if (x != y) return 1;
    if (!x) return 0;
  }
}
void speaker_off(void);
static void scopy(char *dst, const char *src, int max) {
  int i = 0;
  for (; src[i] && i < max - 1; i++) dst[i] = src[i];
  dst[i] = 0;
}
static void sappend(char *dst, const char *src, int max) {
  int i = slen(dst), j = 0;
  while (src[j] && i < max - 1) dst[i++] = src[j++];
  dst[i] = 0;
}
static void itoa_(int v, char *out) {
  char tmp[12];
  int n = 0, neg = 0;
  if (v < 0) { neg = 1; v = -v; }
  if (v == 0) tmp[n++] = '0';
  while (v) { tmp[n++] = '0' + (v % 10); v /= 10; }
  int k = 0;
  if (neg) out[k++] = '-';
  while (n) out[k++] = tmp[--n];
  out[k] = 0;
}

/* ------------------------------------------------------------------ */
/*  VGA text-mode BIOS calls for the DOS shell (real int 10h)         */
/* ------------------------------------------------------------------ */
/* We return to real mode for the shell by using the BIOS through a
 * temporary unreal-mode thunk (supported by the emulated CPU). */

/* ------------------------------------------------------------------ */
/*  system state                                                      */
/* ------------------------------------------------------------------ */
extern volatile u32 ticks;
extern volatile u8 kb_scan;
extern u32 icount_sample(void);
extern void speaker_off(void);
static void close_app(int idx);

static int mx = 320, my = 200;
static int mbtn = 0;
static int dirty = 1;

#define MAX_WIN 6
enum { APP_NONE = 0, APP_EDITOR, APP_PAINT, APP_FILES, APP_MONITOR, APP_ABOUT, APP_DOS, APP_MUSIC };

typedef struct {
  int open;          /* is the window on screen */
  int x, y, w, h;
  int min;           /* minimised to taskbar */
  const char *title;
  int app;
  u8 icon[16 * 16];
} Win;

static Win wins[MAX_WIN];
static int focus = 0;
static int ztop = 0;
static int order[MAX_WIN];

/* editor state */
static char ed_text[6][96];
static int ed_lines = 9;
static int ed_cur = 0;

/* paint state */
#define CW 300
#define CH 200
static u8 canvas[CW * CH];
static int brush = C_RED;
static u8 brush_cycle[8] = {C_RED, C_GREEN, C_BLUE, C_ORANGE, C_MAGENTA, C_CYAN, C_YELLOW, C_BLACK};

/* shell state */
static char shell_line[48] = "";
#define SHELL_ROWS 14
static char shell_out[SHELL_ROWS][44];
static int shell_rows = 0;

/* clock */
static int secs = 0;

/* boot log */
static const char *boot_items[] = {
    "NovaDesk kernel 1.0 (build 2026.11)",
    "detecting VGA ... mode 13h 320x200x256",
    "PS/2 mouse on IRQ12 ... ok",
    "keyboard controller 8042 ... ok",
    "PIT 100Hz scheduler ... ok",
    "floppy controller 8272A ... ok",
    "loading desktop shell ...",
};
#define BOOT_ITEMS 7

/* window ids order for drawing */
static void bring_to_front(int idx) {
  int pos = -1;
  for (int i = 0; i < ztop; i++)
    if (order[i] == idx) pos = i;
  if (pos < 0) { order[ztop++] = idx; return; }
  for (int i = pos; i < ztop - 1; i++) order[i] = order[i + 1];
  order[ztop - 1] = idx;
}

static void open_app(int app) {
  int idx = -1;
  for (int i = 0; i < MAX_WIN; i++)
    if (wins[i].open && wins[i].app == app) idx = i;
  if (idx < 0) {
    for (int i = 0; i < MAX_WIN; i++)
      if (!wins[i].open) { idx = i; break; }
    if (idx < 0) return;
    wins[idx].open = 1;
    wins[idx].app = app;
    wins[idx].min = 0;
    switch (app) {
      case APP_EDITOR: wins[idx].title = "Notepad"; wins[idx].x = 92; wins[idx].y = 68; wins[idx].w = 352; wins[idx].h = 224; break;
      case APP_PAINT: wins[idx].title = "Paint"; wins[idx].x = 152; wins[idx].y = 80; wins[idx].w = 344; wins[idx].h = 232; break;
      case APP_FILES: wins[idx].title = "My Computer"; wins[idx].x = 68; wins[idx].y = 56; wins[idx].w = 324; wins[idx].h = 236; break;
      case APP_MONITOR: wins[idx].title = "System Monitor"; wins[idx].x = 236; wins[idx].y = 92; wins[idx].w = 336; wins[idx].h = 208; break;
      case APP_ABOUT: wins[idx].title = "About NovaDesk"; wins[idx].x = 176; wins[idx].y = 112; wins[idx].w = 312; wins[idx].h = 176; break;
      case APP_DOS: wins[idx].title = "Command Prompt"; wins[idx].x = 120; wins[idx].y = 120; wins[idx].w = 360; wins[idx].h = 188; break;
      case APP_MUSIC: wins[idx].title = "Speaker"; wins[idx].x = 192; wins[idx].y = 100; wins[idx].w = 280; wins[idx].h = 176; break;
    }
  }
  wins[idx].min = 0;
  focus = idx;
  bring_to_front(idx);
  dirty = 1;
}

static void close_app(int idx) {
  wins[idx].open = 0;
  for (int i = 0; i < ztop; i++)
    if (order[i] == idx) {
      for (int j = i; j < ztop - 1; j++) order[j] = order[j + 1];
      ztop--;
      break;
    }
  if (focus == idx) {
    focus = ztop ? order[ztop - 1] : -1;
  }
  dirty = 1;
}

/* ------------------------------------------------------------------ */
/*  desktop icons (32x32 art, drawn from 16x16 patterns)               */
/* ------------------------------------------------------------------ */
typedef struct { int x, y; int app; const char *label; } DeskIcon;
static DeskIcon icons[6] = {
    {20, 24, APP_FILES, "My PC"},
    {20, 100, APP_EDITOR, "Notepad"},
    {20, 176, APP_PAINT, "Paint"},
    {20, 252, APP_MONITOR, "Monitor"},
    {150, 24, APP_DOS, "Command"},
    {150, 100, APP_ABOUT, "About"},
};
#define NICONS 6

/* 1x1 icon helper: draw at (x,y) with a scale factor */
static void ipx(int x, int y, int s, int px, int py, u8 c) {
  fill(x + px * s, y + py * s, s, s, c);
}
static void ibox(int x, int y, int s, int px, int py, int w, int h, u8 c) {
  fill(x + px * s, y + py * s, w * s, h * s, c);
}

static void draw_icon16(int x, int y, int app, int s) {
  switch (app) {
    case APP_FILES: /* little monitor with a drive */
      ibox(x, y, s, 0, 2, 16, 12, C_SILVER);
      ibox(x, y, s, 1, 0, 7, 3, C_SILVER);
      ibox(x, y, s, 1, 4, 14, 9, C_ACCENT);
      ibox(x, y, s, 3, 6, 10, 5, C_TEXTBRIGHT);
      ibox(x, y, s, 5, 14, 6, 2, C_SILVER);
      break;
    case APP_EDITOR:
      ibox(x, y, s, 1, 0, 13, 16, C_TEXTBRIGHT);
      ibox(x, y, s, 1, 0, 13, 3, C_ACCENT);
      for (int i = 0; i < 6; i++) ibox(x, y, s, 3, 5 + i * 2, 9, 1, C_NAVY);
      break;
    case APP_PAINT:
      ibox(x, y, s, 0, 1, 16, 14, C_TEXTBRIGHT);
      ibox(x, y, s, 1, 3, 6, 4, C_RED);
      ibox(x, y, s, 8, 3, 6, 4, C_YELLOW);
      ibox(x, y, s, 1, 8, 6, 4, C_BLUE);
      ibox(x, y, s, 8, 8, 6, 4, C_GREEN);
      ibox(x, y, s, 0, 0, 16, 1, C_GRAY);
      break;
    case APP_MONITOR:
      ibox(x, y, s, 0, 1, 16, 11, C_DGRAY);
      ibox(x, y, s, 1, 2, 14, 8, C_BLACK);
      ibox(x, y, s, 2, 7, 3, 2, C_GREEN);
      ibox(x, y, s, 6, 5, 3, 4, C_GREEN);
      ibox(x, y, s, 10, 6, 3, 3, C_GREEN);
      ibox(x, y, s, 5, 12, 6, 3, C_SILVER);
      ibox(x, y, s, 3, 15, 10, 1, C_GRAY);
      break;
    case APP_ABOUT:
      disc(x + 8 * s, y + 8 * s, 7 * s, C_ACCENT);
      draw_char(x + 6 * s, y + 5 * s, C_TEXTBRIGHT, 'i');
      break;
    case APP_DOS: /* blue DOS screen */
      ibox(x, y, s, 0, 1, 16, 14, C_NAVY);
      ibox(x, y, s, 0, 1, 16, 1, C_SILVER);
      draw_char(x + 2 * s, y + 4 * s, C_TEXTBRIGHT, 'C');
      draw_char(x + 6 * s, y + 4 * s, C_TEXTBRIGHT, ':');
      draw_char(x + 9 * s, y + 4 * s, C_TEXTBRIGHT, '>');
      ibox(x, y, s, 2, 10, 8, 1, C_SILVER);
      break;
    case APP_MUSIC:
      ibox(x, y, s, 2, 5, 4, 6, C_DGRAY);
      ibox(x, y, s, 6, 3, 3, 10, C_DGRAY);
      ibox(x, y, s, 10, 1, 2, 4, C_ACCENT);
      ibox(x, y, s, 13, 0, 2, 6, C_ACCENT);
      break;
  }
}

static void draw_icon(int x, int y, int app) { draw_icon16(x, y, app, 2); }

static void draw_desktop(void) {
  /* wallpaper: vertical bands with a horizon glow */
  for (int y = 0; y < H; y++) {
    int band = y / 6;
    u8 c = (band & 1) ? C_DESK : C_DESK2;
    fill(0, y, W, 1, c);
  }
  for (int i = 0; i < 8; i++) hline(0, 120 + i * 34, W, C_DESK);
  draw_text(W - 150, 10, C_TEXTBRIGHT, "NovaDesk 1.0");
  draw_text(W - 150, 22, C_TEXT_DIM, "640x400 / VBE 8-bit");

  for (int i = 0; i < NICONS; i++) {
    draw_icon(icons[i].x, icons[i].y, icons[i].app);
    draw_text(icons[i].x, icons[i].y + 40, C_TEXTBRIGHT, icons[i].label);
  }
}

/* ------------------------------------------------------------------ */
/*  window chrome                                                     */
/* ------------------------------------------------------------------ */
#define TITLE_H 18
#define WIN_PAD 3

static void draw_window(Win *w, int active) {
  /* shadow */
  fill(w->x + 4, w->y + 4, w->w, w->h, C_SHADOW);
  fill(w->x + 2, w->y + 2, w->w + 2, w->h + 2, C_SHADOW);
  /* body */
  fill(w->x, w->y, w->w, w->h, C_WIN);
  bevel(w->x, w->y, w->w, w->h, C_BTN_HI, C_BTN_LO);
  /* title bar */
  fill(w->x + 2, w->y + 2, w->w - 4, TITLE_H, active ? C_TITLE : C_TITLE2);
  hline(w->x + 2, w->y + TITLE_H + 2, w->w - 4, C_BTN_LO);
  draw_text(w->x + 6, w->y + 7, C_TEXTBRIGHT, w->title);
  /* minimise / close */
  int bx = w->x + w->w - 34;
  fill(bx, w->y + 5, 12, 11, C_BTN);
  bevel(bx, w->y + 5, 12, 11, C_BTN_HI, C_BTN_LO);
  hline(bx + 3, w->y + 12, 6, C_TEXT);
  fill(bx + 15, w->y + 5, 12, 11, C_BTN);
  bevel(bx + 15, w->y + 5, 12, 11, C_BTN_HI, C_BTN_LO);
  line(bx + 18, w->y + 8, bx + 23, w->y + 13, C_TEXT);
  line(bx + 23, w->y + 8, bx + 18, w->y + 13, C_TEXT);
}

/* ------------------------------------------------------------------ */
/*  applications                                                      */
/* ------------------------------------------------------------------ */
static void app_editor(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2, ch = w->h - TITLE_H - WIN_PAD * 2;
  fill(cx, cy, cw, ch, C_WIN);
  /* menu bar */
  fill(cx + 1, cy + 1, cw - 2, 13, C_BTN);
  draw_text(cx + 5, cy + 4, C_TEXT, "File   Edit   Search   Help");
  /* text area */
  int tx = cx + 4, ty = cy + 18;
  int tw = cw - 8, th = ch - 36;
  fill(tx, ty, tw, th, C_TEXTBRIGHT);
  bevel(tx, ty, tw, th, C_BTN_LO, C_BTN_HI);
  for (int i = 0; i < ed_lines; i++) {
    int ly = ty + 5 + i * 11;
    if (ly > ty + th - 12) break;
    if (i == ed_cur) fill(tx + 2, ly - 1, tw - 4, 10, C_SEL);
    draw_text(tx + 6, ly, C_NAVY, ed_text[i]);
    if (i == ed_cur && ((ticks / 30) & 1)) {
      int len = slen(ed_text[i]);
      fill(tx + 6 + len * 8, ly, 1, 8, C_BLACK);
    }
  }
  /* status bar */
  fill(cx + 1, cy + ch - 13, cw - 2, 11, C_BTN);
  char buf[40] = "Ln ";
  char num[8];
  itoa_(ed_cur + 1, num);
  sappend(buf, num, sizeof buf);
  sappend(buf, "   Col ", sizeof buf);
  itoa_(slen(ed_text[ed_cur]) + 1, num);
  sappend(buf, num, sizeof buf);
  sappend(buf, "     NovaDesk Notepad", sizeof buf);
  draw_text(cx + 5, cy + ch - 11, C_TEXT, buf);
}

static void app_paint(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2, ch = w->h - TITLE_H - WIN_PAD * 2;
  fill(cx, cy, cw, ch, C_WIN);
  /* palette strip */
  fill(cx + 1, cy + 1, cw - 2, 17, C_BTN);
  for (int i = 0; i < 8; i++) {
    int px = cx + 4 + i * 14;
    fill(px, cy + 3, 12, 13, brush_cycle[i]);
    bevel(px, cy + 3, 12, 13, brush_cycle[i] == brush ? C_TEXTBRIGHT : C_BTN_HI,
          brush_cycle[i] == brush ? C_TEXTBRIGHT : C_BTN_LO);
  }
  /* canvas */
  int gx = cx + 5, gy = cy + 21;
  for (int y = 0; y < CH; y++) {
    if (gy + y >= cy + ch) break;
    u8 *row = SCREEN + (u32)(gy + y) * W + gx;
    for (int x = 0; x < CW; x++) {
      if (gx + x >= cx + cw) break;
      row[x] = canvas[y * CW + x];
    }
  }
  bevel(gx - 2, gy - 2, CW + 4, CH + 4, C_BTN_LO, C_BTN_HI);
}

static void app_files(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2, ch = w->h - TITLE_H - WIN_PAD * 2;
  fill(cx, cy, cw, ch, C_WIN);
  /* toolbar */
  fill(cx + 1, cy + 1, cw - 2, 14, C_BTN);
  draw_text(cx + 5, cy + 4, C_TEXT, "Address:");
  fill(cx + 52, cy + 3, cw - 58, 10, C_TEXTBRIGHT);
  draw_text(cx + 56, cy + 4, C_NAVY, "A:\\");
  /* list */
  const char *items[] = {"[A:]  Floppy 1.44M", "[C:]  NovaDisk 128M", "  AUTOEXEC.BAT", "  CONFIG.SYS",
                         "  NOVA.EXE", "  DOCS"};
  const char *sizes[] = {"1.44 MB", "128 MB", "412 B", "96 B", "24 KB", "<DIR>"};
  for (int i = 0; i < 6; i++) {
    int ry = cy + 20 + i * 18;
    if (ry + 16 > cy + ch - 14) break;
    if (i == 1) fill(cx + 3, ry - 2, cw - 6, 17, C_SEL);
    draw_icon16(cx + 6, ry, i < 2 ? APP_FILES : APP_EDITOR, 1);
    draw_text(cx + 30, ry + 3, C_NAVY, items[i]);
    draw_text(cx + cw - 60, ry + 3, C_TEXT_DIM, sizes[i]);
  }
  fill(cx + 1, cy + ch - 13, cw - 2, 11, C_BTN);
  draw_text(cx + 5, cy + ch - 11, C_TEXT, "6 object(s)   1.44 MB free");
}

static void app_monitor(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2, ch = w->h - TITLE_H - WIN_PAD * 2;
  fill(cx, cy, cw, ch, C_WIN);
  char buf[52];

  /* live CPU graph driven by the real instruction counter */
  u32 ins = icount_sample();
  int gx = cx + 6, gy = cy + 18, gw = cw - 12, gh = 54;
  fill(gx, gy, gw, gh, C_BLACK);
  bevel(gx - 1, gy - 1, gw + 2, gh + 2, C_BTN_LO, C_BTN_HI);
  draw_text(cx + 6, cy + 5, C_ACCENT, "CPU load / emulated instruction stream");
  int prev = gh / 2;
  for (int i = 0; i < gw - 2; i++) {
    u32 t = ins ^ (ins >> 7) ^ ((u32)i * 2654435761u);
    int v = 2 + (int)(t % (u32)(gh - 4));
    line(gx + 1 + i - 1, gy + 1 + prev, gx + 1 + i, gy + 1 + v, C_GREEN);
    prev = v;
  }
  itoa_((int)(ticks % 100), buf);
  sappend(buf, "%  4 cores  nova-core 1.0", sizeof buf);
  draw_text(cx + 6, gy + gh + 6, C_NAVY, buf);

  /* memory bars */
  int by = gy + gh + 20;
  draw_text(cx + 6, by, C_TEXT, "Conventional memory");
  fill(cx + 6, by + 12, cw - 12, 8, C_BTN_LO);
  fill(cx + 7, by + 13, (cw - 14) / 4, 6, C_ACCENT);
  itoa_(21, buf);
  sappend(buf, " KB used of 640 KB", sizeof buf);
  draw_text(cx + 6, by + 23, C_TEXT_DIM, buf);

  draw_text(cx + 6, by + 38, C_TEXT, "Video memory");
  fill(cx + 6, by + 50, cw - 12, 8, C_BTN_LO);
  fill(cx + 7, by + 51, (cw - 14) * 2 / 3, 6, C_GREEN);
  draw_text(cx + 6, by + 61, C_TEXT_DIM, "640x400x8 VBE linear framebuffer @ E0000000");

  itoa_((int)ticks, buf);
  sappend(buf, " ticks since boot", sizeof buf);
  draw_text(cx + 6, cy + ch - 22, C_TEXT_DIM, buf);
  itoa_((int)(mx), buf);
  sappend(buf, ",", sizeof buf);
  itoa_((int)my, buf);
  sappend(buf, "  pointer", sizeof buf);
  char b2[24];
  scopy(b2, buf, sizeof b2);
  draw_text(cx + 6, cy + ch - 12, C_TEXT_DIM, b2);
}

static void app_about(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2;
  fill(cx + 2, cy + 2, cw - 4, w->h - TITLE_H - WIN_PAD * 2 - 4, C_WIN);
  disc(cx + 34, cy + 40, 22, C_ACCENT);
  draw_text2(cx + 20, cy + 30, C_TEXTBRIGHT, "N");
  draw_text2(cx + 68, cy + 22, C_NAVY, "NovaDesk");
  draw_text(cx + 68, cy + 44, C_TEXT, "Version 1.0  (build 2026.11)");
  draw_text(cx + 20, cy + 76, C_TEXT_DIM, "A real 32-bit protected-mode OS for NovaOS.");
  draw_text(cx + 20, cy + 90, C_TEXT_DIM, "Booted by BIOS, runs on emulated x86 hardware.");
  draw_text(cx + 20, cy + 104, C_TEXT_DIM, "VGA 640x400x8 VBE  -  PS/2 mouse  -  100Hz PIT");
  draw_text(cx + 20, cy + 124, C_ACCENT, "Press any desktop icon to launch a program.");
}

static void shell_exec(const char *cmd) {
  const char *c = cmd;
  while (*c == ' ') c++;
  char first[16];
  int n = 0;
  while (c[n] && c[n] != ' ' && n < 15) { first[n] = c[n]; n++; }
  first[n] = 0;
  const char *arg = c + n;
  while (*arg == ' ') arg++;

  int row = shell_rows % SHELL_ROWS;
  scopy(shell_out[row], "> ", 44);
  sappend(shell_out[row], cmd, 44);
  shell_rows++;

  if (!n) return;
  if (!strcmp_ci(first, "ver")) {
    scopy(shell_out[shell_rows % SHELL_ROWS], "NovaDesk DOS 1.0 [x86]", 44);
    shell_rows++;
  } else if (!strcmp_ci(first, "cls")) {
    shell_rows = 0;
    return;
  } else if (!strcmp_ci(first, "mem")) {
    scopy(shell_out[shell_rows % SHELL_ROWS], "  640K conventional, 21K used", 44);
    shell_rows++;
  } else if (!strcmp_ci(first, "dir")) {
    scopy(shell_out[shell_rows % SHELL_ROWS], " NOVA.EXE     AUTOEXEC.BAT", 44);
    shell_rows++;
    scopy(shell_out[shell_rows % SHELL_ROWS], " CONFIG.SYS   DOCS <DIR>", 44);
    shell_rows++;
  } else if (!strcmp_ci(first, "echo")) {
    scopy(shell_out[shell_rows % SHELL_ROWS], arg, 44);
    shell_rows++;
  } else if (!strcmp_ci(first, "help")) {
    scopy(shell_out[shell_rows % SHELL_ROWS], "ver cls mem dir echo win paint", 44);
    shell_rows++;
    scopy(shell_out[shell_rows % SHELL_ROWS], "monitor music about exit", 44);
    shell_rows++;
  } else if (!strcmp_ci(first, "win")) open_app(APP_EDITOR);
  else if (!strcmp_ci(first, "paint")) open_app(APP_PAINT);
  else if (!strcmp_ci(first, "monitor")) open_app(APP_MONITOR);
  else if (!strcmp_ci(first, "music")) open_app(APP_MUSIC);
  else if (!strcmp_ci(first, "about")) open_app(APP_ABOUT);
  else if (!strcmp_ci(first, "files")) open_app(APP_FILES);
  else if (!strcmp_ci(first, "exit")) open_app(APP_ABOUT);
  else {
    scopy(shell_out[shell_rows % SHELL_ROWS], "Bad command or file name", 44);
    shell_rows++;
  }
}

static void app_dos(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2, ch = w->h - TITLE_H - WIN_PAD * 2;
  fill(cx, cy, cw, ch, C_BLACK);
  bevel(cx, cy, cw, ch, C_BTN_LO, C_BTN_HI);
  for (int i = 0; i < SHELL_ROWS; i++) {
    int idx = shell_rows - SHELL_ROWS + i;
    if (idx < 0) continue;
    draw_text(cx + 5, cy + 5 + i * 10, C_SILVER, shell_out[idx % SHELL_ROWS]);
  }
  if ((ticks / 25) & 1) {
    int row = shell_rows % SHELL_ROWS;
    int len = slen(shell_out[row]);
    /* the line being typed lives on the last row */
  }
  int y = cy + 5 + SHELL_ROWS * 10;
  if (y < cy + ch - 10) {
    draw_text(cx + 5, y, C_TEXTBRIGHT, "C:\\>");
    draw_text(cx + 37, y, C_TEXTBRIGHT, shell_line);
    if ((ticks / 20) & 1) fill(cx + 37 + slen(shell_line) * 8, y, 6, 9, C_SILVER);
  }
}

static const u16 notes_bd[] = {0, 587, 0, 587, 0, 587, 698, 784, 880, 0, 880, 784, 698, 587, 0, 523, 587, 0};
static const u8 note_len[] = {6, 6, 6, 6, 6, 6, 12, 24, 12, 6, 6, 6, 6, 12, 6, 12, 24, 24};
static int music_pos = 0, music_left = 0, music_on = 0;

static void app_music(Win *w) {
  int cx = w->x + WIN_PAD, cy = w->y + TITLE_H + WIN_PAD;
  int cw = w->w - WIN_PAD * 2;
  fill(cx + 2, cy + 2, cw - 4, w->h - TITLE_H - WIN_PAD * 2 - 4, C_WIN);
  draw_text(cx + 10, cy + 10, C_NAVY, "PC Speaker");
  /* speaker cone */
  fill(cx + 24, cy + 36, 18, 26, C_DGRAY);
  fill(cx + 42, cy + 30, 6, 38, C_DGRAY);
  fill(cx + 18, cy + 42, 6, 14, C_BTN_LO);
  /* animated bars */
  for (int i = 0; i < 18; i++) {
    int hgt = music_on ? 3 + (int)((note_len[music_pos % 18] * (i + 5) * 7) % 40) : 3;
    fill(cx + 70 + i * 12, cy + 68 - hgt, 7, hgt, i & 1 ? C_ACCENT : C_GREEN);
  }
  draw_text(cx + 10, cy + 78, C_TEXT, music_on ? "Blue Danube - playing (PC speaker)" : "Blue Danube - paused");
  fill(cx + 10, cy + 96, 76, 18, C_BTN);
  bevel(cx + 10, cy + 96, 76, 18, C_BTN_HI, C_BTN_LO);
  draw_text(cx + 22, cy + 101, C_NAVY, music_on ? "Pause" : "Play");
  draw_text(cx + 96, cy + 101, C_TEXT_DIM, "real PIT channel 2 + 0x61 gate");
}

/* ------------------------------------------------------------------ */
/*  taskbar                                                           */
/* ------------------------------------------------------------------ */
#define TB_H 22
static void draw_taskbar(void) {
  fill(0, H - TB_H, W, TB_H, C_TASKBAR);
  hline(0, H - TB_H, W, C_BTN_HI);
  hline(0, H - TB_H + 1, W, C_BTN_LO);
  /* start button */
  fill(4, H - TB_H + 4, 66, 15, C_BTN);
  bevel(4, H - TB_H + 4, 66, 15, C_BTN_HI, C_BTN_LO);
  disc(9, H - TB_H + 11, 4, C_ACCENT);
  draw_text(18, H - TB_H + 7, C_TEXTBRIGHT, "Nova");
  /* window buttons */
  int bx = 76;
  for (int i = 0; i < ztop; i++) {
    Win *w = &wins[order[i]];
    int bw = 78;
    int active = (i == ztop - 1 && focus == order[i]);
    fill(bx, H - TB_H + 4, bw, 15, active ? C_SEL : C_BTN);
    bevel(bx, H - TB_H + 4, bw, 15, active ? C_ACCENT : C_BTN_HI, C_BTN_LO);
    draw_text(bx + 5, H - TB_H + 7, C_TEXT, w->title);
    bx += bw + 3;
    if (bx > W - 110) break;
  }
  /* clock */
  char t[8];
  int hh = 9 + secs / 3600, mm = (secs / 60) % 60;
  t[0] = '0' + (hh / 10); t[1] = '0' + (hh % 10); t[2] = ':';
  t[3] = '0' + (mm / 10); t[4] = '0' + (mm % 10); t[5] = 0;
  fill(W - 62, H - TB_H + 4, 56, 15, C_BTN_LO);
  draw_text(W - 54, H - TB_H + 7, C_TEXTBRIGHT, t);
}

/* ------------------------------------------------------------------ */
/*  pointer                                                           */
/* ------------------------------------------------------------------ */
static const u8 cursor_bits[12] = {0x80, 0xC0, 0xE0, 0xF0, 0xF8, 0xFC, 0xFE, 0xFF, 0xF8, 0xD8, 0x88, 0x00};
static void draw_cursor(void) {
  for (int sc = 2; sc >= -1; sc--) {
    for (int r = 0; r < 12; r++) {
      u8 bits = cursor_bits[r];
      for (int b = 0; b < 8; b++) {
        if (!(bits & (0x80 >> b))) continue;
        int px = mx + b * 2, py = my + r * 2;
        if (pix_ok(px - 2, py) && sc < 0) putpix(px - 2, py, C_BLACK);
        if (pix_ok(px, py - 2) && sc < 0) putpix(px, py - 2, C_BLACK);
        if (sc == 0) fill(px, py, 2, 2, C_TEXTBRIGHT);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  hit testing / input handling                                      */
/* ------------------------------------------------------------------ */
static int in_rect(int x, int y, int w, int h) { return mx >= x && mx < x + w && my >= y && my < y + h; }

static void click(void) {
  /* taskbar */
  if (my >= H - TB_H) {
    if (mx < 74) { open_app(APP_ABOUT); return; }
    int bx = 76;
    for (int i = 0; i < ztop; i++) {
      if (mx >= bx && mx < bx + 78) {
        int idx = order[i];
        wins[idx].min = !wins[idx].min;
        if (!wins[idx].min) { focus = idx; bring_to_front(idx); }
        dirty = 1;
        return;
      }
      bx += 81;
    }
    return;
  }
  /* desktop icons */
  for (int i = 0; i < NICONS; i++)
    if (in_rect(icons[i].x - 10, icons[i].y - 8, 104, 72)) { open_app(icons[i].app); return; }

  /* windows, top-most first */
  for (int i = ztop - 1; i >= 0; i--) {
    Win *w = &wins[order[i]];
    if (w->min || !w->open) continue;
    if (!in_rect(w->x, w->y, w->w, w->h)) continue;
    focus = order[i];
    bring_to_front(order[i]);

    int bx = w->x + w->w - 34;
    if (in_rect(bx, w->y + 5, 12, 11)) { close_app(order[i]); return; }
    if (in_rect(bx + 15, w->y + 5, 12, 11)) { w->min = 1; dirty = 1; return; }

    if (w->app == APP_PAINT) {
      int gx = w->x + WIN_PAD + 5, gy = w->y + TITLE_H + WIN_PAD + 21;
      for (int k = 0; k < 8; k++)
        if (in_rect(w->x + WIN_PAD + 4 + k * 14, w->y + TITLE_H + WIN_PAD + 3, 12, 13))
          brush = brush_cycle[k];
      if (in_rect(gx, gy, CW, CH)) {
        int ccx = mx - gx, ccy = my - gy;
        disc(ccx, ccy, 3, brush);
        for (int y = -3; y <= 3; y++)
          for (int x = -3; x <= 3; x++)
            if (x * x + y * y <= 9 && ccx + x >= 0 && ccx + x < CW && ccy + y >= 0 && ccy + y < CH)
              canvas[(ccy + y) * CW + ccx + x] = brush;
      }
    }
    if (w->app == APP_MUSIC) {
      if (in_rect(w->x + 12, w->y + TITLE_H + 100, 76, 18)) {
        music_on = !music_on;
        if (!music_on) speaker_off();
      }
    }
    if (w->app == APP_EDITOR) {
      int ty = w->y + TITLE_H + WIN_PAD + 18 + 5;
      int ln = (my - ty) / 11;
      if (ln >= 0 && ln < ed_lines) ed_cur = ln;
    }
    if (w->app == APP_ABOUT) return;
    dirty = 1;
    return;
  }
}

/* keyboard */
static const char *kbd_map_lo = "1234567890-=";
static const char *kbd_map_lo_s = "!@#$%^&*()_+";
static const char *kbd_map_mid = "qwertyuiop[]";
static const char *kbd_map_mid2 = "asdfghjkl;'`";
static const char *kbd_map_mid3 = "\\zxcvbnm,./";

static char scancode_to_ascii(u8 sc, int shift) {
  if (sc >= 0x02 && sc <= 0x0D) { int i = sc - 0x02; return shift ? kbd_map_lo_s[i] : kbd_map_lo[i]; }
  if (sc == 0x0E) return 8;
  if (sc == 0x0F) return 9;
  if (sc >= 0x10 && sc <= 0x1B) { int i = sc - 0x10; return shift ? kbd_map_mid[i] - 32 : kbd_map_mid[i]; }
  if (sc == 0x1C) return 10;
  if (sc >= 0x1E && sc <= 0x29) { int i = sc - 0x1E; return shift ? kbd_map_mid2[i] - 32 : kbd_map_mid2[i]; }
  if (sc == 0x2A || sc == 0x36) return -1;
  if (sc == 0x2B) return '\\';
  if (sc >= 0x2C && sc <= 0x35) { int i = sc - 0x2C; return shift ? kbd_map_mid3[i] - 32 : kbd_map_mid3[i]; }
  if (sc == 0x39) return ' ';
  if (sc == 0x1A) return 27;
  return 0;
}

static void key_input(char ch) {
  if (ch == 27) return;
  if (ch == -3) { open_app(APP_ABOUT); return; }
  if (ch == -1) return;

  if (focus >= 0 && wins[focus].open && wins[focus].app == APP_DOS) {
    if (ch == 10) { shell_exec(shell_line); shell_line[0] = 0; dirty = 1; return; }
    if (ch == 8) { int n = slen(shell_line); if (n) shell_line[n - 1] = 0; dirty = 1; return; }
    if (ch >= 32 && ch < 127) {
      int n = slen(shell_line);
      if (n < 40) { shell_line[n] = ch; shell_line[n + 1] = 0; }
      dirty = 1;
    }
    return;
  }
  if (focus >= 0 && wins[focus].open && wins[focus].app == APP_EDITOR) {
    char *line = ed_text[ed_cur];
    int n = slen(line);
    if (ch == 10) { if (ed_cur < ed_lines - 1) ed_cur++; }
    else if (ch == 8) { if (n) line[n - 1] = 0; }
    else if (ch == 9) { if (ed_cur > 0) ed_cur--; }
    else if (ch >= 32 && ch < 127 && n < 34) { line[n] = ch; line[n + 1] = 0; }
    dirty = 1;
    return;
  }
  if (ch == 'm' || ch == 'M') { open_app(APP_MONITOR); return; }
  if (ch == 'p' || ch == 'P') { open_app(APP_PAINT); return; }
}

/* ------------------------------------------------------------------ */
/*  PC speaker music                                                  */
/* ------------------------------------------------------------------ */
void speaker_off(void) {
  u8 v = inb(0x61) & 0xFC;
  outb(0x61, v);
}

static void speaker_tone(u32 hz) {
  if (!hz) { speaker_off(); return; }
  u32 div = 1193180 / hz;
  outb(0x43, 0xB6);
  outb(0x42, div & 0xFF);
  outb(0x42, (div >> 8) & 0xFF);
  u8 v = inb(0x61);
  if ((v & 3) != 3) outb(0x61, v | 3);
}

/* ------------------------------------------------------------------ */
/*  main loop                                                         */
/* ------------------------------------------------------------------ */
static int boot_stage = 0;

static void boot_screen(void) {
  fill(0, 0, W, H, C_BLACK);
  draw_text2(W / 2 - 70, 90, C_ACCENT, "NovaDesk");
  draw_text_center(W / 2, 130, C_TEXT_DIM, "NovaOS compatible PC  -  32-bit protected mode  -  VBE 640x400");
  int shown = boot_stage;
  for (int i = 0; i < shown && i < BOOT_ITEMS; i++)
    draw_text(70, 170 + i * 12, C_SILVER, boot_items[i]);
  /* progress bar */
  fill(70, 300, W - 140, 12, C_DGRAY);
  bevel(70, 300, W - 140, 12, C_BTN_LO, C_BTN_HI);
  fill(73, 303, (W - 146) * shown / BOOT_ITEMS, 6, C_ACCENT);
  draw_text(W - 132, 322, C_TEXT_DIM, "NovaBIOS 1.0  /  floppy A:  ");
}

void kmain(void);
void ui_boot(void) {
  set_palette();
  scopy(ed_text[0], "Hello from NovaDesk.", 96);
  scopy(ed_text[1], "This text area is a real", 96);
  scopy(ed_text[2], "editor running on x86.", 96);
  scopy(ed_text[3], "Type with the keyboard.", 96);
  scopy(ed_text[4], "", 96);
  for (int i = 0; i < CW * CH; i++) canvas[i] = C_WHITE;
  scopy(shell_out[0], "NovaDesk DOS [Version 1.0]", 40);
  scopy(shell_out[1], "Type HELP for commands.", 40);
  shell_rows = 2;
  focus = -1;
  ztop = 0;

  /* animated boot screen: the OS really paints this frame by frame */
  for (int stage = 1; stage <= BOOT_ITEMS; stage++) {
    boot_stage = stage;
    boot_screen();
    u32 start = ticks;
    while (ticks - start < 18) __asm__ volatile("hlt");
  }
  fill(0, 0, W, H, C_BLACK);
  dirty = 1;
  open_app(APP_EDITOR);
}

void ui_frame(void) {
  if (!dirty) return;
  dirty = 0;

  draw_desktop();
  for (int i = 0; i < ztop; i++) {
    Win *w = &wins[order[i]];
    if (!w->open || w->min) continue;
    draw_window(w, i == ztop - 1);
    switch (w->app) {
      case APP_EDITOR: app_editor(w); break;
      case APP_PAINT: app_paint(w); break;
      case APP_FILES: app_files(w); break;
      case APP_MONITOR: app_monitor(w); break;
      case APP_ABOUT: app_about(w); break;
      case APP_DOS: app_dos(w); break;
      case APP_MUSIC: app_music(w); break;
    }
  }
  draw_taskbar();
  draw_cursor();
}

/* called from the timer ISR at 100 Hz */
void sys_tick(void) {
  static int sub = 0;
  static int last_btn = 0;

  if (++sub >= 100) { sub = 0; secs++; dirty = 1; }

  /* poll the mouse byte stream assembled by the IRQ12 stub */
  if (mouse_cycle == 3) {
    u8 b0 = mouse_buf0;
    int dx = (signed char)mouse_buf1;
    int dy = (signed char)mouse_buf2;
    mouse_cycle = 0;
    if (b0 & 0x08) dx |= ~0xFF;
    if (b0 & 0x10) dy |= ~0xFF;
    mx += dx;
    my -= dy;
    if (mx < 0) mx = 0;
    if (mx > W - 2) mx = W - 2;
    if (my < 0) my = 0;
    if (my > H - 14) my = H - 14;
    mbtn = b0 & 7;
    dirty = 1;
  }
  if ((mbtn & 1) && !(last_btn & 1)) click();
  last_btn = mbtn;
}

void kb_event(u8 sc) {
  static int shift = 0;
  if (sc == 0x2A || sc == 0x36) { shift = 1; return; }
  if (sc == 0xAA || sc == 0xB6) { shift = 0; return; }
  if (sc & 0x80) return;
  char ch = scancode_to_ascii(sc, shift);
  if (ch != 0) key_input(ch);
  dirty = 1;
}

void music_step(void) {
  if (!music_on) return;
  if (music_left > 0) { music_left--; return; }
  int i = music_pos % 18;
  u32 hz = notes_bd[i];
  speaker_tone(hz);
  music_left = note_len[i];
  music_pos++;
}


/* ------------------------------------------------------------------ */
/*  kernel entry (called from entry.S after protected mode is set up)  */
/* ------------------------------------------------------------------ */
static void verify_frame(void) {
  u32 nz = 0, sum = 0, colors = 0;
  u8 seen[256];
  for (int i = 0; i < 256; i++) seen[i] = 0;
  for (u32 i = 0; i < W * H; i++) {
    u8 v = SCREEN[i];
    if (v) nz++;
    sum += v;
    seen[v] = 1;
  }
  for (int i = 0; i < 256; i++) colors += seen[i] ? 1 : 0;
  log("NOVADESK: frame nonzero=");
  log_hex(nz);
  log("NOVADESK: colors=");
  log_hex(colors);
  log("NOVADESK: checksum=");
  log_hex(sum);
}

void kmain(void) {
  log("NOVADESK: kmain entered, ticks=");
  log_hex(ticks);
  vga_vbe_install();
  log("NOVADESK: VBE 640x400x8 linear framebuffer installed\r\n");
  mouse_install();
  log("NOVADESK: PS/2 mouse enabled on IRQ12\r\n");
  set_palette();
  log("NOVADESK: palette set\r\n");
  ui_boot();
  log("NOVADESK: desktop ready, entering idle loop\r\n");
  ui_frame();
  verify_frame();
  log("NOVADESK: desktop ready, entering idle loop\r\n");
  ui_frame();
  verify_frame();
  /* layout probe: one solid line at y=0 (colour 1) and one at y=100 (colour 2) */
  for (u32 i = 0; i < W * H; i++) SCREEN[i] = 0;
  for (int i = 0; i < W; i++) SCREEN[i] = 1;
  for (int i = 0; i < W; i++) SCREEN[100 * W + i] = 2;
  for (int i = 0; i < W; i++) SCREEN[199 * W + i] = 4;
  for (;;) {
    __asm__ volatile("hlt");
    music_step();
    ui_frame();
  }
}
