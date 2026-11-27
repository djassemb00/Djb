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
  const magic = dv.getUint16(opt, true); // 0x10b = PE32, 0x20b = PE32+
  const is64 = magic === 0x20b;
  const subsystem = dv.getUint16(opt + (is64 ? 68 : 68), true); // same offset for both
  const imageSize = dv.getUint32(opt + 56, true);

  // Sections, to find imports
  const sec = opt + optSize;
  const imports: string[] = [];
  for (let i = 0; i < sectionCount; i++) {
    const s = sec + i * 40;
    if (s + 40 > bytes.length) break;
    const name = new TextDecoder().decode(bytes.subarray(s, s + 8)).replace(/\0.*$/, '');
    if (name !== '.idata') continue;
    const rawPtr = dv.getUint32(s + 20, true);
    const rawSize = dv.getUint32(s + 16, true);
    // Walk the import directory: 20-byte descriptors, name RVA at +12
    for (let p = rawPtr; p + 20 <= rawPtr + rawSize && p + 20 <= bytes.length; p += 20) {
      const nameRva = dv.getUint32(p + 12, true);
      if (nameRva === 0) break;
      const nameOff = rvaToOffset(dv, bytes, peOffset, sec, sectionCount, nameRva);
      if (nameOff < 0 || nameOff >= bytes.length) continue;
      let end = nameOff;
      while (end < bytes.length && bytes[end] !== 0 && end - nameOff < 64) end++;
      const dll = new TextDecoder().decode(bytes.subarray(nameOff, end)).toUpperCase();
      if (dll && !imports.includes(dll)) imports.push(dll);
    }
  }

  const isDll = (characteristics & 0x2000) !== 0;
  const isDotNet = imports.some((d) => DOTNET.some((n) => d.startsWith(n.split('.')[0])));

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
