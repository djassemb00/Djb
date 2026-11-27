/**
 * PLAN ٤-٢: read the Winlator log...except there is no log to read.
 *
 * The plan says: "Winlator writes a log inside its storage (/storage/emulated/0/Download/
 * Winlator/... and files/ depending on version) — we read it with SAF once permission is
 * granted." That premise is false, and it is falsifiable from the source:
 *
 *   brunodev85/winlator-app, core/ProcessHelper.java:
 *     if (debugCallbacks.isEmpty())
 *         processBuilder.redirectOutput(new File("/dev/null")).redirectErrorStream(true);
 *
 * Every child process (wine, box64, dxvk) has its output discarded to /dev/null unless a
 * debug callback is registered, and those callbacks live in memory and feed Winlator's own
 * on-screen debug view. Nothing is written to a file. On top of that, RootFS roots its
 * tree at `context.getFilesDir()` — internal storage, private to the app:
 *
 *   RootFS.java: File rootDir = new File(context.getFilesDir(), "rootfs");
 *
 * which no SAF grant can reach. So ٤-٢'s stated implementation cannot work, and building a
 * SAF picker that opens an empty directory would be a button that does nothing -- the very
 * defect this repository removed in phase 2.
 *
 * What is built instead is the half that can work: a parser for text the user PASTES in
 * (from Winlator's debug window, or from a fork that does add logging), plus a precise
 * statement of what could not be found. The plan's acceptance criterion already contains
 * that fallback: "…and if not found, we ask for manual input".
 */

/**
 * Why there is no file to read, with the source lines that settle it.
 * Shown to the user rather than hidden, because "no log found" and "we cannot read logs"
 * are different facts and only one of them is our fault.
 */
export const NO_LOG_REASON = {
  found: false as const,
  summary: 'Winlator لا يكتب ملف سجل على القرص',
  detail:
    'كل خرج العمليات (wine و box64 و DXVK) يُرسَل إلى /dev/null إلا إذا فُتحت نافذة التصحيح داخل '
    + 'Winlator، وهو يعرضه في الذاكرة فقط ولا يحفظه. وشجرة Winlator نفسها في التخزين الداخلي '
    + 'الخاص بالتطبيق (getFilesDir/rootfs)، ولا يصل إليه أي إذن SAF.',
  source: 'brunodev85/winlator-app · core/ProcessHelper.java:74 · xenvironment/RootFS.java:28',
};

/** One line for a UI that has no room for the full explanation. */
export const NOLOG_REASON_SHORT =
  'Winlator لا يحفظ سجلاً على القرص (خرجه إلى /dev/null)، فالصق ما تراه في نافذة التصحيح بدلاً من انتظار ملف';

export interface ParsedRun {
  /** the last lines we were given, capped */
  lines: string[];
  /** DXVK version if the text names one */
  dxvkVersion: string | null;
  /** a frame-rate the text declares, if any */
  fps: number | null;
  /** a resolution the text names, if any */
  screenSize: string | null;
  /** temperatures if the log carries them (most do not) */
  tempC: number | null;
  /** the lines that produced each value, so the user can check us */
  evidence: { field: string; line: string }[];
  /** fields we looked for and did not find -- stated, not silently null */
  missing: string[];
}

const MAX_LINES = 50;

/**
 * Pull what can be pulled out of a pasted log, and name what is missing.
 *
 * Deliberately conservative: every pattern requires a label next to the number, so a bare
 * "1280" or "60" somewhere in a Wine trace is not read as our resolution or frame rate.
 * A wrong number here is worse than a missing one -- the whole decision table downstream
 * is fed by it.
 */
export function parseWinlatorLog(text: string): ParsedRun {
  const all = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  const lines = all.slice(-MAX_LINES);
  const evidence: ParsedRun['evidence'] = [];
  const missing: string[] = [];

  let dxvkVersion: string | null = null;
  let fps: number | null = null;
  let screenSize: string | null = null;
  let tempC: number | null = null;

  for (const line of lines) {
    // "DXVK: v2.4" / "DXVK 2.4.1" / "dxvk-1.10.3"
    const dv = /dxvk[^0-9]{0,6}v?(\d+\.\d+(?:\.\d+)?)/i.exec(line);
    if (dv && !dxvkVersion) {
      dxvkVersion = dv[1];
      evidence.push({ field: 'dxvkVersion', line });
    }
    // a frame counter line: "fps: 27", "FPS 31.2", "FrameRate 30"
    const fp = /(?:fps|framerate)[^0-9]{0,4}(\d+(?:\.\d+)?)/i.exec(line);
    if (fp && fps === null) {
      const n = Number(fp[1]);
      // a phone cannot render 1000 fps of a PC title; treat that as a misparse
      if (n > 0 && n < 1000) {
        fps = n;
        evidence.push({ field: 'fps', line });
      }
    }
    // "screenSize=1280x720" / "resolution 960x540" / "1280x720"
    const ss = /(\d{3,4})x(\d{3,4})/.exec(line);
    if (ss && !screenSize) {
      const w = Number(ss[1]);
      const h = Number(ss[2]);
      if (w >= 320 && w <= 3840 && h >= 200 && h <= 2160) {
        screenSize = `${w}x${h}`;
        evidence.push({ field: 'screenSize', line });
      }
    }
    // "temp 44" / "44.2°C" -- only when a degree marker or the word is present
    const tp = /(\d{1,3}(?:\.\d)?)\s*(?:°\s*c|درجة|celsius)/i.exec(line);
    if (tp && tempC === null) {
      const n = Number(tp[1]);
      if (n > -20 && n < 120) {
        tempC = n;
        evidence.push({ field: 'tempC', line });
      }
    }
  }

  if (dxvkVersion === null) missing.push('إصدار DXVK');
  if (fps === null) missing.push('الإطارات');
  if (screenSize === null) missing.push('الدقة');
  if (tempC === null) missing.push('الحرارة');

  return { lines, dxvkVersion, fps, screenSize, tempC, evidence, missing };
}

/**
 * One honest sentence for the UI: what we read, and what the user must type in themselves.
 */
export function describeParsedRun(p: ParsedRun): string {
  if (p.lines.length === 0) {
    return 'لم يُلصق شيء بعد — لا سجل يكتبه Winlator، فالصق مخرجات نافذة التصحيح إن كانت نسختك تعرضها';
  }
  const got: string[] = [];
  if (p.fps !== null) got.push(`الإطارات ${p.fps}`);
  if (p.dxvkVersion) got.push(`DXVK ${p.dxvkVersion}`);
  if (p.screenSize) got.push(`الدقة ${p.screenSize}`);
  if (p.tempC !== null) got.push(`الحرارة ${p.tempC}°`);
  const head =
    got.length > 0
      ? `قرأنا: ${got.join(' · ')} (آخر ${p.lines.length} سطراً)`
      : `قرأنا ${p.lines.length} سطراً ولم نجد أي قيمة معروفة`;
  return p.missing.length > 0 ? `${head} — ينقص: ${p.missing.join('، ')}` : head;
}
