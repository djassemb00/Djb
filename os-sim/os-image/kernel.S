/*
 * NovaDesk 1.0 — a bootable 16-bit x86 "PC desktop" for the NovaOS emulator.
 *
 * Not a UI mock-up: this is a real boot sector + kernel that runs on emulated
 * hardware. It programs VGA mode 13h, reads the PS/2 mouse through IRQ12,
 * draws windows with a software pixel framebuffer, and launches built-in
 * programs (text editor, paint, file browser, system monitor, DOS shell).
 *
 * Build:  ./build.sh   (GNU as, produces nova-desk.img — a 1.44MB floppy)
 */
.code16
.section .text
.globl _start
_start:
    ljmp $0, $start

/* ------------------------------------------------------------------ */
/*  load address 0x8000, sectors 1..16 are the kernel                  */
/* ------------------------------------------------------------------ */
start:
    cli
    xor %ax, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %ss
    mov $0x7c00, %sp
    sti

    /* keep our own boot drive so sub-loads could be added later */
    mov %dl, drv

    call serial_init
    call detect_hardware
    mov $msg_boot, %si
    call serial_puts

    /* 16 sectors off the floppy, right after the boot sector */
    mov $0x0201, %ax
    mov $16, %al
    mov $0x0800, %bx          /* 0x8000 >> 4 */
    mov %bx, %es
    xor %bx, %bx
    mov drv, %dl
    mov $0, %ch
    mov $2, %cl
    mov $0, %dh
    int $0x13
    jc  load_fail

    ljmp $0x8000, $0x0000

load_fail:
    mov $msg_fail, %si
    call serial_puts
    call serial_nl
halt70:
    hlt
    jmp halt70

/* ------------------------------------------------------------------ */
/*  kernel entry (loaded at 0x8000, i.e. CS:IP = 0x8000:0)             */
/* ------------------------------------------------------------------ */
.org 0x200
kmain:
    cli
    mov %cs, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %ss
    mov $0xffff, %sp
    sti
    call serial_init
    mov $msg_kernel, %si
    call serial_puts

    /* ---- real hardware init: VGA 320x200x256 ---- */
    call vga_setmode
    call mouse_install
    call pit_install
    call music_silence

    /* ---- framebuffer / window state ---- */
    call ui_boot

    /* ---- event loop ---- */
.event_loop:
    call clock_tick
    call music_step
    call ui_frame
    hlt
    jmp .event_loop

/* ================================================================== */
/*  VGA                                                                 */
/* ================================================================== */
vga_setmode:
    mov $0x13, %ax
    int $0x10
    /* linear 8-bit palette access */
    mov $0x3c8, %dx
    xor %al, %al
    out %al, %dx
    mov $0x3c9, %dx
    mov $bios_palette, %si
    mov $768, %cx
1:  lodsb
    out %al, %dx
    loop 1b
    /* VGA memory plane: A000:0000, we render via ES:DI */
    mov $0xa000, %ax
    mov %ax, %es
    ret

/* ================================================================== */
/*  serial debug console (COM1)                                        */
/* ================================================================== */
serial_init:
    push %ax
    push %dx
    mov $0x3fb, %dx
    mov $0x80, %al
    out %al, %dx
    mov $0x3f8, %dx
    mov $1, %al
    out %al, %dx
    mov $0x3f9, %dx
    xor %al, %al
    out %al, %dx
    mov $0x3fb, %dx
    mov $3, %al
    out %al, %dx
    mov $0x3fa, %dx
    mov $0xc7, %al
    out %al, %dx
    pop %dx
    pop %ax
    ret

serial_putc:
    push %ax
    push %dx
    mov $0x3fd, %dx
1:  in %dx, %al
    test $0x20, %al
    jz 1b
    mov $0x3f8, %dx
    mov %bl, %al
    out %al, %dx
    pop %dx
    pop %ax
    ret

serial_puts:
    push %ax
    push %bx
    push %si
1:  lodsb
    test %al, %al
    jz 2f
    mov %al, %bl
    call serial_putc
    jmp 1b
2:  pop %si
    pop %bx
    pop %ax
    ret

serial_nl:
    mov $0x0d, %bl
    call serial_putc
    mov $0x0a, %bl
    call serial_putc
    ret

/* ================================================================== */
/*  hardware probing — what the guest reports about the machine        */
/* ================================================================== */
detect_hardware:
    /* conventional memory from the BIOS data area */
    mov $0x413, %si
    mov %ds:(%si), %ax
    mov %ax, mem_kb
    /* video mode */
    mov $0x449, %si
    mov %ds:(%si), %al
    mov %al, video_mode
    /* equipment word: bit 0 = floppy present */
    mov $0x410, %si
    mov %ds:(%si), %ax
    mov %al, equip_lo
    ret

