/**
 * PLAN ٥-٢: a FAT16 hard disk, so a program is no longer capped at 1.44 MB.
 *
 * The floppy writer (`fat12.ts`) is the product's working path and it has a hard ceiling:
 * 1423 clusters of 1024 bytes, minus the FreeDOS system files, leaves about 1.35 MB for the
 * user's program. Anything real is bigger. PLAN.md's acceptance test is "20 games on one
 * disk, the menu works, boot under 3 s" -- this module is the disk that makes that possible.
 *
 * Why FAT16 and not FAT32: 32–64 MB is the intended size, and FAT16 covers up to 2 GB with
 * 32 KB clusters. FAT32 would add a second FAT type to write, test and get wrong for no
 * benefit at this size. Clusters are 2 KB here so a 64 MB volume stays under the 4085-cluster
 * threshold below which a driver is REQUIRED to mount the volume as FAT12 -- a subtle way to
 * produce a disk that formats and then boots wrong.
 *
 * The two layouts are separate on purpose. `fat12.ts` is proven by booting in v86; rewriting
 * it to share code with an unproven module would risk the working path to save bytes at a
 * moment when the budget has 10 KB left. Shared knowledge is shared here as comments and
 * constants, not as control flow.
 */
const SECTOR = 512;

/**
 * The most clusters a FAT16 volume may have. Past this a driver is required to treat the
 * volume as FAT32, so a bigger "FAT16" volume is not FAT16 at all.
 */
export const MAX_CLUSTERS = 65525;

export interface Fat16Options {
  /** volume size in MB; 32..64 is the tested range */
  sizeMB: number;
  /** volume label, max 11 ASCII characters */
  label?: string;
  files: { name: string; data: Uint8Array }[];
}

/** What the layout actually is, so callers and tests never re-derive it. */
export interface Fat16Layout {
  sizeMB: number;
  sectors: number;
  bytesPerSector: number;
  sectorsPerCluster: number;
  reservedSectors: number;
  fatCount: number;
  rootEntries: number;
  sectorsPerFat: number;
  /** byte offset of the first FAT, INCLUDING the partition offset */
  fatStart: number;
  /** sector where the FAT16 volume begins (after the MBR) */
  partitionStart: number;
  /** byte offset of the root directory */
  rootStart: number;
  /** byte offset of cluster 2 (the first data cluster) */
  dataStart: number;
  clusterBytes: number;
  /** total clusters including 0 and 1 */
  clusters: number;
  /** highest cluster number that may hold data */
  lastCluster: number;
}

/**
 * Compute the layout without writing anything.
 *
 * Split out because a wrong `sectorsPerFat` is invisible until a real driver reads the
 * volume: the write "succeeds", the disk looks fine, and the boot fails with a message no
 * one can act on. The formula is the one Microsoft's FAT specification gives -- the fixed
 * point of `sectorsPerFat`, solved by iterating twice because it appears on both sides.
 */
/**
 * Sectors before the partition. A hard disk that FreeDOS will accept needs an MBR at
 * sector 0 and a partition entry pointing at a VBR elsewhere; "illegal partition table" is
 * what the kernel printed on the first attempt, when this module wrote the BPB at sector 0
 * as if the disk were a giant floppy. 2048 sectors (1 MB) is the conventional alignment.
 */
export const PARTITION_START = 2048;

