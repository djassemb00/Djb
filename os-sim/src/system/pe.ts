/**
 * PE (.exe / .dll) inspection — the front door of the whole product.
 *
 * The user's goal is to run computer *applications*, not to look at a Windows
 * desktop. Before promising anything about a .exe, we must be able to answer three
 * questions in the browser, with no backend:
 *   1. Is this really a Windows executable?           (DOS stub + PE header)
 *   2. Which machine is it built for?                 (i386 / x86-64 / ARM64)
 *   3. Which Windows features does it import?         (Win32 GUI vs console vs .NET)
 *
 * Question 3 is what lets us say "this may work" instead of "try and see": a
 * program importing only kernel32/user32/gdi32 is a 1990s-style Win32 app, while
 * one importing mscoree.dll needs .NET and cannot run in our layer at all.
 */
export interface PEInfo {
  ok: boolean;
  reason?: string;
  peOffset?: number;
  machine?: string;
  machineId?: number;
  is64?: boolean;
  isDll?: boolean;
  isDotNet?: boolean;
  subsystem?: 'gui' | 'console' | 'other';
  sectionCount?: number;
  imageSize?: number;
  timestamp?: number;
  /** DLL names the program needs, upper-cased, de-duplicated */
  imports: string[];
  /** our verdict for this engine, with the reason attached */
  verdict: 'native-32' | 'native-64' | 'dotnet' | 'arm' | 'unknown';
  verdictText: string;
}

const MACHINES: Record<number, string> = {
  0x014c: 'i386 (32-bit)',
  0x8664: 'x86-64 (64-bit)',
  0x01c0: 'ARM',
  0x01c4: 'ARMv7',
  0xaa64: 'ARM64',
  0x0200: 'IA-64',
};

/**
 * Section names that conventionally hold the import table.
 *
 * Kept only as a FALLBACK for files whose data directory was stripped. Locating imports
 * by section name alone was the original bug: MSVC puts .idata early and shifts it on
 * every link, and a section can be called anything (`.rdata`, `_RDATA`, nothing). Real
 * perf test: `complex-msvc2019-x64-O2.exe` has .idata as its SIXTH section and yielded
 * zero imports; the 32-bit pair yielded function names as "DLL names".
 */
const IDATA_NAMES = ['.idata'];

/** DLLs that mean ".NET managed code" rather than Win32 */
const DOTNET = ['MSCOREE.DLL', 'CLR.DLL', 'COREEXPORT.DLL'];

