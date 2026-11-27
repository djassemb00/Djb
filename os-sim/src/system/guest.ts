/**
 * Building a bootable disk around a user's program.
 *
 * The route that actually works on a phone today is: take a DOS program, put it on
 * a floppy that already contains FreeDOS (GPL, so we may redistribute it), and let
 * AUTOEXEC.BAT start the program. No Windows, no Wine, no desktop in between — the
 * program is the entire session.
 *
 * The system files come from the boot image we already ship, so this adds zero
 * bytes to the app: we slice KERNEL.SYS / COMMAND.COM / CONFIG.SYS out of
 * `images/freedos-boot.img` at runtime and write them into a fresh floppy next to
 * the user's file.
 */
import { CLUSTER, DATA_START, buildFloppy, FLOPPY_MAX_FILE } from './fat12';
import { buildFat16 } from './fat16';

/*
 * These two numbers used to be local constants here ("1024" and "16896"), and the test
 * for them restated the same literals -- the exact defect of round 25, where a contract
 * test agreed with a copy of itself. They are the layout of fat12.ts, so they come from
 * it now.
 */
/** offsets measured from our own freedos-boot.img (cluster numbers from its root dir) */
const SYSTEM_FILES: { name: string; cluster: number; size: number }[] = [
  { name: 'KERNEL.SYS', cluster: 7, size: 45450 },
  { name: 'COMMAND.COM', cluster: 56, size: 66090 },
  { name: 'CONFIG.SYS', cluster: 125, size: 209 },
];

export interface DosProgram {
  /** original file name, used for the 8.3 name and the AUTOEXEC command */
  name: string;
  data: Uint8Array;
  /** extension override (COM stays COM) */
  ext?: string;
  /** data files that must sit next to the program on the volume */
  files?: { name: string; data: Uint8Array }[];
}

let cache: { system: { name: string; data: Uint8Array }[]; boot: Uint8Array } | null = null;

/**
 * Read the shipped FreeDOS image.
 *
 * In the browser this is a plain fetch. In Node (tests, CI, the gate's probes) relative
 * URLs are invalid, so fall back to the file system before giving up -- without this,
 * `buildProgramDisk` could not be tested at all outside a browser, which is how its
 * THREE geometry bugs survived.
 */
async function readBaseImage(): Promise<Uint8Array> {
  if (typeof fetch === 'function') {
    try {
      const res = await fetch('./images/freedos-boot.img');
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
    } catch {
      /* not a browser, or offline: try the file system */
    }
  }
  const { readFileSync } = await import('node:fs');
  return new Uint8Array(readFileSync(new URL('../../public/images/freedos-boot.img', import.meta.url)));
}

async function loadBase() {
  if (cache) return cache;
  const boot = await readBaseImage();
  const system = SYSTEM_FILES.map((f) => {
    const off = DATA_START + (f.cluster - 2) * CLUSTER;
    return { name: f.name, data: boot.slice(off, off + f.size) };
  });
  // CONFIG.SYS from the stock image points SHELL at A:\COMMAND.COM, which is
  // exactly where we put it — keep it, only make sure FILES is generous for games.
  cache = { system, boot };
  return cache;
}

/** 8.3 name of the program, without extension */
function baseName(name: string): string {
  const stem = name.replace(/\.[^.]*$/, '');
  const clean = stem.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (clean || 'PROGRAM').slice(0, 8);
}

export function programExt(p: DosProgram): string {
  const explicit = p.ext?.toUpperCase();
  if (explicit) return explicit.slice(0, 3);
  const ext = p.name.split('.').pop()?.toUpperCase() ?? 'EXE';
  return /^(COM|EXE|BAT)$/.test(ext) ? ext : 'EXE';
}

/**
 * Build the floppy. Throws a *useful* Arabic error when the program cannot fit —
 * a 1.44 MB floppy is the whole filesystem, so a big .exe has to be told no.
 */
export async function buildProgramDisk(p: DosProgram): Promise<Uint8Array> {
  const { system, boot } = await loadBase();
  const used = system.reduce((n, f) => n + Math.ceil(f.data.length / CLUSTER) * CLUSTER, 0);
  const free = FLOPPY_MAX_FILE - used - 2048; // leave room for AUTOEXEC
  if (p.data.length > free) {
    /*
     * The caller must fall back to `buildProgramSet`, which puts the program on a FAT16
     * volume instead. This message is only correct if nothing catches it, so it describes
     * the limit rather than promising a feature.
     */
    throw new Error(
      `البرنامج ${(p.data.length / 1048576).toFixed(2)} ميغا، وسعة قرص المرن ` +
        `${(free / 1048576).toFixed(2)} ميغا. يُنقل إلى قرص صلب FAT16.`,
    );
  }
  const base = baseName(p.name);
  const ext = programExt(p);
  return buildFloppy({
    name: base,
    ext,
    data: p.data,
    extra: system,
    command: `${base}.${ext}`,
    bootFrom: boot,
  });
}