export function layoutFor(sizeMB: number, sectorsPerCluster = 4, rootEntries = 512): Fat16Layout {
  // the partition holds (sizeMB - 1) MB: the first MB carries the MBR and the gap
  const sectors = (sizeMB - 1) * 2048; // 1 MB = 2048 sectors of 512 bytes
  const reservedSectors = 1;
  const fatCount = 2;
  // FAT16 entry = 2 bytes. Solve spf = ceil((sectors - reserved + root*32/512) / (spc*512/2 + fatCount))
  const rootSectors = Math.ceil((rootEntries * 32) / SECTOR);
  let sectorsPerFat = 1;
  for (let i = 0; i < 4; i++) {
    const dataSectors = sectors - reservedSectors - fatCount * sectorsPerFat - rootSectors;
    const clusters = Math.floor(dataSectors / sectorsPerCluster) + 2; // +2 for entries 0 and 1
    sectorsPerFat = Math.ceil((clusters * 2) / SECTOR);
  }
  /*
   * A volume above 65525 clusters is not FAT16 any more -- a driver is required to mount it
   * as FAT32 -- so the cluster count is the hard ceiling, not the byte size in MB. Measured:
   * 128 MB gives 64890 clusters and is legal, 130 MB gives 65912 and is not. Without this
   * check the builder happily wrote a "FAT16" volume that no driver may mount as FAT16, and
   * the only symptom would be a guest that fails to read a disk we reported as built.
   *
   * The way past it is bigger clusters (32 KB reaches 2 GB) -- untested here, so not done.
   */
  const partBytes = PARTITION_START * SECTOR;
  const fatStart = partBytes + reservedSectors * SECTOR;
  const rootStart = partBytes + (reservedSectors + fatCount * sectorsPerFat) * SECTOR;
  const dataStart = rootStart + rootSectors * SECTOR;
  const clusterBytes = sectorsPerCluster * SECTOR;
  const clusters = Math.floor((sectors * SECTOR + partBytes - dataStart) / clusterBytes) + 2;
  if (clusters > MAX_CLUSTERS) {
    /*
     * Refuse instead of writing. A driver is REQUIRED to treat >65525 clusters as FAT32, so
     * the disk would construct, "succeed", and then fail in the guest for a reason no message
     * would explain. Measured: 128 MB = 64890 clusters (legal), 130 MB = 65912 (not).
     * The route past this is 32 KB clusters, which reaches 2 GB -- untested, so not offered.
     */
    throw new Error(
      `حجم ${sizeMB} ميغا يعطي ${clusters} كتلة، وحدّ FAT16 هو ${MAX_CLUSTERS}. ` +
        'أكبر حجم FAT16 بهذه الكتل هو 128 ميغا.',
    );
  }
  return {
    partitionStart: PARTITION_START,
    sizeMB,
    sectors,
    bytesPerSector: SECTOR,
    sectorsPerCluster,
    reservedSectors,
    fatCount,
    rootEntries,
    sectorsPerFat,
    fatStart,
    rootStart,
    dataStart,
    clusterBytes,
    clusters,
    lastCluster: clusters - 1,
  };
}

function pad(s: string, n: number): Uint8Array {
  const out = new Uint8Array(n).fill(0x20);
  out.set(new TextEncoder().encode(s.slice(0, n)));
  return out;
}

/** 8.3 name, uppercased, invalid characters dropped. */
function split83(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  const clean = (s: string, n: number) =>
    s.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, n) || '';
  return { base: clean(stem, 8) || 'PROGRAM', ext: clean(ext, 3) };
}

/**
 * Write a FAT16 volume.
 *
 * Every limit is checked BEFORE a byte is written, and the error names the offending file
 * and the numbers involved -- `fat12.ts` learned this the hard way: a 225th root entry used
 * to land in the data area and corrupt cluster 2 silently.
 */
