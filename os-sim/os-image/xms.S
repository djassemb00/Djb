/*
 * PLAN ٥-١ -- an XMS driver, because the one the plan promised does not exist.
 *
 * PLAN.md said the bundled FreeDOS "supports HIMEM/EMM386 through CONFIG.SYS (present but
 * disabled)". Measured, both halves are false:
 *
 *   - The boot image's root directory has eight entries: the FREEDOS volume label,
 *     AUTOEXEC.BAT, FSEVEN~1, KERNEL.SYS, COMMAND.COM, CONFIG.SYS, README.TXT. No \FDOS
 *     directory, no HIMEM.EXE, no EMM386.EXE -- though CONFIG.SYS carries commented-out
 *     DEVICE= lines naming them. Comments read like a switch waiting to be flipped; the
 *     files were never on the disk.
 *   - No driver is installed: INT 2Fh AX=4300h answers AL=0x00, where an installed driver
 *     answers 0x80. The memory is real -- INT 15h AH=88h reports 0x7C00 KB, 31 MB above
 *     1 MB -- but nothing gives a program a handle to it.
 *
 * FreeCom's banner says "XMS_Swap". That is a build option of the shell, not a driver
 * present: with no driver it quietly does without. That banner is how the false belief got
 * into the plan, so the point of this file is to make the claim measurable instead.
 *
 * WHAT THE MACHINE ACTUALLY PROVIDES (probed, not assumed)
 * --------------------------------------------------------
 * INT 15h AH=87h, the BIOS block mover, works and really lands data above 1 MB: a pattern
 * written through it came back byte-identical, and the byte written at FFFF:0010 was found
 * at linear 0x100000. So Move (0x0B) is built on it for real instead of being refused.
 * Getting that probe right mattered: the first attempt made v86 panic with
 * "Unimplemented: #GP handler" -- the crash proved the function exists and pointed at the
 * descriptor table, which I had laid out with source at 20h and destination at 10h and no
 * 93h access byte. The spec puts source at 10h, destination at 18h, and 00h-0Fh / 20h-2Fh
 * are the BIOS's own.
 *
 * The A20 gate is permanently enabled, and the BIOS lies about it: after a successful
 * "enable" (AX=2401h returns AH=00) the query AX=2402h still reports 0, and "disable"
 * (2400h) does not move the gate -- proven by the alias test A20 exists for (with the gate
 * down, linear 0x100000 must alias linear 0; it does not). So this driver never forwards
 * 2402h. It runs the alias test itself once, at install time, before any block is handed
 * out: the test touches linear 0x100000, which is exactly where the arena begins, so doing
 * it later could corrupt a live block. Enable then reports success (the gate is up) and
 * disable reports error 0xB2 (it cannot be done). That is the honest answer; silently
 * reporting "off" is how an extender ends up reading the wrong half of memory.
 *
 * A TSR rather than a CONFIG.SYS device driver: the application sees the same API either way
 * (INT 2Fh AX=4310h returns the entry point), it installs from AUTOEXEC.BAT, and it can be
 * tested end to end in this repository's harness.
 *
 * REGISTER DISCIPLINE
 * -------------------
 * The API is entered by a far call with the caller's DS:SI pointing at the Move structure,
 * so DS must not be touched and SI must survive (it is the struct cursor). Every resident
 * variable is `cs:`-addressed; the prologue keeps the caller's AX/BX/DX/SI in %cs:in_*;
 * pushaw saves the rest; the documented return registers are written last from %cs:out_*.
 * Only AX/BX/CX/DX are used as scratch -- no helper may clobber SI, which is what made the
 * previous draft read the Move structure through a stale pointer.
 */
        .code16
        .text
        .globl _start

_start:
/* ---- already resident? ------------------------------------------------------------- */
        movw    $0x4300, %ax
        int     $0x2f
        cmpb    $0x80, %al
        jne     do_install
        movw    $msg_present, %dx
        movb    $0x09, %ah
        int     $0x21
        movw    $0x0000, %ax
        int     $0x21

