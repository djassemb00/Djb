/**
 * PLAN ٢-٥: the "route status" screen -- ✅ ready · ⚠️ missing (and what) · ⛔ no space.
 *
 * The hard part is not the UI, it is deciding what may honestly be checked. A web app in
 * a WebView cannot enumerate installed packages, cannot read the version of an installed
 * Turnip driver, and cannot see free space on the user's internal storage. So each
 * requirement is graded by what the app can actually observe:
 *
 *   'known'  -- we measured it here and now (free space for OUR storage bucket)
 *   'user'   -- only the user can answer it; we ask, and remember the answer
 *   'never'  -- not observable from a web app at all; we say so instead of showing a tick
 *
 * A green tick that was never measured is the same defect as the fabricated MAC address
 * in A36, one layer up: it tells the user a check happened.
 */
export type CheckState = 'ok' | 'missing' | 'unknown' | 'never';

export interface Requirement {
  id: string;
  /** what the user installs or does */
  label: string;
  state: CheckState;
  /** why the state is what it is, in one line */
  why: string;
}

export type RouteVerdict = 'ready' | 'partial' | 'blocked';

export interface RouteStatus {
  verdict: RouteVerdict;
  /** one line the header can show */
  title: string;
  requirements: Requirement[];
  /** free space we could actually read, in GB, or null when unmeasurable */
  freeGB: number | null;
  /** space the selected title needs, in GB */
  needGB: number;
}

/** Answers the user gave us last time, keyed by requirement id. */
export type Answers = Record<string, boolean>;

/** How much free space a container needs beyond the game itself (PLAN ٢-١). */
export const CONTAINER_GB = 1.5;

export function evaluateRoute(input: {
  /** does the device report a Winlator/GameNative install? we cannot see packages */
  answers: Answers;
  /** navigator.storage free bytes, or null */
  freeBytes: number | null;
  /** storage the chosen title needs, from routes.storageNeededGB-ish figures */
  needGB: number;
  /** true when the APK is running natively (the export lane exists) */
  native: boolean;
}): RouteStatus {
  const freeGB = input.freeBytes === null ? null : input.freeBytes / 1024 ** 3;
  const wantGB = Math.ceil(input.needGB + CONTAINER_GB);

  const requirements: Requirement[] = [
    {
      id: 'winlator',
      label: 'Winlator أو GameNative مثبّت',
      state: input.answers.winlator ? 'ok' : input.answers.winlator === false ? 'missing' : 'unknown',
      why: input.answers.winlator
        ? 'أكّدت أنه مثبّت'
        : input.answers.winlator === false
          ? 'أكّدت أنه غير مثبّت — نزّل الحاوية وشغّلها هناك'
          : 'لا يستطيع تطبيق ويب قراءة قائمة التطبيقات المثبّتة — أنت وحدك تعرف',
    },
    {
      id: 'turnip',
      label: 'برنامج Turnip لـAdreno 730',
      state: input.answers.turnip ? 'ok' : input.answers.turnip === false ? 'missing' : 'unknown',
      why: input.answers.turnip
        ? 'أكّدت تثبيته'
        : 'إصدار الملحق لا يُقرأ من خارج Winlator — لا نعرض علامة صح لم نقسها',
    },
    {
      id: 'space',
      label: `مساحة حرة ${wantGB} غيغا`,
      state:
        freeGB === null ? 'never' : freeGB >= wantGB ? 'ok' : 'missing',
      why:
        freeGB === null
          ? 'المتصفح لا يفصح عن مساحة الهاتف الحرة — القياس هنا يخصّ تخزين التطبيق وحده'
          : `${freeGB.toFixed(1)} غيغا متاحة لهذا التطبيق`,
    },
    {
      id: 'game',
      label: 'ملفات اللعبة على التخزين',
      state: input.answers.game ? 'ok' : input.answers.game === false ? 'missing' : 'unknown',
      why: input.answers.game
        ? 'أكّدت وجودها'
        : 'اللعبة تُنزَّل من عندك لا من عندنا — النطاق محجوب علينا بقصد',
    },
  ];

  const missing = requirements.filter((r) => r.state === 'missing');
  const blocked = missing.some((r) => r.id === 'space');
  const verdict: RouteVerdict = blocked ? 'blocked' : missing.length ? 'partial' : 'ready';

  return {
    verdict,
    title: blocked
      ? `لا مساحة: تحتاج ${wantGB} غيغا، والمتاح ${freeGB?.toFixed(1) ?? 'غير معروف'}`
      : missing.length
        ? `ناقص: ${missing.map((m) => m.label).join(' · ')}`
        : 'كل ما يمكن التحقق منه جاهز',
    requirements,
    freeGB,
    needGB: wantGB,
  };
}

/** The icon/label pair for a state, in one place so four screens cannot disagree. */
export const STATE_LABEL: Record<CheckState, { mark: string; label: string }> = {
  ok: { mark: '✅', label: 'جاهز' },
  missing: { mark: '⛔', label: 'ناقص' },
  unknown: { mark: '⚠️', label: 'بانتظار تأكيدك' },
  never: { mark: '—', label: 'لا يمكن قياسه' },
};
