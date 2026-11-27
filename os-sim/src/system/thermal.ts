/**
 * Resource governor, phase 1: thermal + battery awareness.
 *
 * The emulator is the only app on the phone that will happily burn 100% of one
 * core for as long as it is open. On a Snapdragon 8 Gen 1 that shows up as heat
 * within minutes, and Android then throttles everything (including our frame
 * rate) without telling us. So we read the platform's own signals and slow the
 * guest down *before* the OS does it for us.
 *
 * API levels used (all no-permission, no-Play-Services):
 *   - PowerManager.getCurrentThermalStatus()  (API 29+)
 *   - PowerManager.getThermalHeadroom(forecast) (API 30+)
 *   - BatteryManager via navigator.getBattery() (WebView: where available)
 */
/** 'unknown' means "this build cannot read the platform" — not "cold" */
export type ThermalLevel =
  | 'unknown'
  | 'none'
  | 'light'
  | 'moderate'
  | 'severe'
  | 'critical'
  | 'emergency'
  | 'shutdown';

/** 0 = platform said nothing, 1..6 = Android THERMAL_STATUS_* ORDER */
const ORDER: ThermalLevel[] = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'];

export interface GovernorReading {
  thermal: ThermalLevel;
  /**
   * Platform thermal headroom, 1.0 = the SEVERE throttling threshold (it is a 10-second
   * forecast, not a temperature). null when the platform cannot say.
   */
  headroom: number | null;
  battery: number | null;
  charging: boolean | null;
  /** speed multiplier we should apply to the emulator right now */
  throttle: number;
  /** plain-Arabic reason shown in the UI */
  reason: string;
}

const wrap = (ua: string) => ua.toLowerCase().includes('android aiagent');

/**
 * Bridge hook: the Android shell (Capacitor plugin) can install a synchronous
 * reader here. We keep it optional so the web build never depends on it.
 */
type NativeReader = () => { thermal?: number; headroom?: number } | null;
let nativeReader: NativeReader | null = null;
export function setNativeThermalReader(fn: NativeReader | null) {
  nativeReader = fn;
}

function readThermal(): { level: ThermalLevel; headroom: number | null } {
  if (nativeReader) {
    try {
      const r = nativeReader();
      if (r && typeof r.thermal === 'number') {
        return { level: ORDER[Math.min(6, Math.max(0, r.thermal))] ?? 'none', headroom: r.headroom ?? null };
      }
    } catch {
      /* fall through to the generic path */
    }
  }
  // No native bridge (or the reading is stale): the browser cannot see thermal state.
  // Report 'unknown' rather than pretending the device is cool.
  return { level: 'unknown', headroom: null };
}

export function isAndroidShell(): boolean {
  return wrap(typeof navigator === 'undefined' ? '' : navigator.userAgent);
}

export async function readGovernor(): Promise<GovernorReading> {
  const { level, headroom } = readThermal();

  let battery: number | null = null;
  let charging: boolean | null = null;
  try {
    const nav = navigator as unknown as { getBattery?: () => Promise<{ level: number; charging: boolean }> };
    if (nav.getBattery) {
      const b = await nav.getBattery();
      battery = Math.round(b.level * 100);
      charging = b.charging;
    }
  } catch {
    /* battery API is optional */
  }

  // Policy: step the guest down in stages, strongest signal wins.
  //
  // This used to be a chain of `if`s that the *last* branch overwrote, so a cool phone
  // with headroom >= 0.9 was still throttled to 0.5 whenever the platform also said
  // "moderate" was not the case — the exact opposite of the intent. It is now a table
  // keyed by severity: each level has a throttle and a reason, and battery pressure
  // can only make it stricter, never looser.
  let throttle = 1;
  let reason =
    level === 'unknown'
      ? 'لا يمكن قراءة حرارة الجهاز من هنا — السرعة الكاملة'
      : 'الحرارة طبيعية — السرعة الكاملة';

  // severity by platform status; `light` is a warning, not a throttle
  const byLevel: Partial<Record<ThermalLevel, [number, string]>> = {
    moderate: [0.6, 'الحرارة متوسطة — خُفّضت السرعة'],
    severe: [0.4, 'الحرارة مرتفعة — خُفّضت السرعة كثيراً لحماية الجهاز'],
    critical: [0.2, 'الجهاز في حالة حرجة — أُوقف الحمل الثقيل، احفظ عملك'],
    emergency: [0.2, 'الجهاز في حالة حرجة — أُوقف الحمل الثقيل، احفظ عملك'],
    shutdown: [0.2, 'الجهاز في حالة حرجة — أُوقف الحمل الثقيل، احفظ عملك'],
  };
  const fromLevel = byLevel[level];
  if (fromLevel) {
    throttle = fromLevel[0];
    reason = fromLevel[1];
  }

  // Headroom is a 10 s forecast where 1.0 is the SEVERE threshold, so 0.9 means
  // "SEVERE is about a tenth of the way off". It may only tighten the status.
  if (headroom !== null && headroom >= 0.9 && throttle > 0.5) {
    throttle = 0.5;
    reason = 'الهاتف يقترب من الخنق الحراري — خُفّضت السرعة للنصف';
  }

  // Battery pressure is a separate axis: it can lower the throttle, never raise it.
  if (battery !== null && battery <= 15 && charging === false && throttle > 0.5) {
    throttle = 0.5;
    reason = `البطارية ${battery}% — وُضع توفير الطاقة`;
  }

  return { thermal: level, headroom, battery, charging, throttle, reason };
}

/** Human label for the status card. */
export function thermalLabel(r: GovernorReading): string {
  const names: Record<ThermalLevel, string> = {
    unknown: 'غير متاح',
    none: 'طبيعية',
    light: 'خفيفة',
    moderate: 'متوسطة',
    severe: 'مرتفعة',
    critical: 'حرجة',
    emergency: 'طارئة',
    shutdown: 'إيقاف',
  };
  return names[r.thermal];
}