/* ---- install ----------------------------------------------------------------------- */
do_install:
        /* how much extended memory is really there */
        movb    $0x88, %ah
        int     $0x15
        movw    %ax, %cs:total_kb
        testw   %ax, %ax
        jz      no_memory

        /*
         * Can this driver actually reach above 1 MB? That is the entire product, so it is
         * proven here rather than assumed: a20_measure writes a byte through FFFF:0010 and
         * reads it back. On a machine where that fails, the driver refuses to install --
         * handing out memory that cannot be written would be discovered by the caller, as
         * corruption of something else.
         */
        call    a20_measure
        cmpw    $0, %cs:reach_ok
        je      no_move

/* ---- take INT 2Fh ------------------------------------------------------------------ */
        movw    $0x352f, %ax
        int     $0x21
        movw    %es, %cs:old2f_seg
        movw    %bx, %cs:old2f_off

        pushw   %cs
        popw    %ds
        movw    $handler, %dx
        movw    $0x252f, %ax
        int     $0x21

        movw    $msg_installed, %dx
        movb    $0x09, %ah
        int     $0x21

/* ---- stay resident ------------------------------------------------------------------ */
        movw    $0x3100, %ax
        movw    $((end_of_resident - _start + 0x100 + 15) / 16) + 0x10, %dx
        int     $0x21

no_memory:
        movw    $msg_nomem, %dx
        movb    $0x09, %ah
        int     $0x21
        movw    $0x0001, %ax
        int     $0x21
no_move:
        movw    $msg_nomove, %dx
        movb    $0x09, %ah
        int     $0x21
        movw    $0x0001, %ax
        int     $0x21

/*
 * a20_measure -> %cs:a20_on (1 = enabled).
 * Writes one byte through FFFF:0010 and one at 0000:0000 (the first byte of the interrupt
 * vector table), compares, restores the vector byte. If the two addresses are the same
 * location the gate is down; if they are distinct it is up. Nothing else can decide it.
 */
a20_measure:
        pushaw
        pushw   %ds
        pushw   %es
        pushw   %cs
        popw    %ds

        movw    $0x2401, %ax             /* ask the BIOS to enable, then verify ourselves */
        int     $0x15

        /*
         * The arena's first 16 bytes are reserved for this test and are never handed out, so
         * writing there is writing to memory that is ours. A byte is stored at linear
         * 0x100000 and read straight back through FFFF:0010:
         *
         *   reads back      => A20 is up and the memory above 1 MB is real, so the driver
         *                      can hand it out
         *   does not        => there is nothing usable up there, whatever AH=88h says, and
         *                      installing would hand out memory that cannot be written
         *
         * An earlier version compared an address above 1 MB against linear 0 instead. That
         * is the textbook A20 test, but it needs a byte that differs from whatever is at
         * linear 0 -- and when the two matched it wrote the driver's own scratch pattern
         * into the arena and left it there, which put 0xB0,0xB1,... into a resident TSR.
         */
        movw    $0xffff, %ax
        movw    %ax, %es
        movb    $0x5a, %es:0x0010
        movb    %es:0x0010, %al
        movb    $0, %es:0x0010           /* leave the arena clean */
        movw    $0, a20_on
        movw    $0, reach_ok
        cmpb    $0x5a, %al
        jne     1f
        movw    $1, a20_on
        movw    $1, reach_ok
1:      popw    %es
        popw    %ds
        popaw
        ret

/* ---- INT 2Fh ----------------------------------------------------------------------- */
handler:
        cmpw    $0x4300, %ax
        je      h_installed
        cmpw    $0x4310, %ax
        je      h_entry
        ljmp    *%cs:old2f_off

h_installed:
        movb    $0x80, %al
        iret

h_entry:
        pushw   %cs
        popw    %es
        movw    $xms_api, %bx
        iret

