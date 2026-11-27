#!/bin/sh
# Build the bundled DOS programs (16-bit real mode, BIOS + DOS calls only).
# They are ordinary .COM files: no Windows, no externals, public domain.
set -e
cd "$(dirname "$0")"
CC=${CC:-gcc}
for src in menu snake pong; do
  $CC -m16 -ffreestanding -fno-pic -fno-asynchronous-unwind-tables -Os -c "$src.c" -o "$src.o"
done
ld -m elf_i386 -T com.ld --oformat binary -o MENU.COM  menu.o
ld -m elf_i386 -T com.ld --oformat binary -o SNAKE.COM snake.o
ld -m elf_i386 -T com.ld --oformat binary -o PONG.COM  pong.o
rm -f menu.o snake.o pong.o
ls -l MENU.COM SNAKE.COM PONG.COM