export function buildFat16(opts: Fat16Options): { disk: Uint8Array; layout: Fat16Layout } {
  const layout = layoutFor(opts.sizeMB);
  const { sectors, sectorsPerCluster, fatCount, rootEntries, sectorsPerFat, rootStart, dataStart, clusterBytes, lastCluster } = layout;

  if (opts.files.length > rootEntries) {
    throw new Error(
      `ملفات كثيرة جداً: ${opts.files.length} والدليل الجذري يتّسع لـ${rootEntries} فقط`,
    );
  }

  // names first: two identical 8.3 names would make the second unreachable, and DOS
  // resolves the FIRST match, so the failure would look like a missing file
  const seen = new Set<string>();
  for (const f of opts.files) {
    const { base, ext } = split83(f.name);
    const key = `${base}.${ext}`;
    if (seen.has(key)) throw new Error(`اسمان متطابقان على القرص: ${key} (من ${f.name})`);
    seen.add(key);
  }

  const disk = new Uint8Array(sectors * SECTOR + PARTITION_START * SECTOR);
  const dv = new DataView(disk.buffer);

  /* ---- MBR at sector 0 ---- */
  /*
   * FreeDOS 2040 reads a hard disk's partition table before it will look at any volume;
   * with a bare BPB at sector 0 it prints "illegal partition table - drive 00" four times
   * and never assigns a letter (measured in v86, screens captured in AUDIT A83). One
   * primary partition, type 0x06 (FAT16, 16-bit sector count), active.
   */
  const pe = 446; // first partition entry
  disk[pe] = 0x80; // bootable flag
  /*
   * Zero CHS fields + type 0x0E, not 0x06.
   *
   * Measured in v86: with type 0x06 FreeDOS mounted C: and listed the directory correctly
   * ("BIG EXE 300,000"), then failed the first DATA read -- "Error reading from drive C: DOS
   * area: unknown command given to driver", i.e. it had converted the LBA into CHS using
   * geometry the BIOS does not implement. 0x0E means "FAT16, LBA-mapped": DOS issues
   * extended reads and never computes a head/track. The CHS fields are left at 0x00 because
   * FreeDOS warns "using suspect partition ... instead of 0-1-1" when they disagree with the
   * LBA, and a warning that says our own table is inconsistent is worse than zeroes.
   */
  /*
   * The CHS triplets are filled in from the same geometry the BPB declares (16 heads, 63
   * sectors/track), because FreeDOS cross-checks them: with zeroes it printed "using suspect
   * partition Pri:1 FS 0e: with calculated values 2-0-33 instead of 0-0-0" -- a warning that
   * the table and the LBA disagree. It still mounted, but a disk that mounts with a warning
   * is a disk whose table is wrong and merely tolerated, and the next driver may not be so
   * forgiving.
   */
  const chs = (lba: number): [number, number, number] => {
    const spt = 63;
    const heads = 16;
    const cyl = Math.floor(lba / (spt * heads));
    const rem = lba % (spt * heads);
    const head = Math.floor(rem / spt);
    const sector = (rem % spt) + 1;
    return [head, sector | ((cyl >> 2) & 0xc0), cyl & 0xff];
  };
  const [sh, ss, sc] = chs(PARTITION_START);
  disk[pe + 1] = sh;
  disk[pe + 2] = ss;
  disk[pe + 3] = sc;
  disk[pe + 4] = 0x0e; // type: FAT16, LBA-mapped
  const [eh, es, ec] = chs(PARTITION_START + Math.min(sectors, 0xffff) - 1);
  disk[pe + 5] = eh;
  disk[pe + 6] = es;
  disk[pe + 7] = ec;
  dv.setUint32(pe + 8, PARTITION_START, true); // LBA of first sector
  /*
   * The full 32-bit sector count, clamped only to the field's own width.
   *
   * This used to be Math.min(sectors, 0xffff) -- a 16-bit clamp that belongs to type 0x06,
   * the CHS-only type. We write 0x0E, an LBA type, where this field is a 32-bit count. The
   * clamp truncated every volume over 33.5 MB to half its size, and nothing noticed: the
   * backing image was still the full length, so the guest mounted 33 MB of a 64 MB disk and
   * every byte past that was unreachable-but-present. A 64 MB test asserting "the disk is
   * 64 MB" passed anyway because it measured the buffer, not the table.
   */
  dv.setUint32(pe + 12, Math.min(sectors, 0xffffffff), true);
  disk[510] = 0x55;
  disk[511] = 0xaa;

  /* ---- boot sector + BPB, at the partition start ---- */
  const P = PARTITION_START * SECTOR;
  disk.set([0xeb, 0x3c, 0x90], P);
  disk.set(new TextEncoder().encode('NOVAFAT '), P + 3); // OEM
  dv.setUint16(P + 11, SECTOR, true);
  disk[P + 13] = sectorsPerCluster;
  dv.setUint16(P + 14, layout.reservedSectors, true);
  disk[P + 16] = fatCount;
  dv.setUint16(P + 17, rootEntries, true);
  // total sectors: 16-bit field only when it fits, else the 32-bit field at 32
  if (sectors < 65536) {
    dv.setUint16(P + 19, sectors, true);
    dv.setUint32(P + 32, 0, true);
  } else {
    dv.setUint16(P + 19, 0, true);
    dv.setUint32(P + 32, sectors, true);
  }
  disk[P + 21] = 0xf8; // fixed disk, not removable
  dv.setUint16(P + 22, sectorsPerFat, true);
  /*
   * 63 sectors/track and 16 heads: the geometry SeaBIOS gives a disk of this size, and the
   * one FreeDOS derives when it validates the partition table. The first version wrote
   * 32/64, which produced the "suspect partition" warnings.
   */
  dv.setUint16(P + 24, 63, true);
  dv.setUint16(P + 26, 16, true);
  /*
   * Hidden sectors = the partition start. This is the BPB's own record of where the volume
   * lives, and a driver may use it instead of the partition table to translate a cluster to
   * an absolute sector. Leaving it 0 on a partitioned disk is only invisible until the first
   * data read.
   */
  dv.setUint32(P + 28, PARTITION_START, true);
  disk[P + 36] = 0x80; // drive number: first fixed disk
  disk[P + 38] = 0x29; // extended boot signature
  dv.setUint32(P + 39, 0x4e4f5641, true); // volume id "NOVA"
  disk.set(pad(opts.label ?? 'NOVA DISK', 11), P + 43);
  disk.set(pad('FAT16', 8), P + 54);
  // a volume boot record without 55AA is not a volume; FreeDOS reads this before the BPB
  disk[P + 510] = 0x55;
  disk[P + 511] = 0xaa;

  /* ---- FATs ---- */
  const fatBytes = sectorsPerFat * SECTOR;
  const fat = new Uint8Array(fatBytes);
  const setFat = (i: number, v: number) => dvFat.setUint16(i * 2, v, true);
  const dvFat = new DataView(fat.buffer);
  setFat(0, 0xfff8); // media descriptor f8 for a fixed disk
  setFat(1, 0xffff);

  /* ---- files ---- */
  let nextCluster = 2;
  let rootSlot = 0;
  const written: { name: string; first: number; size: number }[] = [];
  for (const f of opts.files) {
    const { base, ext } = split83(f.name);
    const clusters = Math.max(1, Math.ceil(f.data.length / clusterBytes));
    if (nextCluster + clusters - 1 > lastCluster) {
      const usedMb = ((nextCluster - 2) * clusterBytes) / 1048576;
      throw new Error(
        `القرص امتلأ عند ${f.name}: يحتاج ${clusters} كتلة والحر ${lastCluster - nextCluster + 1} ` +
          `(المكتوب ${usedMb.toFixed(1)} ميغا من ${opts.sizeMB})`,
      );
    }
    const first = nextCluster;
    for (let i = 0; i < clusters; i++) {
      setFat(nextCluster, i === clusters - 1 ? 0xffff : nextCluster + 1);
      nextCluster++;
    }
    for (let i = 0; i < clusters; i++) {
      const at = dataStart + (first - 2 + i) * clusterBytes;
      disk.set(f.data.subarray(i * clusterBytes, (i + 1) * clusterBytes), at);
    }
    const ent = rootStart + rootSlot * 32;
    disk.set(pad(base, 8), ent);
    disk.set(pad(ext, 3), ent + 8);
    disk[ent + 11] = 0x20; // archive
    // a valid DOS timestamp: 2026-11-27 12:00. Zeroes render as "00-00-80" in DIR, which
    // looks like corruption to anyone reading the listing to confirm the disk works.
    dv.setUint16(ent + 22, (12 << 11) | (0 << 5) | 0, true); // time
    dv.setUint16(ent + 24, ((2026 - 1980) << 9) | (11 << 5) | 27, true); // date
    dv.setUint16(ent + 26, first, true);
    dv.setUint32(ent + 28, f.data.length, true);
    written.push({ name: `${base}.${ext}`, first, size: f.data.length });
    rootSlot++;
  }

  // both FATs, byte identical: a driver may use either
  disk.set(fat, layout.fatStart);
  disk.set(fat, layout.fatStart + fatBytes);

  return { disk, layout };
}

