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
   * A bootable image to take the boot sector *code* from. ONLY the first 3 bytes (the
   * jump instruction) and bytes 62..510 (the boot code) are copied -- the BPB at 0..61
   * is always written by us.
   *
   * Why: the BPB must describe the geometry THIS function writes (2 sectors/cluster,
   * 224 root entries, data at 16896). Copying someone else's BPB over ours makes the
   * disk unreadable: nova-desk.img has no BPB at all (its bytes 11..61 are boot code,
   * which the previous version read as "36544 bytes per sector, 188 reserved sectors"),
   * and kolibri.img has a 4-sector root directory. The old code copied whichever it was
   * given and then wrote the root/FAT/data at OUR offsets anyway.
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
export const ROOT_START = (RESERVED + FAT_COUNT * FAT_SECTORS) * SECTOR; // 9728
export const DATA_START = ROOT_START + ROOT_SECTORS * SECTOR; // 16896
const CLUSTER_BYTES = SPC * SECTOR;
/** exported so callers stop re-deriving it: guest.ts had its own `const CLUSTER = 1024` */
export const CLUSTER = CLUSTER_BYTES;
/** data sectors after the boot/FAT/root area, divided by sectors per cluster */
const DATA_SECTORS = SECTORS - DATA_START / SECTOR; // 2867
/**
 * Cluster numbers available for file data.
 *
 * This used to be `(SECTORS - DATA_START/SECTOR) / SPC` = 2847: it divided by
 * sectors-per-cluster while DATA_SECTORS was already a SECTOR count, so the real
 * number is 1423. The wrong value made FLOPPY_MAX_FILE 1.39 MB instead of 0.69 MB,
 * and a program between the two sizes was accepted and then written past the end of
 * the image -- silently, because TypedArray.set swallows that by design.
 * Geometric floor: the last cluster must still fit inside the image.
 */
export const TOTAL_CLUSTERS = Math.floor(DATA_SECTORS / SPC); // 1423
/**
 * Highest cluster NUMBER the geometry allows.
 *
 * DATA_START / SECTOR = 33 data sectors-before-data... precisely: data starts at sector
 * 33, so cluster n begins at byte DATA_START + (n-2)*1024. The image ends at 1474560, so
 * the last cluster that fits is floor((1474560-16896)/1024) + 1 = 1424. Writing cluster
 * 1425 or above lands outside the image.
 */
export const MAX_CLUSTER = Math.floor((SECTORS * SECTOR - DATA_START) / CLUSTER_BYTES) + 1; // 1424
/** usable clusters = 2..MAX_CLUSTER inclusive */
export const USABLE_CLUSTERS = MAX_CLUSTER - 1; // 1423

/** largest file that still fits next to nothing else on one floppy */
export const FLOPPY_MAX_FILE = (USABLE_CLUSTERS - 1) * CLUSTER_BYTES; // 1_456_640

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

/**
 * Write the BIOS Parameter Block that describes the layout this module produces.
 *
 * One function, called by both branches, so the BPB can never describe a geometry other
 * than the one written below it. `oem` is the 8-character name at offset 3.
 */
function writeBpb(dv: DataView, disk: Uint8Array, ownOem: boolean) {
  if (ownOem) disk.set(new TextEncoder().encode('NOVAAPPS'), 3); // OEM name
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
}

export function buildFloppy(opts: FloppyOptions): Uint8Array {
  const disk = new Uint8Array(SECTORS * SECTOR);
  const dv = new DataView(disk.buffer);

  const tookCode = !!(opts.bootFrom && opts.bootFrom.length >= SECTOR);
  if (tookCode) {
    /*
     * Keep the boot CODE, write our own BPB.
     *
     * The previous version copied the donor's whole boot sector, BPB included, and then
     * wrote the FAT, the root directory and the data at OUR fixed offsets -- which are
     * derived from OUR BPB. A donor with a different BPB produced a disk where the BPB
     * and the layout disagree, i.e. one no system can read. nova-desk.img is exactly
     * that case: it has no BPB at all (no 0xEB jump, no 55AA), so its boot code bytes at
     * 11..61 were being copied in as "36544 bytes/sector, 188 reserved sectors".
     */
    const src = opts.bootFrom as Uint8Array;
    disk.set(src.subarray(0, 3), 0);
    disk.set(src.subarray(62, 510), 62);
    disk[510] = 0x55;
    disk[511] = 0xaa;
    writeBpb(dv, disk, false);
  } else {
    disk.set([0xeb, 0x3c, 0x90], 0);
    writeBpb(dv, disk, true);
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
  const autoexecEntry = { name: 'AUTOEXEC.BAT', data: autoexec };
  if (files.some((f) => f.name === autoexecEntry.name)) {
    /*
     * Two root entries with the same 8.3 name. DOS resolves the FIRST match and every
     * later one is dead; here it meant the program bytes were written under a name the
     * shell would never find (measured: a program called AUTOEXEC.BAT produced two
     * entries, and trying to run it ran our script instead). Refuse instead.
     */
    throw new Error('الاسم AUTOEXEC.BAT محجوز لسكربت الإقلاع — أعد تسمية الملف');
  }
  files.push(autoexecEntry);

  // no two entries may share a name: the second would be unreachable on a real DOS
  const seen = new Set<string>();
  for (const f of files) {
    const key = f.name.toUpperCase();
    if (seen.has(key)) throw new Error(`اسمان متطابقان على القرص: ${f.name}`);
    seen.add(key);
  }

  // The root directory holds ROOT_ENTRIES files and nothing more; a 225th write used to
  // land on ROOT_START + 224*32 == DATA_START, i.e. straight into the data area, quietl
  // corrupting cluster 2. A real floppy is full at 224 entries, so say that.
  if (files.length > ROOT_ENTRIES) {
    throw new Error(
      `ملفات كثيرة جداً على قرص مرن: ${files.length} والدليل الجذري يتّسع لـ${ROOT_ENTRIES} فقط`,
    );
  }

  let rootSlot = 0;
  for (const f of files) {
    if (f.data.length > FLOPPY_MAX_FILE) {
      throw new Error(`الملف كبير جداً على قرص مرن: ${f.name}`);
    }
    const clusters = Math.max(1, Math.ceil(f.data.length / CLUSTER_BYTES));
    // running total, not a per-file check: several files can each be legal and still
    // run past the end of the disk together
    if (nextCluster + clusters - 1 > MAX_CLUSTER) {
      const wroteMb = ((nextCluster - 2) * CLUSTER_BYTES / 1048576).toFixed(2);
      throw new Error(
        `القرص المرن امتلأ: الكتلة التالية ${nextCluster} تتجاوز آخر كتلة ${MAX_CLUSTER} ` +
          `(المكتوب ${wroteMb} ميغا، والملف التالي ${(f.data.length / 1048576).toFixed(2)} ميغا)`,
      );
    }
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
