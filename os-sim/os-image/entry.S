/*
 * 32-bit startup code, IDT, IRQ and exception stubs for NovaDesk.
 * Linked with kernel.c at 0x10000.
 */
.code32
.section .text
.globl _start32
_start32:
    mov $'A', %al
    call putc32
    mov $0x10, %ax
    mov %ax, %ds
    mov %ax, %es
    mov %ax, %fs
    mov %ax, %gs
    mov %ax, %ss
    mov $0x90000, %esp

    mov $'B', %al
    call putc32
    /* remap the PIC: IRQ0-15 -> vectors 0x20-0x2F */
    mov $0x11, %al
    out %al, $0x20
    out %al, $0xA0
    mov $0x20, %al
    out %al, $0x21
    mov $0x28, %al
    out %al, $0xA1
    mov $0x04, %al
    out %al, $0x21
    mov $0x02, %al
    out %al, $0xA1
    mov $0x01, %al
    out %al, $0x21
    out %al, $0xA1
    mov $0xF8, %al          /* unmask IRQ0 timer, IRQ1 kbd, IRQ2 cascade */
    out %al, $0x21
    mov $0xEF, %al          /* unmask IRQ12 mouse */
    out %al, $0xA1

    mov $'C', %al
    call putc32
    /* ---- IDT: exceptions 0..31 -> trap_stub, IRQs 0x20/0x21/0x2C ---- */
    lea idt, %edi
    xor %ecx, %ecx
    lea trap_table, %esi
fill_idt:
    mov (%esi), %ebx
    call write_gate
    add $8, %edi
    add $4, %esi
    inc %ecx
    cmp $256, %ecx
    jb fill_idt

    lea idt + 0x20*8, %edi
    lea isr_timer, %ebx
    call write_gate
    lea idt + 0x21*8, %edi
    lea isr_kbd, %ebx
    call write_gate
    lea idt + 0x2C*8, %edi
    lea isr_mouse, %ebx
    call write_gate

    mov $'D', %al
    call putc32
    lidt idt_desc
    mov $'E', %al
    call putc32

    /* PIT: 100 Hz so the scheduler ticks are predictable */
    mov $0x43, %dx
    mov $0x36, %al
    out %al, %dx
    mov $0x40, %dx
    mov $0x9C, %al
    out %al, %dx
    mov $0x2E, %al
    out %al, %dx

    mov $'F', %al
    call putc32
    call kmain
    mov $'G', %al
    call putc32

.Lhalt:
    hlt
    jmp .Lhalt

/* al = character to print on COM1 */
putc32:
    push %eax
    push %edx
    mov %al, %ah
    mov $0x3FD, %dx
.Lpc_wait:
    in %dx, %al
    test $0x20, %al
    jz .Lpc_wait
    mov $0x3F8, %dx
    mov %ah, %al
    out %al, %dx
    pop %edx
    pop %eax
    ret

/* edi = gate address, ebx = handler address */
write_gate:
    mov %bx, 0(%edi)
    movw $0x08, 2(%edi)
    movb $0, 4(%edi)
    movb $0x8E, 5(%edi)
    shr $16, %ebx
    mov %bx, 6(%edi)
    movw $0, 7(%edi)
    ret

/* ---- IRQ handlers ---- */
isr_timer:
    pushal
    incl ticks
    call sys_tick
    mov $0x20, %al
    out %al, $0x20
    popal
    iret

isr_kbd:
    pushal
    in $0x60, %al
    mov %al, kb_scan
    movzbl %al, %eax
    push %eax
    call kb_event
    add $4, %esp
    mov $0x20, %al
    out %al, $0x20
    popal
    iret

/* three-byte PS/2 packet assembly (real IRQ12) */
isr_mouse:
    pushal
    in $0x60, %al
    movzbl mouse_cycle, %ebx
    test %ebx, %ebx
    jnz .Lm1
    mov %al, mouse_buf0
    incb mouse_cycle
    jmp .Lm_ack