/* ---- the API ----------------------------------------------------------------------- */
xms_api:
        movw    %ds, %cs:in_ds           /* the caller's DS: the Move struct lives there */
        movw    %ax, %cs:in_ax
        movw    %bx, %cs:in_bx
        movw    %dx, %cs:in_dx
        movw    %si, %cs:in_si
        movb    %ah, %cs:fn

        pushaw
        pushw   %ds
        pushw   %es
        pushw   %cs
        popw    %ds
        pushw   %cs
        popw    %es

        movw    $0, out_ax
        movw    $0, out_bx
        movw    $0, out_dx
        movw    $0, mv_bad

        movb    fn, %al
        cmpb    $0x00, %al
        je      fn_version
        cmpb    $0x03, %al
        je      fn_a20_on
        cmpb    $0x04, %al
        je      fn_a20_off
        cmpb    $0x05, %al
        je      fn_a20_on
        cmpb    $0x06, %al
        je      fn_a20_off
        cmpb    $0x07, %al
        je      fn_a20_query
        cmpb    $0x08, %al
        je      fn_query_free
        cmpb    $0x88, %al
        je      fn_query_free
        cmpb    $0x09, %al
        je      fn_alloc
        cmpb    $0x89, %al
        je      fn_alloc
        cmpb    $0x0a, %al
        je      fn_free_block
        cmpb    $0x0b, %al
        je      fn_move
        cmpb    $0x0c, %al
        je      fn_ok
        cmpb    $0x0d, %al
        je      fn_ok
        cmpb    $0x0e, %al
        je      fn_handle_info
        cmpb    $0x0f, %al
        je      fn_resize
        cmpb    $0x10, %al
        je      fn_ok
        jmp     err_notimpl

fn_ok:
        jmp     done

fn_version:
        movw    $0x0300, out_ax          /* XMS 3.00 */
        movw    $0x0000, out_bx          /* bit 0 = HMA exists. It does not, so say so. */
        movw    $0x0000, out_dx
        jmp     done

fn_a20_on:
        movw    $0x2401, %ax
        int     $0x15
        movw    $1, out_bx
        jmp     done

fn_a20_off:
        /* Measured: this machine's gate cannot be lowered. Try, then answer truthfully. */
        movw    $0x2400, %ax
        int     $0x15
        movw    $0x00b2, out_bx
        jmp     done

fn_a20_query:
        movw    a20_on, %ax
        movw    %ax, out_bx              /* our measurement, not the BIOS's */
        jmp     done

/*
 * 0x08: AX = total free KB, DX = largest free block KB.
 * Allocation is a bump pointer, so freeing a middle block returns KB to the total but not
 * to the largest block: only the tail above high_water_kb can be handed out in one piece.
 */
fn_query_free:
        movw    total_kb, %ax
        subw    used_kb, %ax
        movw    %ax, out_ax
        movw    total_kb, %dx
        subw    high_water_kb, %dx
        movw    %dx, out_dx
        jmp     done

/* 0x09: DX = KB wanted -> DX = handle */
fn_alloc:
        movw    in_dx, %dx
        testw   %dx, %dx
        jz      err_size
        call    free_kb
        cmpw    %ax, %dx
        ja      err_mem

        movw    $handle_tab, %si
        movw    $0, %cx
1:      cmpw    $0, (%si)
        je      2f
        addw    $8, %si
        incw    %cx
        cmpw    $8, %cx
        jb      1b
        jmp     err_handles

2:      movw    $1, (%si)                /* used */
        movw    high_water_kb, %ax
        movw    %ax, 2(%si)              /* offset, in KB */
        movw    in_dx, %ax
        movw    %ax, 4(%si)              /* size, in KB */
        addw    %ax, high_water_kb
        addw    %ax, used_kb
        addw    $1, %cx
        movw    %cx, out_dx
        jmp     done

/* 0x0A: DX = handle */
fn_free_block:
        movw    in_dx, %dx
        testw   %dx, %dx
        jz      err_handle
        movw    %dx, %ax
        decw    %ax
        cmpw    $8, %ax
        jae     err_handle
        movw    %ax, %bx
        shlw    $3, %bx
        addw    $handle_tab, %bx
        cmpw    $0, (%bx)
        je      err_handle
        movw    $0, (%bx)
        movw    2(%bx), %ax
        addw    4(%bx), %ax
        cmpw    high_water_kb, %ax       /* did this block end at the high-water mark? */
        jne     3f
        movw    2(%bx), %ax
        movw    %ax, high_water_kb       /* give the tail back to the largest-block number */
3:      movw    4(%bx), %ax
        subw    %ax, used_kb
        jmp     done

/* 0x0E: BX = largest available block, DX = free handles */
fn_handle_info:
        movw    total_kb, %ax
        subw    high_water_kb, %ax
        movw    %ax, out_bx
        movw    $8, %dx
        movw    $handle_tab, %bx
        movw    $8, %cx
