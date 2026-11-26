/*
 * NovaDesk boot sector.
 *
 * The BIOS loads sector 0 of the floppy at 0000:7C00. We read the kernel
 * (sectors 1..KERNEL_SECTORS, honouring the 18 sectors/track geometry of a
 * 1.44MB floppy), enable A20, load a flat GDT, switch the CPU to 32-bit
 * protected mode and jump to the kernel at 0x10000.
 */
.ifndef KERNEL_SECTORS
.set KERNEL_SECTORS, 96
.endif
/* most BIOSes read at most 64K per int 13h call: 32 sectors * 512 = 16K */
.set CHUNK_MAX, 32

.code16
.section .text
.globl _start
_start:
    ljmp $0, $boot

boot:
    cli
    xor %ax, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %ss
    mov $0x7c00, %sp
    sti
    mov %dl, boot_drive

    call serial_init
    mov $msg_load, %si
    call serial_puts

    /* ---- load the kernel to 0x10000, track by track ----
     * int 13h wants: AH=02, AL=count, CH=track, CL=sector, DH=head,
     *                DL=drive, ES:BX=buffer
     */
    mov $0x1000, %ax
    mov %ax, %es                    /* buffer segment */
    xor %bx, %bx                    /* buffer offset (wraps within 64K) */
    mov $0, %ch                     /* track */
    mov $2, %cl                     /* sector */
    mov $0, %dh                     /* head */
    mov $KERNEL_SECTORS, %di        /* total sectors to read */
.read_loop:
    test %di, %di
    jz .loaded

    mov $19, %al
    sub %cl, %al                    /* sectors left on this track */
    and $0xff, %ax
    cmp %di, %ax
    jbe 1f
    mov %di, %ax
1:  cmp $CHUNK_MAX, %ax
    jbe 2f
    mov $CHUNK_MAX, %ax
2:  mov %al, sec_count

    mov sec_count, %al
    mov boot_drive, %dl
    movb $0x02, %ah
    int $0x13
    jc .fail

    /* buf += count*512 (16-bit wrap inside the segment is fine) */
    movzbl sec_count, %eax
    shl $9, %eax
    add %ax, %bx

    /* left -= count ; sector += count */
    movzbl sec_count, %eax
    sub %ax, %di
    add %al, %cl
    cmp $19, %cl
    jb .read_loop
    mov $1, %cl
    inc %dh
    cmp $2, %dh
    jb .read_loop
    mov $0, %dh
    inc %ch
    jmp .read_loop

.loaded:
    mov $msg_ok, %si
    call serial_puts

    /* ---- A20 ---- */
    in $0x92, %al
    or $0x02, %al
    and $0xfe, %al
    out %al, $0x92

    /* ---- VGA: 320x200x256 via the VGA BIOS, while we are still in real mode ---- */
    mov $0x13, %ax
    int $0x10

    /* ---- protected mode ---- */
    lgdt gdt_desc
    mov %cr0, %eax
    or $1, %eax
    mov %eax, %cr0
    .byte 0x66, 0xEA
    .long 0x00010000
    .word 0x0008

.fail:
    mov $msg_err, %si
    call serial_puts
1:  hlt
    jmp 1b

/* ---- serial (COM1) ---- */
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

boot_drive: .byte 0
sec_count:  .byte 0
msg_load:   .asciz "NovaBIOS: loading NovaDesk kernel\r\n"
msg_ok:     .asciz "NovaBIOS: entering protected mode\r\n"
msg_err:    .asciz "NovaBIOS: disk read error\r\n"

.align 8
gdt:
    .quad 0
    .quad 0x00CF9A000000FFFF
    .quad 0x00CF92000000FFFF
gdt_desc:
    .word gdt_desc - gdt - 1
    .long gdt

.org 510
.word 0xAA55