/** a stable id per launch, so the machine view re-boots for every new program */
export function programImageId(): string {
  return `prog-${Date.now().toString(36)}`;
}

/*
 * ---- ٥-٢: the hard disk ------------------------------------------------------------
 *
 * A floppy is the whole file system for a launched program, so a program is capped at
 * ~1.35 MB. PLAN ٥-٢ asks for twenty games on one disk; that is a 32 MB FAT16 volume.
 *
 * Measured in v86 with a real FreeDOS kernel: a FAT16 volume CANNOT be the boot disk. Its
 * MBR carries no boot code, so SeaBIOS answers "Boot failed: not a bootable disk" -- and
 * moving the BPB to sector 0 instead of a partition table only earns "illegal partition
 * table". The route that works, and the one this function builds, is: boot from the floppy,
 * attach the volume as the first fixed disk (hda), and let AUTOEXEC reach it as C:. Proven
 * on the emulator the app ships -- "C: HD1, Pri[1]" mounts, the file lists, and its bytes
 * read back.
 *
 * hda specifically, not any disk: attached as hdb with no hda the same kernel printed "no
 * hard disks detected" and the volume never appeared.
 */

/** The volume a launched program sees as C:. */
export const DISK_LETTER = 'C';

/**
 * Point a program's AUTOEXEC at the hard disk.
 *
 * A function and not a string literal at the call site for two reasons:
 *
 *   1. The command must carry the drive, or DOS looks for the program on A: and reports
 *      "Bad command or file name" for a program that is right there.
 *   2. The script has to come back to A: afterwards. Left on C:, the "Program ended, type
 *      DIR" prompt shows a different drive than the one the user booted from, and the
 *      shell's own directory is not there -- so the first thing a user types fails.
 */
export function hardDiskAutoexec(command: string): string {
  return (
    '@ECHO OFF\r\n' +
    'PROMPT $P$G\r\n' +
    `ECHO Program on drive ${DISK_LETTER}:\\ (${command})\r\n` +
    `${DISK_LETTER}:\r\n` +
    'CD \\\r\n' +
    `${command}\r\n` +
    'ECHO.\r\n' +
    'ECHO Program ended. Type DIR to list the disk.\r\n' +
    'A:\r\n'
  );
}

/**
 * How big the volume must be to hold `bytes`.
 *
 * The layout spends the first MB on the MBR and the gap before the partition, and the FATs
 * and root directory take a little more, so rounding the payload up is not enough: two extra
 * MB keeps the write from failing on a volume that "should" have fit.
 *
 * The floor is 32 MB, and that is measured, not chosen. Volumes of 16 and 24 MB mount and
 * read correctly, but the kernel prints "WARNING: using suspect partition Pri:1 FS 0e: with
 * calculated values 28-4-1 instead of 2-0-33" on every mount: below ~32 MB the geometry
 * SeaBIOS reports for the disk differs from the one its size implies, so the CHS triplet we
 * derive from 16-head/63-sector arithmetic disagrees with the BIOS's own translation. We do
 * not know the BIOS's rule for those sizes, and a disk that mounts with a complaint is a
 * disk whose table is wrong. 32, 48 and 64 MB were measured clean, so the floor is 32.
 */
export function volumeSizeMB(bytes: number): number {
  return Math.max(32, Math.ceil(bytes / 1048576) + 2);
}

/** the 8.3 name a file gets on the volume */
export function fileName83(p: DosProgram): string {
  return `${baseName(p.name)}.${programExt(p)}`;
}

/**
 * A boot floppy plus a FAT16 data volume, for a program too big for a floppy.
 *
 * Returns both images because the guest needs both, and says which slot each goes in: the
 * floppy boots (`fda`), the volume is the first fixed disk (`hda`). The program lives on the
 * volume ONLY -- that is the whole point. Putting it on the floppy as well would keep the
 * 1.35 MB ceiling that this function exists to remove.
 */
export async function buildProgramSet(
  p: DosProgram,
): Promise<{ boot: Uint8Array; disk: Uint8Array; bootSlot: 'fda'; diskSlot: 'hda' }> {
  const { system, boot: base } = await loadBase();
  const name = fileName83(p);
  const { disk } = buildFat16({
    sizeMB: volumeSizeMB(p.data.length),
    label: 'NOVA',
    files: [{ name, data: p.data }, ...(p.files ?? [])],
  });
  const boot = buildFloppy({
    name: 'BOOTER',
    ext: 'COM',
    /*
     * An empty program: this floppy's job is to boot and hand over to C:. `buildFloppy`
     * always writes a program file, and a zero-byte one costs a single cluster and is never
     * run.
     */
    data: new Uint8Array(0),
    extra: system,
    autoexec: hardDiskAutoexec(name),
    bootFrom: base,
  });
  return { boot, disk, bootSlot: 'fda', diskSlot: 'hda' };
}
