/* NovaDesk kernel: everything lives at 0x10000 (linked as one flat blob). */
ENTRY(_start32)
SECTIONS
{
  . = 0x10000;
  .text : { *(.text*) }
  .rodata : { *(.rodata*) }
  .data : { *(.data*) }
  .bss : { *(.bss*) *(COMMON) }
}