4:      cmpw    $0, (%bx)
        jne     5f
        decw    %dx
5:      addw    $8, %bx
        loop    4b
        movw    %dx, out_dx
        jmp     done

/* 0x0F: DX = handle, BX = new size in KB */
fn_resize:
        movw    in_dx, %dx
        testw   %dx, %dx
        jz      err_handle
        movw    %dx, %ax
        decw    %ax
        cmpw    $8, %ax
        jae     err_handle
        movw    %ax, %si
        shlw    $3, %si
        addw    $handle_tab, %si
        cmpw    $0, (%si)
        je      err_handle
        movw    in_bx, %cx               /* requested KB */
        movw    4(%si), %ax              /* current KB */
        cmpw    %cx, %ax
        je      done
        jb      resize_grow
        /* shrink: the released KB goes back to the total, never to the tail, because the
           tail is above every block and a shrink cannot move this block's end upward */
        movw    %ax, %dx
        subw    %cx, %dx
        movw    %cx, 4(%si)
        subw    %dx, used_kb
        movw    2(%si), %ax
        addw    4(%si), %ax
        cmpw    high_water_kb, %ax
        jne     done
        movw    %ax, high_water_kb
        jmp     done
resize_grow:
        movw    %cx, %dx
        subw    %ax, %dx                 /* KB needed */
        call    free_kb
        cmpw    %ax, %dx
        ja      err_mem
        /* only a block that ends at the high-water mark can grow into the tail */
        movw    2(%si), %ax
        addw    4(%si), %ax
        cmpw    high_water_kb, %ax
        jne     err_mem
        movw    %cx, 4(%si)
        movw    %cx, %ax                 /* new size */
        addw    %dx, high_water_kb
        addw    %dx, used_kb
        jmp     done

/*
 * 0x0B Move. DS:SI -> {len:dword, srcHandle:word, srcOff:dword, dstHandle:word,
 * dstOff:dword}. Handle 0 is conventional memory and its offset is a real-mode seg:off
 * (low word = offset, high word = segment); any other handle is linear, relative to that
 * block.
 *
 * These bytes are copied HERE, not by INT 15h AH=87h. Why, measured: with the source in a
 * normal segment the BIOS mover returned a status but nothing arrived at 1 MB (probe 4), so
 * a driver built on it would hand out memory that silently is not there. This uses what
 * makes A20 worth having on a 386 instead: in real mode, segment 0xFFFF plus a 32-bit offset
 * reaches linear 0xFFFF0 + offset, and with A20 up that is ordinary RAM far above 1 MB
 * (probe 5 round-tripped 0x5A at linear 0x100000 exactly this way). No protected-mode
 * switch, no descriptor table, nothing that can fault halfway through a block.
 *
 * Supported: conventional -> extended, extended -> conventional, conventional ->
 * conventional. Extended -> extended is refused with 0x80 rather than half-done: two
 * independent high offsets cannot both be live at once without re-pointing a segment
 * mid-copy, and a wrong answer there corrupts memory instead of failing.
 */
