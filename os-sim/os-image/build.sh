#!/usr/bin/env bash
# Builds the NovaDesk floppy image (nova-desk.img) from source.
set -euo pipefail
cd "$(dirname "$0")"

as --32 -o entry.o entry.S

gcc -m32 -ffreestanding -fno-pic -fno-pie -fno-stack-protector -fno-asynchronous-unwind-tables \
    -fno-builtin -O2 -Wall -Wextra -Wno-unused-parameter -c kernel.c -o kernel.o

ld -m elf_i386 -T link.ld -nostdlib --oformat binary -o kernel.bin entry.o kernel.o

SIZE=$(stat -c%s kernel.bin)
SEC=$(( (SIZE + 511) / 512 ))
echo "kernel.bin: $SIZE bytes ($SEC sectors)"
if [ "$SEC" -gt 56 ]; then echo "kernel too big for 56 sectors"; exit 1; fi

# the boot sector needs the sector count baked in, so assemble it second
as --32 --defsym KERNEL_SECTORS=$SEC -o boot.o boot.S
ld -m elf_i386 -Ttext=0x7c00 -o boot.elf boot.o
objcopy -O binary -j .text boot.elf boot.full
# the section is padded to 32K by .org; the BIOS only reads the first 512 bytes
head -c 512 boot.full > boot.bin
test "$(stat -c%s boot.bin)" = "512" || { echo "boot sector must be 512 bytes"; exit 1; }

head -c 1474560 /dev/zero > nova-desk.img
dd if=boot.bin of=nova-desk.img conv=notrunc bs=512 count=1 status=none
dd if=kernel.bin of=nova-desk.img conv=notrunc bs=512 seek=1 status=none
echo "nova-desk.img: $(stat -c%s nova-desk.img) bytes"
