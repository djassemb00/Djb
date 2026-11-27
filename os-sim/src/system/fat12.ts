/**
 * FAT12 floppy writer — this is what turns a dropped program into a running one.
 *
 * We do not ship Windows and we do not emulate a Windows desktop. Instead the app
 * takes the user's DOS program, writes it into a real 1.44 MB floppy image (the
 * same geometry as our FreeDOS boot disk: 512-byte sectors, 2 sectors/cluster,
 * two FATs of 9 sectors, 224 root entries), adds an AUTOEXEC.BAT that starts it,
 * and boots that disk in the machine.
 *
 * That is a full, honest "run a PC program" path with no Wine, no licence
 * problem, and no desktop to click through: the program is the whole session.
 *
 * Reference layout (BPB read from our own freedos-boot.img, not guessed):
 *   reserved 1 · 2 FATs × 9 sectors · 224 root entries (14 sectors) · data @ 16896
 */
export interface FloppyOptions {
  /** 8.3 name, without extension, e.g. "TETRIS" or "MYPROG" */
  name?: string;
  /** extension without dot, defaults to EXE */
  ext?: string;
  /** the program bytes */
  data: Uint8Array;
  /** extra files written before the program (e.g. its data files) */
  extra?: { name: string; data: Uint8Array }[];
  /** command AUTOEXEC runs; defaults to the program name */
  command?: string;
  /** full AUTOEXEC.BAT body (multi-line); overrides `command` when present */
  autoexec?: string;
  /**
   * A bootable image to take the boot sector *code* from (its BPB is also
   * copied). Writing a BPB without boot code produces a disk the BIOS reads and
   * then hangs on — measured: SeaBIOS stops at "Booting from Floppy...".
   */
  bootFrom?: Uint8Array;
}

const SECTOR = 512;
const SECTORS = 2880;
const RESERVED = 1;
const FAT_COUNT = 2;
const FAT_SECTORS = 9;
const ROOT_ENTRIES = 224;
const SPC = 2; // 1024-byte clusters
const ROOT_SECTORS = (ROOT_ENTRIES * 32) / SECTOR; // 14
const ROOT_START = (RESERVED + FAT_COUNT * FAT_SECTORS) * SECTOR; // 9728
const DATA_START = ROOT_START + ROOT_SECTORS * SECTOR; // 16896
const CLUSTER_BYTES = SPC * SECTOR;
const TOTAL_CLUSTERS = (SECTORS - (DATA_START / SECTOR)) / SPC; // 2847

/** largest file that still fits in one floppy */
export const FLOPPY_MAX_FILE = (TOTAL_CLUSTERS - 1) * CLUSTER_BYTES;

function sanitize(name: string, ext: string): { base: string; ext: string } {
  const clean = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 8) || 'PROGRAM';
  const e = ext.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'EXE';
  return { base: clean(name), ext: e };
}

/** Write a 12-bit FAT entry, preserving the neighbour nibble. */
function setFatEntry(fat: Uint8Array, index: number, value: number) {
  const off = index + Math.floor(index / 2);
  if (index & 1) {
    fat[off] = (fat[off] & 0x0f) | ((value << 4) & 0xf0);
    fat[off + 1] = (value >> 4) & 0xff;
  } else {
    fat[off] = value & 0xff;
    fat[off + 1] = (fat[off + 1] & 0xf0) | ((value >> 8) & 0x0f);
  }
}

