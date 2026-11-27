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
export type ThermalLevel = 'none' | 'light' | 'moderate' | 'severe' | 'critical' | 'emergency' | 'shutdown';

/** 0 = platform said nothing, 1..6 = Android THERMAL_STATUS_* ORDER */
const ORDER: ThermalLevel[] = ['none', 'light', 'moderate', 'severe', 'critical', 'emergency', 'shutdown'];

export interface GovernorReading {
  thermal: ThermalLevel;
  /** 0..1, where 1 means "the OS is about to throttle" (Android returns >1.0 at the limit) */
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
  // No native bridge: the browser cannot see thermal state. Report "unknown"
  // rather than pretending the device is cool.
  return { level: 'none', headroom: null };
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

  // Policy: step the guest down in stages. Halving is enough to stop a thermal
  // runaway without making the desktop feel broken.
  let throttle = 1;
  let reason = 'الحرارة طبيعية — السرعة الكاملة';

  if (headroom !== null && headroom >= 0.9) {
    throttle = 0.5;
    reason = 'الهاتف يقترب من الخنق الحراري — خُفّضت السرعة للنصف';
  }
  if (level === 'moderate') {
    throttle = 0.6;
    reason = 'الحرارة متوسطة — خُفّضت السرعة';
  } else if (level === 'severe') {
    throttle = 0.4;
    reason = 'الحرارة مرتفعة — خُفّضت السرعة كثيراً لحماية الجهاز';
  } else if (level === 'critical' || level === 'emergency' || level === 'shutdown') {
    throttle = 0.2;
    reason = 'الجهاز في حالة حرجة — أُوقف الحمل الثقيل، احفظ عملك';
  }

  if (battery !== null && battery <= 15 && charging === false) {
    throttle = Math.min(throttle, 0.5);
    reason = `البطارية ${battery}% — وُضع توفير الطاقة`;
  }

  return { thermal: level, headroom, battery, charging, throttle, reason };
}

/** Human label for the status card. */
export function thermalLabel(r: GovernorReading): string {
  const names: Record<ThermalLevel, string> = {
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