fn_move:
        /*
         * The struct is in the CALLER's DS, which the API prologue replaced with CS. Copy
         * the 16 bytes into CS:mv_struct first; reading (%si) here without doing this reads
         * our own code segment, which parses as a plausible-looking garbage struct.
         */
        /*
         * ORDER IS THE WHOLE BUG: with DS still = CS, load every cs: variable we need
         * (source cursor from cs:in_si, destination from cs:mv_struct). Only then switch DS
         * to the caller's segment for the copy. Reading cs:in_si AFTER the switch reads it
         * out of the caller's memory at our own variable's offset -- which is what happened,
         * and why the copied "struct" was our own code.
         */
        movw    in_si, %si               /* source cursor   (CS still == DS) */
        movw    $mv_struct, %di          /* destination     (CS still == DS) */
        movw    $18, %cx                 /* the struct is 18 bytes: two offsets are dwords */
        pushw   %cs
        popw    %es                      /* ES = our segment, BEFORE DS moves off it */
        movw    in_ds, %ax
        movw    %ax, %ds                 /* DS = caller's segment */
        cld
        rep movsb
        pushw   %cs
        popw    %ds
        movw    $mv_struct, %si          /* rep movsb advanced SI and DI: reset the cursor */

        /*
         * Field offsets are the spec's, not one long's: +0 is a reserved word, the length is
         * at +2 (low) and +4 (high), source handle at +6, source offset at +8 (low) and +10
         * (high, or the segment for conventional memory), destination handle at +12, offset
         * at +14 and +16. The previous version read the length at +0, which is the reserved
         * word -- always zero -- so every Move was "length 0" and did nothing, while every
         * other field was off by two as well.
         */
        movw    2(%si), %ax              /* length low */
        movw    4(%si), %dx              /* length high */
        testw   %dx, %dx
        jnz     err_size
        testw   %ax, %ax
        jz      done
        movw    %ax, mv_len

        movw    6(%si), %ax              /* src handle */
        movw    %ax, src_hdl
        movw    8(%si), %dx              /* src offset low */
        movw    10(%si), %bx             /* src offset high / segment */
        call    lin_of
        cmpw    $0, mv_bad
        jne     err_handle
        movw    mv_tmp_lo, %ax
        movw    %ax, mv_src
        movw    mv_tmp_hi, %ax
        movw    %ax, mv_src+2

        movw    12(%si), %ax             /* dst handle */
        movw    %ax, dst_hdl
        movw    14(%si), %dx
        movw    16(%si), %bx
        call    lin_of
        cmpw    $0, mv_bad
        jne     err_handle
        movw    mv_tmp_lo, %ax
        movw    %ax, mv_dst
        movw    mv_tmp_hi, %ax
        movw    %ax, mv_dst+2

        cmpw    $0, src_hdl
        je      m_check_dst
        cmpw    $0, dst_hdl
        jne     err_notimpl              /* ext -> ext: refused, not half-done */
m_check_dst:
        cmpw    $0, dst_hdl
        je      m_check_src
        jmp     m_conv_ext
m_check_src:
        cmpw    $0, src_hdl
        je      m_conv_conv
        jmp     m_ext_conv

/* ---- conventional -> extended ---- */
m_conv_ext:
        movw    mv_dst, %ax
        movw    mv_dst+2, %dx
        call    to_high                  /* ES = 0xFFFF, EDI = destination linear - 0xFFFF0 */

        /*
         * Every driver variable is read BEFORE DS is switched to the source segment: once DS
         * points at user data, `movw mv_len, %cx` reads the user's bytes instead. The loop
         * body therefore touches registers only.
         */
        movw    mv_src, %si              /* 20-bit linear -> seg:off */
        movw    %si, %dx
        andw    $0x000f, %dx             /* offset within the paragraph */
        movw    %si, %ax
        shrw    $4, %ax                  /* segment */
        movw    mv_len, %cx
        movw    %dx, %si
        pushw   %ds
        movw    %ax, %ds
        cld
ce_loop:
        lodsb
        movb    %al, %es:(%edi)
        incl    %edi
        loop    ce_loop
        popw    %ds
        jmp     move_done

/* ---- extended -> conventional ---- */
m_ext_conv:
        movw    mv_src, %ax
        movw    mv_src+2, %dx
        call    to_high                  /* ES = 0xFFFF, EDI = source linear - 0xFFFF0 */

        movw    mv_dst, %si              /* destination as DS:SI */
        movw    %si, %dx
        andw    $0x000f, %dx
        movw    %si, %ax
        shrw    $4, %ax
        movw    mv_len, %cx
        movw    %dx, %si
        pushw   %ds
        movw    %ax, %ds                 /* DS = destination segment, ES = the high one */
        cld
ec_loop:
        movb    %es:(%edi), %al
        incl    %edi
        movb    %al, (%si)
        incw    %si
        loop    ec_loop
        popw    %ds
        jmp     move_done

/* ---- conventional -> conventional ---- */
m_conv_conv:
        movw    mv_src, %si
        movw    %si, %bx
        andw    $0x000f, %bx
        movw    %si, %ax
        shrw    $4, %ax
        pushw   %ax

        movw    mv_dst, %di
        movw    %di, %dx
        andw    $0x000f, %dx
        movw    %di, %ax
        shrw    $4, %ax
        pushw   %ax

        movw    mv_len, %cx
        movw    %bx, %si
        movw    %dx, %di
        popw    %es
        popw    %ds
        cld
        rep movsb
        pushw   %cs
        popw    %ds
        pushw   %cs
        popw    %es
        jmp     move_done