export function buildFloppy(opts: FloppyOptions): Uint8Array {
  const disk = new Uint8Array(SECTORS * SECTOR);
  const dv = new DataView(disk.buffer);

  if (opts.bootFrom && opts.bootFrom.length >= SECTOR) {
    disk.set(opts.bootFrom.subarray(0, SECTOR), 0);
  } else {
  /* ---- boot sector (BPB) ---- */
  disk.set([0xeb, 0x3c, 0x90], 0);
  disk.set(new TextEncoder().encode('NOVAAPPS'), 3); // OEM name
  dv.setUint16(11, SECTOR, true); // bytes per sector
  disk[13] = SPC; // sectors per cluster
  dv.setUint16(14, RESERVED, true); // reserved sectors
  disk[16] = FAT_COUNT;
  dv.setUint16(17, ROOT_ENTRIES, true);
  dv.setUint16(19, SECTORS, true); // total sectors (16-bit)
  disk[21] = 0xf0; // media descriptor: 1.44 MB
  dv.setUint16(22, FAT_SECTORS, true);
  dv.setUint16(24, 18, true); // sectors per track
  dv.setUint16(26, 2, true); // heads
  dv.setUint32(28, 0, true); // hidden sectors
  dv.setUint32(32, 0, true); // total sectors 32-bit
  disk[36] = 0x00; // drive number
  disk[38] = 0x29; // extended boot signature
  dv.setUint32(39, 0x4e4f5641, true); // volume id "NOVA"
  disk.set(new TextEncoder().encode('NOVAAPP    '), 43); // volume label (11)
  disk.set(new TextEncoder().encode('FAT12   '), 54);
  disk[510] = 0x55;
  disk[511] = 0xaa;
  }

  /* ---- FATs ---- */
  const fat = new Uint8Array(FAT_SECTORS * SECTOR);
  fat[0] = 0xf0;
  fat[1] = 0xff;
  fat[2] = 0xff; // cluster 0/1 reserved
  let nextCluster = 2;

  /* ---- files ---- */
  const files: { name: string; data: Uint8Array }[] = [];
  const { base, ext } = sanitize(opts.name ?? 'PROGRAM', opts.ext ?? 'EXE');
  for (const e of opts.extra ?? []) {
    const s = sanitize(e.name.replace(/\.[^.]*$/, ''), e.name.split('.').pop() ?? 'DAT');
    files.push({ name: `${s.base}.${s.ext}`, data: e.data });
  }
  files.push({ name: `${base}.${ext}`, data: opts.data });
  // AUTOEXEC last, after we know the program name
  const command = opts.command ?? `${base}.${ext}`;
  const script =
    opts.autoexec ??
    '@ECHO OFF\r\n' +
      'PROMPT $P$G\r\n' +
      'SET TEMP=A:\\\r\n' +
      'SET TMP=A:\\\r\n' +
      `ECHO Starting ${command} ...\r\n` +
      `${command}\r\n` +
      'ECHO.\r\n' +
      'ECHO Program ended. Type DIR to list the disk.\r\n';
  const autoexec = new TextEncoder().encode(script);
  files.push({ name: 'AUTOEXEC.BAT', data: autoexec });

  let rootSlot = 0;
  for (const f of files) {
    if (f.data.length > FLOPPY_MAX_FILE) {
      throw new Error(`الملف كبير جداً على قرص مرن: ${f.name}`);
    }
    const clusters = Math.max(1, Math.ceil(f.data.length / CLUSTER_BYTES));
    const first = nextCluster;
    for (let i = 0; i < clusters; i++) {
      setFatEntry(fat, nextCluster, i === clusters - 1 ? 0xfff : nextCluster + 1);
      nextCluster++;
    }
    // data lands in consecutive clusters starting at `first`
    for (let i = 0; i < clusters; i++) {
      const at = DATA_START + (first - 2 + i) * CLUSTER_BYTES;
      disk.set(f.data.subarray(i * CLUSTER_BYTES, (i + 1) * CLUSTER_BYTES), at);
    }
    // root directory entry, 8.3 padded
    const [n, e] = f.name.split('.');
    const ent = ROOT_START + rootSlot * 32;
    disk.set(pad(n, 8), ent);
    disk.set(pad(e ?? '', 3), ent + 8);
    disk[ent + 11] = 0x20; // archive
    dv.setUint16(ent + 26, first, true); // first cluster
    dv.setUint32(ent + 28, f.data.length, true);
    rootSlot++;
  }
  disk.set(fat, RESERVED * SECTOR);
  disk.set(fat, (RESERVED + FAT_SECTORS) * SECTOR);

  return disk;
}

function pad(s: string, n: number): Uint8Array {
  const out = new Uint8Array(n).fill(0x20);
  out.set(new TextEncoder().encode(s.slice(0, n)));
  return out;
}
