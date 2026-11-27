/**
 * Which engine can actually run a given program — decided with numbers.
 *
 * We measured our own engine at ~70 MIPS on a desktop JS engine (see
 * `.probe/mips.test.ts`). A 2026 phone core retires roughly 5000 MIPS of native
 * code, and a browser engine is ~70× slower than that. Any game whose budget is a
 * few hundred million instructions per frame simply cannot run here, no matter how
 * much we optimise the emulator.
 *
 * So the app always offers *two* routes and is explicit about the ceiling:
 *   1. in-app: DOS-era programs (this is what we ship and can guarantee);
 *   2. native: Winlator / GameNative — Wine + Box64 + Turnip running on the phone
 *      itself, which is the only way AAA titles reach playable frame rates.
 */
export type Route = 'in-app' | 'native' | 'none';

export interface RouteAdvice {
  route: Route;
  title: string;
  detail: string;
  /** minimum free storage the user needs for this class of program */
  storage?: string;
}

/** measured ceiling of the in-app engine, kept in one place so it cannot drift */
export const ENGINE_MIPS = 70;
export const NATIVE_MIPS = 5000;

/**
 * How much free storage a Windows program really needs.
 *
 * The old figure was `bytes * 1.6` labelled "(the game + a Wine container)". That is
 * wrong twice: a setup.exe expands when installed (3-5x is ordinary), and a Winlator
 * container with DXVK/Turnip is ~1.5 GB by itself. For a 1.6 GB download the old code
 * said 3 GB when the honest number is 6.3 GB -- a user with 4 GB free would be told they
 * had room and would run out of space mid-install.
 *
 * Both multipliers are stated, not hidden, because they are estimates of other people's
 * installers and we cannot measure them from here.
 */
export const EXPANSION_MIN = 3; // installed size / download size, lower bound for a game
export const CONTAINER_GB = 1.5; // Winlator container + DXVK + Turnip
export const GB = 1073741824;

export function storageNeededGB(downloadBytes: number): number {
  const download = downloadBytes / GB;
  return Math.ceil(download * EXPANSION_MIN + CONTAINER_GB);
}

/** rough classes, from things we have actually run to things no phone can run */
export function adviseRoute(opts: {
  /** true when the file has no PE header (DOS-era executable) */
  dos?: boolean;
  is64?: boolean;
  isDotNet?: boolean;
  /** file size, the best cheap proxy for "how big is this game" */
  bytes?: number;
  dotnet?: boolean;
}): RouteAdvice {
  if (opts.dos) {
    return {
      route: 'in-app',
      title: 'يعمل داخل التطبيق الآن',
      detail: 'برنامج DOS أصلي — يشغّله محرّكنا مباشرة بلا ويندوز ولا طبقات.',
    };
  }
  if (opts.isDotNet || opts.dotnet) {
    return {
      route: 'none',
      title: 'لا مسار على الهاتف',
      detail: 'برامج .NET تحتاج Wine Mono داخل حاوية Winlator — ممكن تجريبياً، لا نضمنه.',
    };
  }
  const size = opts.bytes ?? 0;
  if (size > 1_500_000_000) {
    return {
      route: 'native',
      title: 'لعبة كبيرة — مسار أصلي فقط',
      detail:
        `حجم الملف ${(size / GB).toFixed(1)} غيغا — فئة AAA: تحتاج Winlator/GameNative مع DXVK وTurnip ` +
        'على ٧٢٠p. المعدّل الذي قِسناه (٢٠–٤٠ إطاراً) كان على GTA V تحديداً، لا على كل لعبة ' +
        'بهذا الحجم. لا يمكن لمحرّك داخل المتصفح.',
      // stated honestly: download x3 for the installed tree, plus the container itself
      storage:
        `${storageNeededGB(size)} غيغا حرة على الأقل ` +
        `(تنزيل ${(size / GB).toFixed(1)} غيغا × ${EXPANSION_MIN} بعد التثبيت + ${CONTAINER_GB} للحاوية)`,
    };
  }
  if (opts.is64) {
    return {
      route: 'native',
      title: 'برنامج ٦٤-بت — يحتاج Wine + Box64',
      detail: 'يعمل غالباً في Winlator لكن أبطأ؛ برامج المكتب ٦٤-بت عادة مقبولة.',
    };
  }
  return {
    route: 'native',
    title: 'برنامج Win32 — يحتاج طبقة Wine',
    detail:
      'برامج ٣٢-بت خفيفة (7-Zip، Notepad++) تعمل جيداً في Winlator على جهازك. ' +
      'محرّكنا داخل التطبيق مخصّص لبرامج DOS فقط.',
  };
}

/** is this size plausible for an AAA title? used to warn before a 100 GB download */
export function isAaaSize(bytes: number): boolean {
  return bytes > 20_000_000_000;
}