/**
 * Read a file back out of a volume this module wrote.
 *
 * Used by the round-trip test, and by nothing in the app: it exists so "the bytes are on
 * the disk" can be asserted by parsing the disk rather than by trusting the writer.
 */
/**
 * The on-disk shape of "a program plus the volume it runs from".
 *
 * ٥-٢ gives a launched program TWO images: a boot floppy (which must be the boot disk) and
 * a FAT16 volume (which cannot boot). Installed programs persist as one IndexedDB record, so
 * the two have to travel together: a 4-byte tag, the boot length, then the boot bytes, then
 * the volume. A tag rather than "floppy is always 1474560" because that literal would be a
 * second copy of `fat12.ts`'s geometry, and a copy is what goes stale.
 */
const SET_TAG = 0x4e563032; // "NV02"

export function encodeBootSet(boot: Uint8Array, volume: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + boot.byteLength + volume.byteLength);
  new DataView(out.buffer).setUint32(0, SET_TAG, true);
  new DataView(out.buffer).setUint32(4, boot.byteLength, true);
  out.set(boot, 8);
  out.set(volume, 8 + boot.byteLength);
  return out;
}

export interface BootSet {
  boot: Uint8Array;
  volume: Uint8Array;
}

/** Read back what `encodeBootSet` wrote, or null if these bytes are just a single disk. */
export function decodeBootSet(bytes: Uint8Array): BootSet | null {
  if (bytes.byteLength < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== SET_TAG) return null;
  const bootLen = dv.getUint32(4, true);
  if (bootLen === 0 || 8 + bootLen >= bytes.byteLength) return null;
  return {
    boot: bytes.subarray(8, 8 + bootLen),
    volume: bytes.subarray(8 + bootLen),
  };
}

