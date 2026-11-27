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
import { buildFloppy, FLOPPY_MAX_FILE } from './fat12';

const CLUSTER = 1024;
const DATA_START = 16896;
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
}

let cache: { system: { name: string; data: Uint8Array }[]; boot: Uint8Array } | null = null;

async function loadBase() {
  if (cache) return cache;
  const res = await fetch('./images/freedos-boot.img');
  if (!res.ok) throw new Error('تعذّر تحميل ملفات نظام DOS المرفقة');
  const boot = new Uint8Array(await res.arrayBuffer());
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
    throw new Error(
      `البرنامج ${(p.data.length / 1048576).toFixed(2)} ميغا، والمساحة الحرة على قرص المرن ` +
        `${(free / 1048576).toFixed(2)} ميغا. البرامج الأكبر تحتاج قرصاً صلباً (الخطوة التالية).`,
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