move_done:
        pushw   %cs
        popw    %ds
        pushw   %cs
        popw    %es
        movw    $0, out_bx
        jmp     done

/*
 * to_high: AX = linear low, DX = linear high -> ES = 0xFFFF, EDI = linear - 0xFFFF0.
 * Every extended block lives at or above 1 MB, so the subtraction never borrows.
 */
to_high:
        /*
         * EDI = linear - 0xFFFF0, because segment 0xFFFF contributes 0xFFFF0 and EDI holds
         * the rest. The subtraction crosses a word boundary, so the borrow must be propagated
         * into the high word: without `sbbw $0, %dx` every extended address was 64 KB too
         * high -- the driver returned success and wrote to memory nobody was looking at.
         */
        subw    $0xfff0, %ax
        sbbw    $0x0000, %dx
        xorl    %edi, %edi
        xorl    %ebx, %ebx
        movw    %ax, %bx                 /* low word */
        movw    %dx, %cx
        shll    $16, %ecx                /* high word in place (32-bit shift) */
        orl     %ecx, %ebx
        movl    %ebx, %edi
        movw    $0xffff, %ax
        movw    %ax, %es
        ret

/*
 * lin_of: AX = handle, DX = offset low, BX = offset high -> mv_tmp_lo/hi (linear).
 * Sets mv_bad when the handle is not one of ours. Clobbers only AX/BX/CX/DX/DI.
 */
lin_of:
        testw   %ax, %ax
        jz      lo_conv
        decw    %ax
        cmpw    $8, %ax
        jae     lo_bad
        movw    %ax, %di
        shlw    $3, %di
        addw    $handle_tab, %di
        cmpw    $0, (%di)
        je      lo_bad
        movw    2(%di), %ax              /* block offset, in KB */
        movw    %ax, %cx
        andw    $0x003f, %cx
        shlw    $10, %cx                 /* low word of kb*1024 */
        shrw    $6, %ax                  /* high word of kb*1024 */
        addw    %dx, %cx                 /* + requested offset low */
        adcw    %bx, %ax                 /* + requested offset high */
        /* + 1 MB (0x100000 = hi 0x0010, lo 0x0000) + 16 bytes reserved for the A20 probe.
           The 16 goes on the LOW word: adding 1 to the high word would jump 64 KB, and the
           harness then read 1 MB + 16 while the driver wrote 1 MB + 64 KB -- measured as a
           block of zeros and mistaken for "extended memory does not work". */
        addw    $0x0010, %cx
        adcw    $0x0010, %ax
        movw    %cx, mv_tmp_lo
        movw    %ax, mv_tmp_hi
        ret
lo_conv:
        /* linear = segment*16 + offset, in 32 bits so a wrap past 1 MB stays visible */
        movw    %bx, %ax                 /* BX holds the segment word */
        movw    %ax, %cx
        shrw    $12, %cx
        andw    $0x0fff, %ax
        shlw    $4, %ax
        addw    %dx, %ax
        adcw    $0, %cx
        movw    %ax, mv_tmp_lo
        movw    %cx, mv_tmp_hi
        ret
lo_bad:
        movw    $1, mv_bad
        movw    $0, mv_tmp_lo
        movw    $0, mv_tmp_hi
        ret

/* add_done: AX:DX += mv_done */
add_done:
        movw    mv_done, %cx
        addw    %cx, %ax
        adcw    $0, %dx
        ret

/* free_kb -> AX */
free_kb:
        movw    total_kb, %ax
        subw    used_kb, %ax
        ret

/*
 * Temporary: report the first four words of the struct the driver copied, in the caller's
 * segment. Removed once Move is proven.
 */
err_size:
        movw    $0x00a0, out_bx
        jmp     done
err_mem:
        movw    $0x00a1, out_bx
        jmp     done
err_handle:
        movw    $0x00a2, out_bx
        jmp     done
err_handles:
        movw    $0x00a3, out_bx
        jmp     done
