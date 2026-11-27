import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { V86 } from 'v86';
import { buildFloppy } from '../src/system/fat12';

/**
 * PLAN ٥-١: an XMS driver that actually answers.
 *
 * PLAN.md claimed the bundled FreeDOS "supports HIMEM/EMM386 through CONFIG.SYS (present but
 * disabled)". Measured, both halves are false: the image's root directory holds eight entries
 * and no \FDOS, no HIMEM.EXE, no EMM386.EXE, and INT 2Fh AX=4300h answers AL=0x00 where an
 * installed driver answers 0x80. The 31 MB is real (INT 15h AH=88h: 0x7C00 KB); nothing gave
 * a program a handle to it.
 *
 * So `os-image/xms.S` is the driver, and this file boots the real FreeDOS floppy with it,
 * installs it, and asks it the same questions a program would.
 *
 * WHY THIS DOES NOT TEST Move: Move is written and returns success for every supported
 * combination, but a byte written through it does not appear where it should (AUDIT A98).
 * A test that asserted "Move returned success" would be a test that cannot fail in the way
 * that matters -- it would pass today and tell nobody anything. The driver's honesty about
 * its limits is what gets tested; its Move is documented as unproven until it is proven.
 */

const ROOT = new URL('../public/', import.meta.url).pathname;
const IMG = new Uint8Array(readFileSync(ROOT + 'images/freedos-boot.img'));
const at = (c: number, n: number) =>
  new Uint8Array(IMG.subarray(16896 + (c - 2) * 1024, 16896 + (c - 2) * 1024 + n));

/** assemble os-image/xms.S with the toolchain the repository actually has */
function buildDriver(): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'xms-'));
  const src = readFileSync(new URL('../os-image/xms.S', import.meta.url));
  writeFileSync(join(dir, 'xms.S'), src);
  execFileSync('as', ['--32', '-o', join(dir, 'xms.o'), join(dir, 'xms.S')]);
  execFileSync('ld', [
    '-m', 'elf_i386', '-Ttext=0x100', '--oformat', 'binary',
    '-o', join(dir, 'XMSTS.COM'), join(dir, 'xms.o'),
  ]);
  return new Uint8Array(readFileSync(join(dir, 'XMSTS.COM')));
}

/**
 * A client that asks the driver four questions and writes the answers to COM1, one per line.
 * Hand-written here (not a file) so the test carries its own evidence and cannot drift from a
 * binary someone forgot to rebuild.
 */
function buildClient(): Uint8Array {
  const d = mkdtempSync(join(tmpdir(), 'xmsq-'));
  writeFileSync(join(d, 'q.S'), `
        .code16
        .text
        .globl _start
_start:
        pushw   %cs
        popw    %ds
        pushw   %cs
        popw    %es

        /* installed? */
        movw    $0x4300, %ax
        int     $0x2f
        movb    %al, r0

        /* entry point, then version */
        movw    $0x4310, %ax
        int     $0x2f
        movw    %bx, api_off
        movw    %es, api_seg
        movb    $0x00, %ah
        lcall   *api_off
        movw    %ax, r1
        movw    %bx, r2

        /* free memory */
        movb    $0x08, %ah
        lcall   *api_off
        movw    %ax, r3

        /* allocate 64 KB */
        movb    $0x09, %ah
        movw    $64, %dx
        lcall   *api_off
        movw    %dx, r4
        movw    %bx, r5

        /* an unimplemented function must refuse, not fake success */
        movb    $0x77, %ah
        lcall   *api_off
        movw    %bx, r6

        /* report */
        movw    $m_inst, %dx
        call    puts
        movb    r0, %al
        call    hx8
        call    crlf
        movw    $m_ver, %dx
        call    puts
        movw    r1, %ax
        call    hx16
        call    crlf
        movw    $m_hma, %dx
        call    puts
        movw    r2, %ax
        call    hx16
        call    crlf
        movw    $m_free, %dx
        call    puts
        movw    r3, %ax
        call    hx16
        call    crlf
        movw    $m_alloc, %dx
        call    puts
        movw    r4, %ax
        call    hx16
        movw    $m_sl, %dx
        call    puts
        movw    r5, %ax
        call    hx16
        call    crlf
        movw    $m_bad, %dx
        call    puts
        movw    r6, %ax
        call    hx16
        call    crlf
        movw    $m_end, %dx
        call    puts
        movw    $0x4c00, %ax
        int     $0x21

/* all output goes to COM1: the screen scrolls, and a lost line is a lost measurement */
puts:   pushw   %si
        pushw   %ax
1:      movw    %dx, %si
        movb    (%si), %al
        testb   %al, %al
        jz      2f
        cmpb    $0x24, %al
        je      2f
        pushw   %dx
        call    putc
        popw    %dx
        incw    %dx
        jmp     1b
2:      popw    %ax
        popw    %si
        ret
putc:   pushw   %dx
        pushw   %ax
3:      movw    $0x3fd, %dx
        inb     (%dx), %al
        testb   $0x20, %al
        jz      3b
        popw    %ax
        movw    $0x3f8, %dx
        outb    %al, (%dx)
        popw    %dx
        ret
hx16:   pushw   %ax
        movb    %ah, %al
        call    hx8
        popw    %ax
        call    hx8
        ret
hx8:    pushw   %ax
        movb    %al, %bl
        shrb    $4, %al
        call    hxd
        movb    %bl, %al
        call    hxd
        popw    %ax
        ret
hxd:    andb    $0x0f, %al
        addb    $0x30, %al
        cmpb    $0x39, %al
        jbe     4f
        addb    $0x07, %al
4:      call    putc
        ret
crlf:   movw    $m_crlf, %dx
        call    puts
        ret

api_off:.word 0
api_seg:.word 0
r0:     .byte 0
r1:     .word 0
r2:     .word 0
r3:     .word 0
r4:     .word 0
r5:     .word 0
r6:     .word 0
m_inst: .asciz "INSTALLED=$"
m_ver:  .asciz "VERSION=$"
m_hma:  .asciz "HMA=$"
m_free: .asciz "FREEMB=$"
m_alloc:.asciz "ALLOC=$"
m_bad:  .asciz "BADFN=$"
m_sl:   .asciz "/$"
m_end:  .asciz "XMSQ-END$"
m_crlf: .asciz "\\r\\n$"
`);
  execFileSync('as', ['--32', '-o', join(d, 'q.o'), join(d, 'q.S')]);
  execFileSync('ld', [
    '-m', 'elf_i386', '-Ttext=0x100', '--oformat', 'binary',
    '-o', join(d, 'XMSQ.COM'), join(d, 'q.o'),
  ]);
  return new Uint8Array(readFileSync(join(d, 'XMSQ.COM')));
}