.Lm1:
    cmp $1, %ebx
    jne .Lm2
    mov %al, mouse_buf1
    incb mouse_cycle
    jmp .Lm_ack
.Lm2:
    cmp $2, %ebx
    jne .Lm_ack
    mov %al, mouse_buf2
    movb $3, mouse_cycle
.Lm_ack:
    mov $0x20, %al
    out %al, $0xA0
    out %al, $0x20
    popal
    iret

/* ---- exception traps: report the vector id and halt ---- */
.macro trapvec n
trap_\n:
    push $\n
    jmp trap_common
.endm
.irp n,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31
trapvec \n
.endr

trap_common:
    cli
    pushal
    push $msg_fault
    call serial_puts32
    add $4, %esp
    mov 32(%esp), %eax          /* vector pushed by the stub */
    push %eax
    call serial_put_hex
    add $4, %esp
.Ltrap:
    cli
    hlt
    jmp .Ltrap

/* print eax as two hex digits + newline */
serial_put_hex:
    push %eax
    push %edx
    mov 12(%esp), %eax
    mov %al, %ah
    shr $4, %al
    and $15, %al
    call .Lhex_put
    mov %ah, %al
    and $15, %al
    call .Lhex_put
    mov $13, %al
    call .Lhex_put
    mov $10, %al
    call .Lhex_put
    pop %edx
    pop %eax
    ret
.Lhex_put:
    push %edx
    cmp $10, %al
    jb 1f
    add $39, %al
1:  add $48, %al
    mov $0x3FD, %dx
2:  push %eax
    in %dx, %al
    test $0x20, %al
    pop %eax
    jz 2b
    mov $0x3F8, %dx
    out %al, %dx
    pop %edx
    ret

/* ---- 32-bit serial output (COM1) ---- */
.globl serial_puts32
serial_puts32:
    push %eax
    push %edx
    push %esi
    mov 16(%esp), %esi          /* cdecl: arg0 (after 3 pushes + return address) */
.Lsp_loop:
    mov (%esi), %al
    test %al, %al
    jz .Lsp_done
    mov $0x3FD, %dx
.Lsp_wait:
    in %dx, %al
    test $0x20, %al
    jz .Lsp_wait
    mov $0x3F8, %dx
    mov (%esi), %al
    out %al, %dx
    inc %esi
    jmp .Lsp_loop
.Lsp_done:
    pop %esi
    pop %edx
    pop %eax
    ret

/* handler address table: 32 exception stubs, then the fault stub for the rest */
.section .rodata
.align 4
trap_table:
    .long trap_0, trap_1, trap_2, trap_3, trap_4, trap_5, trap_6, trap_7
    .long trap_8, trap_9, trap_10, trap_11, trap_12, trap_13, trap_14, trap_15
    .long trap_16, trap_17, trap_18, trap_19, trap_20, trap_21, trap_22, trap_23
    .long trap_24, trap_25, trap_26, trap_27, trap_28, trap_29, trap_30, trap_31
    .rept 224
    .long trap_0
    .endr

.section .text
/* snapshot of the emulated instruction stream (used by the monitor app) */
.globl icount_sample
icount_sample:
    mov $0x2000, %ecx
.Lic:
    loop .Lic
    mov $0x2000, %eax
    sub %ecx, %eax
    ret

.section .rodata
msg_fault: .asciz "NOVADESK: cpu exception, halting\r\n"

.section .bss
.align 16
idt:
    .space 256*8

.section .data
.align 4
.globl idt_desc
idt_desc:
    .word 256*8 - 1
    .long idt

.globl ticks
ticks: .long 0
.globl kb_scan
kb_scan: .byte 0
.globl mouse_buf0, mouse_buf1, mouse_buf2, mouse_cycle
mouse_buf0: .byte 0
mouse_buf1: .byte 0
mouse_buf2: .byte 0
mouse_cycle: .byte 0