export function readFat16File(disk: Uint8Array, name: string): Uint8Array | null {
  const dv = new DataView(disk.buffer, disk.byteOffset, disk.byteLength);
  // the volume may sit at offset 0 (a plain volume) or after an MBR; find it by looking
  // for the BPB's own signature rather than assuming either layout
  const partLba = dv.getUint32(446 + 8, true);
  const P = partLba > 0 && partLba < disk.length / SECTOR ? partLba * SECTOR : 0;
  const sectorsPerFat = dv.getUint16(P + 22, true);
  const rootEntries = dv.getUint16(P + 17, true);
  const spc = disk[P + 13];
  const fatCount = disk[P + 16];
  const reserved = dv.getUint16(P + 14, true);
  const rootStart = P + (reserved + fatCount * sectorsPerFat) * SECTOR;
  const dataStart = rootStart + Math.ceil((rootEntries * 32) / SECTOR) * SECTOR;
  const clusterBytes = spc * SECTOR;

  const { base, ext } = split83(name);
  for (let i = 0; i < rootEntries; i++) {
    const ent = rootStart + i * 32;
    if (disk[ent] === 0x00) return null; // end of directory
    if (disk[ent] === 0xe5) continue; // deleted
    if (disk[ent + 11] & 0x08) continue; // volume label
    const entBase = String.fromCharCode(...disk.subarray(ent, ent + 8)).trimEnd();
    const entExt = String.fromCharCode(...disk.subarray(ent + 8, ent + 11)).trimEnd();
    if (entBase !== base || entExt !== ext) continue;

    const size = dv.getUint32(ent + 28, true);
    const first = dv.getUint16(ent + 26, true);
    const out = new Uint8Array(size);
    let cluster = first;
    let at = 0;
    // a corrupt chain would loop forever; the cluster count bounds it
    const maxHops = Math.ceil(size / clusterBytes) + 2;
    for (let hop = 0; hop < maxHops && at < size; hop++) {
      const read = Math.min(clusterBytes, size - at);
      out.set(disk.subarray(dataStart + (cluster - 2) * clusterBytes, dataStart + (cluster - 2) * clusterBytes + read), at);
      at += read;
      const fatOff = P + reserved * SECTOR + cluster * 2;
      cluster = dv.getUint16(fatOff, true);
      if (cluster >= 0xfff8) break;
    }
    return out;
  }
  return null;
}