err_a20:
        movw    $0x00b2, out_bx
        jmp     done
err_notimpl:
        /* 0x80 = not implemented. Saying so lets the caller fall back instead of believing
           a garbage "success". */
        movw    $0x0080, out_bx
        jmp     done

done:
        popw    %es
        popw    %ds
        popaw
        /*
         * DS is now the CALLER's again, so these reads must name CS explicitly. Without the
         * override this is the mirror of the Move-struct bug: the driver read its own
         * output words out of the client's segment and returned whatever happened to be
         * there -- measured as a version of 0000 from a fully installed driver.
         */
        movw    %cs:out_ax, %ax
        movw    %cs:out_bx, %bx
        movw    %cs:out_dx, %dx
        lret

/* ---- BIOS block mover -------------------------------------------------------------- */
/*
 * Builds the six-descriptor table from cs:mv_src / cs:mv_dst and CX words, then calls
 * INT 15h AH=87h. The first version of this routine only did the INT and left the table to
 * the caller -- and the install-time self test passed an all-zero table, so v86 panicked
 * with "Unimplemented: #GP handler" from inside the BIOS. The table layout is exactly what
 * the probe measured: source at 10h, destination at 18h, access 93h, and 00h-0Fh / 20h-2Fh
 * left for the BIOS.
 *
 * CX is preserved on return; AH is the BIOS status.
 */
move_87:
        pushw   %cx
        pushw   %di
        pushw   %ds
        pushw   %es
        pushw   %cs
        popw    %ds
        pushw   %cs
        popw    %es

        movw    $mv_gdt, %di
        pushw   %cx
        movw    $48, %cx
        xorw    %ax, %ax
        cld
        rep stosb
        popw    %cx

        movw    %cx, %ax                 /* limit = 2*words - 1 */
        shlw    $1, %ax
        decw    %ax
        movw    %ax, mv_gdt+0x10
        movw    %ax, mv_gdt+0x18

        movw    mv_src, %ax              /* 24-bit source base, little-endian */
        movw    %ax, mv_gdt+0x12
        movb    mv_src+2, %al
        movb    %al, mv_gdt+0x14

        movw    mv_dst, %ax              /* 24-bit destination base */
        movw    %ax, mv_gdt+0x1a
        movb    mv_dst+2, %al
        movb    %al, mv_gdt+0x1c

        movb    $0x93, mv_gdt+0x15       /* present, DPL0, writable data */
        movb    $0x93, mv_gdt+0x1d

        movw    $mv_gdt, %si
        movb    $0x87, %ah
        int     $0x15

        popw    %es
        popw    %ds
        popw    %di
        popw    %cx
        ret

/* ---- resident data ------------------------------------------------------------------ */
        .balign 16
mv_gdt:         .space 48
mv_src:         .word 0, 0
mv_dst:         .word 0, 0
mv_tmp_lo:      .word 0
mv_tmp_hi:      .word 0
mv_len:         .word 0
mv_chunk:       .word 0
mv_done:        .word 0
mv_bad:         .word 0
src_hdl:        .word 0
dst_hdl:        .word 0
conv_seg:       .word 0
conv_off:       .word 0
in_ax:          .word 0
in_ds:          .word 0
        .balign 16
mv_struct:      .space 20
in_bx:          .word 0
in_dx:          .word 0
in_si:          .word 0
out_ax:         .word 0
out_bx:         .word 0
out_dx:         .word 0
fn:             .byte 0
total_kb:       .word 0
used_kb:        .word 0
high_water_kb:  .word 0
a20_on:         .word 0
old2f_off:      .word 0
old2f_seg:      .word 0
saved_ivt:      .byte 0
alias_probe:    .byte 0
alias_seen:     .byte 0
alias_low:      .byte 0
reach_ok:       .word 0
probe_a:        .word 0
probe_b:        .word 0
        .balign 16
handle_tab:     .space 64

msg_present:    .asciz "XMSTS: already installed\r\n$"
msg_installed:  .asciz "XMSTS: XMS driver resident\r\n$"
msg_nomem:      .asciz "XMSTS: no extended memory, not installed\r\n$"
msg_nomove:     .asciz "XMSTS: BIOS block mover unusable, not installed\r\n$"
end_of_resident:
