/* Real-mode .COM layout: one contiguous chunk starting at 0x100, no flat-model gaps.
   Without this, .rodata/.data land at flat addresses the COM loader never copies. */
SECTIONS {
  . = 0x100;
  .text.start : { *(.text.start) }
  .text  : { *(.text*) }
  . = ALIGN(2);
  .rodata : { *(.rodata*) }
  . = ALIGN(2);
  .data  : { *(.data*) }
  . = ALIGN(2);
  .bss   : { *(.bss*) *(COMMON) }
}