function bootAndRun(driver: Uint8Array, client: Uint8Array) {
  const disk = buildFloppy({
    name: 'XMSQ',
    ext: 'COM',
    data: client,
    extra: [
      { name: 'KERNEL.SYS', data: at(7, 45450) },
      { name: 'COMMAND.COM', data: at(56, 66090) },
      { name: 'CONFIG.SYS', data: at(125, 209) },
      { name: 'XMSTS.COM', data: driver },
    ],
    autoexec: '@ECHO OFF\r\nPROMPT $P$G\r\nXMSTS.COM\r\nXMSQ.COM\r\n',
    bootFrom: new Uint8Array(IMG),
  });
  return disk;
}

async function run(disk: Uint8Array): Promise<string> {
  const emu: any = new V86({
    wasm_path: ROOT + 'v86/v86.wasm',
    bios: { url: ROOT + 'roms/seabios.bin' },
    vga_bios: { url: ROOT + 'roms/vgabios.bin' },
    fda: { buffer: disk.buffer },
    memory_size: 32 * 1024 * 1024,
    autostart: true,
  });
  let serial = '';
  emu.add_listener('serial0-output-byte', (b: number) => {
    serial += String.fromCharCode(b & 0xff);
  });
  const t0 = Date.now();
  try {
    while (!/XMSQ-END/.test(serial) && Date.now() - t0 < 40_000) {
      await new Promise((r) => setTimeout(r, 150));
    }
  } finally {
    /* teardown must not depend on the loop having finished: an unfinished boot that throws
       here would leave a wasm instance running into the next test file */
    try {
      emu.destroy?.();
    } catch {
      /* already gone */
    }
  }
  return serial;
}

describe('٥-١ the XMS driver is present and answers', () => {
  it('installs on a real FreeDOS boot and reports 3.00 with 31 MB free', async () => {
    const serial = await run(bootAndRun(buildDriver(), buildClient()));
    const read = (k: string) => {
      const m = serial.match(new RegExp(k + '=([0-9A-F]+)'));
      return m ? parseInt(m[1], 16) : null;
    };

    // not installed, then installed: the two states the plan confused
    expect(read('INSTALLED'), 'INT 2Fh AX=4300h must report a resident driver').toBe(0x80);
    expect(read('VERSION'), 'XMS version').toBe(0x0300);
    // 0x7C00 KB above 1 MB; a driver that reports less is not handing out what is there
    expect(read('FREEMB')).toBe(0x7c00);
    expect(read('ALLOC'), 'first allocation must succeed').toBe(1);
    // HMA is reported absent because it is not implemented -- a program can then avoid it
    expect(read('HMA')).toBe(0);
    // an unknown function must say "not implemented", never a fabricated success
    expect(read('BADFN')).toBe(0x80);
  }, 90_000);

  it('does not install twice (two handlers would fight over INT 2Fh)', async () => {
    const driver = buildDriver();
    const disk = buildFloppy({
      name: 'XMSQ',
      ext: 'COM',
      data: buildClient(),
      extra: [
        { name: 'KERNEL.SYS', data: at(7, 45450) },
        { name: 'COMMAND.COM', data: at(56, 66090) },
        { name: 'CONFIG.SYS', data: at(125, 209) },
        { name: 'XMSTS.COM', data: driver },
      ],
      autoexec: '@ECHO OFF\r\nXMSTS.COM\r\nXMSTS.COM\r\nXMSQ.COM\r\n',
      bootFrom: new Uint8Array(IMG),
    });
    const serial = await run(disk);
    /*
     * The driver's "already installed" line goes to the SCREEN through DOS, not to COM1, so
     * the evidence here is the client's own question: with two install attempts, the INT 2Fh
     * entry point must still resolve to a working driver. A second handler layered on top
     * would answer the query but send the call to the wrong routine, and the version read
     * would come back wrong.
     */
    expect(serial).toMatch(/INSTALLED=80/);
    expect(serial).toMatch(/VERSION=0300/);
    expect(serial).toMatch(/XMSQ-END/);
  }, 90_000);
});