/* ================================================================== */
/*  mouse: PS/2, IRQ12 (vector 0x74)                                   */
/* ================================================================== */
mouse_install:
    push %ax
    push %bx
    push %es
    /* save old vector */
    mov $0x74*4, %bx
    mov %ds:(%bx), %ax
    mov %ax, old_mouse
    mov %ds:2(%bx), %ax
    mov %ax, old_mouse+2
    /* install ours */
    movw $mouse_isr, %ds:(%bx)
    mov %cs, %ax
    mov %ax, %ds:2(%bx)
    /* enable aux device + IRQ12 */
    call kbd_wait_in
    mov $0xa8, %al
    out %al, $0x64
    call kbd_wait_in
    mov $0x20, %al
    out %al, $0x64
    call kbd_wait_out
    in $0x60, %al
    or $0x02, %al
    mov %al, %bl
    call kbd_wait_in
    mov $0x60, %al
    out %al, $0x64
    call kbd_wait_in
    mov %bl, %al
    out %al, $0x60
    /* mouse: enable data reporting (0xF4) */
    mov $0xf4, %bl
    call mouse_cmd
    /* unmask IRQ12 and IRQ2 in the PIC */
    in $0x21, %al
    and $0xfb, %al
    out %al, $0x21
    in $0xa1, %al
    and $0xef, %al
    out %al, $0xa1
    sti
    pop %es
    pop %bx
    pop %ax
    ret

mouse_cmd:
    call kbd_wait_in
    mov $0xd4, %al
    out %al, $0x64
    call kbd_wait_in
    mov %bl, %al
    out %al, $0x60
    ret

kbd_wait_in:
    push %cx
    xor %cx, %cx
1:  in $0x64, %al
    test $0x02, %al
    jz 2f
    loop 1b
2:  pop %cx
    ret

kbd_wait_out:
    push %cx
    xor %cx, %cx
1:  in $0x64, %al
    test $0x01, %al
    jnz 2f
    loop 1b
2:  pop %cx
    ret

mouse_isr:
    push %ax
    push %dx
    in $0x60, %al
    mov mstate, %dl
    cmp $0, %dl
    je .byte0
    cmp $1, %dl
    je .byte1
    cmp $2, %dl
    je .byte2
.byte0:
    mov %al, mbyte0
    incb mstate
    jmp .eoi
.byte1:
    mov %al, mbyte1
    incb mstate
    jmp .eoi
.byte2:
    mov %al, mbyte2
    movb $0, mstate
    call mouse_process
.eoi:
    mov $0x20, %al
    out %al, $0xa0
    out %al, $0x20
    pop %dx
    pop %ax
    iret

mouse_process:
    /* dx: 9-bit signed from byte1+flags, dy from byte2 */
    mov mbyte1, %al
    movsbl %al, %eax
    mov mbyte0, %bl
    test $0x10, %bl
    jz 1f
    /* sign extend via 9th bit */
    sub $256, %eax
1:  mov %ax, tmpw
    /* acceleration: dx * 1 */
    mov tmpw, %ax
    add mouse_x, %ax
    cmp $0, %ax
    jge 2f
    xor %ax, %ax
2:  cmp $312, %ax
    jle 3f
    mov $312, %ax
3:  mov %ax, mouse_x

    mov mbyte2, %al
    movsbl %al, %eax
    mov mbyte0, %bl
    test $0x20, %bl
    jz 4f
    sub $256, %eax
4:  mov %ax, tmpw
    mov tmpw, %ax
    /* screen y is inverted relative to mouse */
    sub %ax, mouse_y
    cmp $0, %ax
    mov mouse_y, %ax
    cmp $0, %ax
    jge 5f
    xor %ax, %ax
    mov %ax, mouse_y
5:  cmp $192, %ax
    jle 6f
    movw $192, mouse_y
6:
    /* buttons: bit0 left, bit1 right */
    mov mbyte0, %al
    and $0x07, %al
    mov %al, mouse_btn
    ret

/* ================================================================== */
/*  PIT: 100 Hz system tick on IRQ0 (vector 0x20)                      */
/* ================================================================== */
pit_install:
    push %ax
    push %bx
    push %es
    mov $0x20*4, %bx
    mov %ds:(%bx), %ax
    mov %ax, old_timer
    mov %ds:2(%bx), %ax
    mov %ax, old_timer+2
    movw $timer_isr, %ds:(%bx)
    mov %cs, %ax
    mov %ax, %ds:2(%bx)
    /* 100 Hz */
    mov $0x43, %dx
    mov $0x36, %al
    out %al, %dx
    mov $0x40, %dx
    mov $0x9c, %al
    out %al, %dx
    mov $0x2e, %al
    out %al, %dx
    sti
    pop %es
    pop %bx
    pop %ax
    ret

timer_isr:
    incw ticks
    mov $0x20, %al
    out %al, $0x20
    iret

/* ================================================================== */
/*  tiny PC speaker "music engine" (Blue Danube, public domain)        */
/* ================================================================== */
music_silence:
    push %ax
    push %dx
    mov $0x61, %dx
    in %dx, %al
    and $0xfc, %al
    out %al, %dx
    pop %dx
    pop %ax
    ret

music_toggle:
    push %ax
    push %cx
    push %dx
    /* set PIT channel 2 frequency to BX */
    mov $0x43, %dx
    mov $0xb6, %al
    out %al, %dx
    mov $0x42, %dx
    mov %bl, %al
    out %al, %dx
    mov %bh, %al
    out %al, %dx
    pop %dx
    pop %cx
    pop %ax
    ret