export function inspectPE(bytes: Uint8Array): PEInfo {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 0x40) return { ok: false, reason: 'الملف أصغر من أن يكون تنفيذياً', imports: [], verdict: 'unknown', verdictText: 'ملف غير معروف' };
  if (bytes[0] !== 0x4d || bytes[1] !== 0x5a) {
    return { ok: false, reason: 'لا يحمل توقيع MZ — ليس ملف DOS/Windows تنفيذياً', imports: [], verdict: 'unknown', verdictText: 'ليس ملف .exe' };
  }
  const peOffset = dv.getUint32(0x3c, true);
  if (peOffset + 24 > bytes.length || dv.getUint32(peOffset, true) !== 0x00004550) {
    return { ok: false, reason: 'لا يوجد ترويسة PE (ملف DOS خالص؟)', peOffset, imports: [], verdict: 'unknown', verdictText: 'برنامج DOS قديم' };
  }

  const machineId = dv.getUint16(peOffset + 4, true);
  const sectionCount = dv.getUint16(peOffset + 6, true);
  const timestamp = dv.getUint32(peOffset + 8, true);
  const optSize = dv.getUint16(peOffset + 20, true);
  const characteristics = dv.getUint16(peOffset + 22, true);
  const opt = peOffset + 24;
  // The optional header must at least be present before we read magic/subsystem out of
  // it. Without this, a file whose PE header is the last 24 bytes is read past the end:
  // DataView clamps, so it silently reports machine i386 and "native-32" instead of
  // failing -- a truncated download looked like a real Win32 program.
  if (opt + 4 > bytes.length) {
    return { ok: false, reason: 'ترويسة PE مبتورة — الملف ناقص', peOffset, imports: [], verdict: 'unknown', verdictText: 'ملف ناقص' };
  }
  const magic = dv.getUint16(opt, true); // 0x10b = PE32, 0x20b = PE32+
  const is64 = magic === 0x20b;
  // Subsystem is at optional-header offset 68 in BOTH PE32 and PE32+. The fields that
  // DO differ (ImageBase, SizeOfStackReserve, ...) are all before it, which is why this
  // single offset is correct -- keep the note so nobody "fixes" it.
  const subsystem = dv.getUint16(opt + 68, true);
  const imageSize = dv.getUint32(opt + 56, true);

  const sec = opt + optSize;
  // A real PE has its whole section table inside the file. If the table is missing, the
  // file is TRUNCATED (a cancelled download, a disk error), not a valid program with no
  // sections -- and reporting it as "native-32" would be a lie the user acts on.
  if (optSize < 2 || sec + sectionCount * 40 > bytes.length) {
    return {
      ok: false,
      reason: 'جدول الأقسام غير موجود — الملف مبتور',
      peOffset,
      imports: [],
      verdict: 'unknown',
      verdictText: 'ملف ناقص',
    };
  }

  /* ---- imports: use the data directory, not a section name ---- */
  // The import directory (index 1) is an RVA/length pair. Where the PE32 vs PE32+
  // optional header differs is the COUNT field, so the directory base is
  // opt+96 (PE32) or opt+112 (PE32+). Getting this wrong is silent: you read "." (from
  // the optional header) as an RVA and return an empty list.
  const dirStart = opt + (is64 ? 112 : 96);
  let importRva = 0;
  let importSize = 0;
  if (dirStart + 16 <= bytes.length) {
    importRva = dv.getUint32(dirStart + 8, true); // entry 1
    importSize = dv.getUint32(dirStart + 8 + 4, true);
  }

  // fallback: locate a section named .idata (old behaviour, only when the directory is absent)
  let fallbackOff = -1;
  let fallbackSize = 0;
  if (!importRva) {
    for (let i = 0; i < sectionCount; i++) {
      const s = sec + i * 40;
      if (s + 40 > bytes.length) break;
      const name = new TextDecoder().decode(bytes.subarray(s, s + 8)).replace(/\0.*$/, '');
      if (!IDATA_NAMES.includes(name)) continue;
      fallbackOff = dv.getUint32(s + 20, true);
      fallbackSize = dv.getUint32(s + 16, true);
      break;
    }
  }

  // A file whose headers are complete but whose SECTION DATA is missing (a cancelled
  // download at ~1 KB) still parses: the section table is inside the headers, so every
  // structural check passes while the program itself is absent. Compare the largest
  // section payload against the file we actually hold.
  let largestRaw = 0;
  for (let i = 0; i < sectionCount; i++) {
    const s = sec + i * 40;
    const rawPtr = dv.getUint32(s + 20, true);
    const rawSize = dv.getUint32(s + 16, true);
    if (rawSize > 0) largestRaw = Math.max(largestRaw, rawPtr + rawSize);
  }
  if (largestRaw > bytes.length) {
    return {
      ok: false,
      reason: `جسم الملف ناقص: الترويسة تقول ${largestRaw} بايت والمتاح ${bytes.length}`,
      peOffset,
      imports: [],
      verdict: 'unknown',
      verdictText: 'ملف ناقص',
    };
  }

  const imports: string[] = [];
  const dirOff = importRva ? rvaToOffset(dv, bytes, peOffset, sec, sectionCount, importRva) : fallbackOff;
  const dirLen = importRva ? Math.max(importSize, 20) : fallbackSize;
  if (dirOff >= 0) {
    // 20-byte IMAGE_IMPORT_DESCRIPTOR: Name RVA at +12, terminates with an all-zero one.
    // A hostile or corrupt SizeOfImportDirectory (0xFFFFFFFF) must not decide the loop
    // bound: the descriptor table cannot be larger than the bytes we actually hold, and
    // real tables are tiny, so cap it at 64 entries (=1.28 KB of descriptors).
    const declared = Math.max(dirLen, 20);
    const limit = Math.min(dirOff + declared, dirOff + 20 * 64, bytes.length);
    for (let p = dirOff; p + 20 <= limit; p += 20) {
      const nameRva = dv.getUint32(p + 12, true);
      if (nameRva === 0) break; // the required null descriptor
      const nameOff = rvaToOffset(dv, bytes, peOffset, sec, sectionCount, nameRva);
      if (nameOff < 0 || nameOff >= bytes.length) continue;
      let end = nameOff;
      // a DLL name is ASCII and short; anything else means we are in the wrong place
      while (end < bytes.length && bytes[end] !== 0 && end - nameOff < 64) end++;
      const raw = new TextDecoder().decode(bytes.subarray(nameOff, end));
      // sanity: "KERNEL32.dll", "api-ms-win-crt-...dll", never control characters
      if (!/^[\x20-\x7e]{3,63}$/.test(raw)) continue;
      if (!/\.dll$/i.test(raw) && !/\.drv$/i.test(raw) && !/\.ocx$/i.test(raw)) continue;
      const dll = raw.toUpperCase();
      if (!imports.includes(dll)) imports.push(dll);
    }
  }

  const isDll = (characteristics & 0x2000) !== 0;
  // exact DLL name, not a prefix: "MSCOREE.DLL" is .NET, "CLR.DLL" is .NET, but a
  // prefix test on "COREEXPORT.DLL" would also match unrelated CORE*.dll names
  const isDotNet = imports.some((d) => DOTNET.includes(d));

  let verdict: PEInfo['verdict'] = 'unknown';
  let verdictText = 'غير معروف';
  if (isDotNet) {
    verdict = 'dotnet';
    verdictText = 'برنامج .NET — لا يعمل في طبقة Win32 هذه';
  } else if (machineId === 0xaa64 || machineId === 0x01c4 || machineId === 0x01c0) {
    verdict = 'arm';
    verdictText = 'مبني لمعالج ARM — لا يعمل على محاكي x86';
  } else if (machineId === 0x8664) {
    verdict = 'native-64';
    verdictText = 'برنامج 64-بت: يحتاج Wine/Box64 على ARM (خارج محاكينا)';
  } else if (machineId === 0x014c) {
    verdict = 'native-32';
    verdictText = 'برنامج Win32 32-بت: تقنياً في نطاق محاكينا';
  }

  return {
    ok: true,
    peOffset,
    machine: MACHINES[machineId] ?? `unknown (0x${machineId.toString(16)})`,
    machineId,
    is64,
    isDll,
    isDotNet,
    subsystem: subsystem === 2 ? 'gui' : subsystem === 3 ? 'console' : 'other',
    sectionCount,
    imageSize,
    timestamp,
    imports,
    verdict,
    verdictText,
  };
}

/** RVA to file offset using the section table (PE files are not flat). */
function rvaToOffset(
  dv: DataView,
  bytes: Uint8Array,
  peOffset: number,
  secStart: number,
  count: number,
  rva: number,
): number {
  const optSize = dv.getUint16(peOffset + 20, true);
  const headersSize = peOffset + 24 + optSize;
  if (rva < headersSize) return rva; // inside headers: offset == rva
  for (let i = 0; i < count; i++) {
    const s = secStart + i * 40;
    if (s + 40 > bytes.length) break;
    const va = dv.getUint32(s + 12, true);
    const vsize = dv.getUint32(s + 8, true);
    const rawPtr = dv.getUint32(s + 20, true);
    if (rva >= va && rva < va + vsize) return rawPtr + (rva - va);
  }
  return -1;
}

/** Human summary for the UI card. */
export function describePE(info: PEInfo): string {
  if (!info.ok) return info.reason ?? 'تعذّر التحليل';
  const bits = [
    info.machine,
    info.subsystem === 'gui' ? 'واجهة رسومية' : info.subsystem === 'console' ? 'سطر أوامر' : 'نوع غير معروف',
    info.isDll ? 'مكتبة DLL' : 'برنامج',
  ];
  return bits.join(' · ');
}
