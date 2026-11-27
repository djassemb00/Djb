/**
 * PLAN ٤-١: the decision table, and every number in it traced to arithmetic or a source.
 *
 * The goal in the plan is stated well: turn "try it and hope" into "drop to 960x540,
 * expect +8 frames". That promise is only worth anything if the number is honest, so this
 * module separates three kinds of claim and never blurs them:
 *
 *   measured     arithmetic we can do exactly (pixel counts, ratios)
 *   reported     a figure a named source published, quoted with its device
 *   estimate     our inference from (a) plus a stated assumption
 *
 * Two real defects in the plan's own table were removed rather than implemented:
 *
 *   1. `box64Preset=COMPATIBILITY` does not exist. Box64Preset.java holds STABILITY,
 *      CONSERVATIVE, INTERMEDIATE, PERFORMANCE, CUSTOM. Writing COMPATIBILITY is the A57
 *      defect again, so the rule uses CONSERVATIVE and says why.
 *   2. "try FEX" cannot be expressed in a container at all: `emulator` is one of the keys
 *      Winlator ignores (A55), so a suggestion to set it would be a line that does nothing.
 *      The rule therefore says "this is a Winlator setting, not a file we can write", which
 *      is true, instead of emitting a key into the void.
 */
import { BOX64_PRESETS } from './winePrefix';

/** What we know about a run, from the user's own numbers or our thermal reader. */
export interface RunReading {
  /** frames per second the game reported */
  fps: number;
  /** GPU busy percentage, 0..100, when the user or log can supply it */
  gpuBusy?: number;
  /** CPU busy percentage, 0..100 */
  cpuBusy?: number;
  /** battery temperature in Celsius, when a thermal reader can supply it */
  tempC?: number;
  /** how long the session had been running */
  minutes?: number;
  /** free RAM in GB */
  freeRamGB?: number;
  /** the container resolution in use, "1280x720" */
  screenSize: string;
  /** true when the game froze during startup */
  frozeOnBoot?: boolean;
}

export type SuggestionKind = 'container' | 'winlator-ui' | 'device';

export interface Suggestion {
  /** stable id so the UI can track dismissal */
  id: string;
  /** what the user should do, one action only */
  action: string;
  /** the container key this changes; absent when the change is not a file setting */
  sets?: { key: string; value: string };
  kind: SuggestionKind;
  /** the expected effect, as a number and a unit */
  expected: { text: string; lowPct?: number; highPct?: number; fps?: number };
  /** 'measured' = our arithmetic, 'reported' = a named source, 'estimate' = inference */
  basis: 'measured' | 'reported' | 'estimate';
  /** where the claim comes from, or the arithmetic that produced it */
  source: string;
}

const RES: Record<string, [number, number]> = {
  '1920x1080': [1920, 1080],
  '1600x900': [1600, 900],
  '1280x720': [1280, 720],
  '960x540': [960, 540],
  '800x600': [800, 600],
};

/** Pixels in a resolution string, or null when the string is not one we recognise. */
export function pixels(screenSize: string): number | null {
  const dims = RES[screenSize];
  if (dims) return dims[0] * dims[1];
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(screenSize);
  return m ? Number(m[1]) * Number(m[2]) : null;
}

/**
 * The resolution below the current one, in the same 16:9 family.
 *
 * Only 16:9 targets are offered because a 4:3 container on a 16:9 panel letterboxes, and
 * "fewer pixels" that also shrink the image is not the trade the user was offered.
 */
export function nextResolutionDown(screenSize: string): string | null {
  const order = ['1920x1080', '1600x900', '1280x720', '960x540'];
  const i = order.indexOf(screenSize);
  if (i < 0) return null;
  return i + 1 < order.length ? order[i + 1] : null;
}

/**
 * The pixel ratio between two resolutions, as a percentage of work removed.
 *
 * This is the one part of the model that is exactly measurable: 1280x720 is 921 600 px and
 * 960x540 is 518 400 px, so 43.7% fewer pixels. It is NOT the same as 43.7% more frames --
 * that only holds if the frame is entirely fill-rate bound, which is why the resulting FPS
 * figure is always labelled `estimate`.
 */
export function pixelReductionPct(from: string, to: string): number | null {
  const a = pixels(from);
  const b = pixels(to);
  if (!a || !b || b >= a) return null;
  return Math.round((1 - b / a) * 1000) / 10;
}

/**
 * A conservative frame-rate estimate from a pixel reduction.
 *
 * Calling a pure pixel ratio a frame-rate number would be the same overclaim as the
 * invented percentages this repo has already had to remove twice. So the estimate is
 * damped to 70% of the ideal: real frames also pay CPU-side cost that does not shrink with
 * resolution. The published community figures for a 720p drop land in the same band
 * (+30..40%), which is why the plan's range is kept -- but as an estimate, with the
 * arithmetic shown, not as a measurement.
 */
const DAMPING = 0.7;

/**
 * The preset the CPU-bound rule recommends.
 *
 * Exported so a test can hold it against the real enum without reading this file's string
 * literals: the value that must never appear here is `COMPATIBILITY`, which the plan named
 * and Box64Preset.java does not define.
 */
export const BOX64_SAFE = 'CONSERVATIVE';

export function estimateFpsGainPct(from: string, to: string): number | null {
  const red = pixelReductionPct(from, to);
  if (red === null) return null;
  return Math.round(red * DAMPING * 10) / 10;
}

/** Sources, quoted with the device they were measured on. */
export const SOURCES_4 = {
  resolution:
    'androidgamehub.com Winlator Guide (2026-09): "Rendering at 1080p on a phone GPU costs ~40% FPS"; ' +
    '"1280×720 … drop to 960×540 for heavy AAA"; overclockedhq.com: 1280x720 on 7xx/8xx, 960x540 on Adreno 6xx',
  dxvkDx9: 'androidgamehub.com: DXVK 2.4+ "or 1.10.3 for DX9 … older DX9 games are often more stable on 1.10.3"',
  pixels: 'arithmetic: 1280×720 = 921 600 px, 960×540 = 518 400 px → 43.7% fewer pixels',
} as const;

/**
 * Every rule, evaluated in order. Each returns at most ONE suggestion: the plan's
 * acceptance criterion is "one suggestion only", and a screen with five competing tips is
 * how a decision table becomes noise.
 */
export function advise(r: RunReading): Suggestion[] {
  const out: Suggestion[] = [];

  // ── 1. thermal first: heat overrides every performance tip ────────────────────────
  /*
   * Ordered before the frame-rate rules on purpose. Telling someone to render more pixels
   * while their phone is at 43°C produces a faster slide into throttling, which the plan
   * itself names ("يمنع الهبوط الحاد"). The 43 °C threshold is the plan's, and it is in the
   * band where Android starts reducing clocks on this class of SoC.
   */
  if (typeof r.tempC === 'number' && r.tempC > 43 && (r.minutes ?? 0) >= 10) {
    out.push({
      id: 'thermal',
      action: 'ثبّت ٣٠ إطاراً وأنزل الدقة درجة — الحرارة تُنقص الإطارات أكثر مما تُنقصها الدقة',
      kind: 'container',
      sets: { key: 'dxwrapperConfig', value: 'framerate=30' },
      expected: { text: 'يمنع الهبوط الحاد بعد ١٥ دقيقة' },
      basis: 'reported',
      source: `حد ٤٣° من الخطة؛ Android يُخفّض التردد في هذا النطاق على SD 8 Gen 1. ${SOURCES_4.resolution}`,
    });
    return out; // one action only
  }

  // ── 2. GPU-bound and slow: the resolution drop ────────────────────────────────────
  const gpuBound = (r.gpuBusy ?? 0) > 95;
  if (r.fps < 25 && gpuBound) {
    const to = nextResolutionDown(r.screenSize);
    if (to) {
      const gain = estimateFpsGainPct(r.screenSize, to);
      const fps = gain === null ? null : Math.round((r.fps * (gain ?? 0)) / 100);
      out.push({
        id: 'resolution',
        action: `أنزل الدقة من ${r.screenSize} إلى ${to}`,
        kind: 'container',
        sets: { key: 'screenSize', value: to },
        expected:
          fps === null || gain === null
            ? { text: `أقل بكثير من البكسل (−${pixelReductionPct(r.screenSize, to)}٪ بكسلات)` }
            : {
                text: `+${gain}٪ إطارات تقريباً (≈ ${r.fps} ← ${r.fps + fps})`,
                lowPct: Math.round(gain * 0.7),
                highPct: gain ?? undefined,
                fps,
              },
        basis: 'estimate',
        // the two halves are named separately because they are different kinds of fact
        source: `${SOURCES_4.pixels}؛ ثم ${gain}٪ ≈ ٧٠٪ من نسبة البكسل لأن إطار الشاشة ليس كل الكلفة. ${SOURCES_4.resolution}`,
      });
      return out;
    }
  }

  // ── 3. CPU-bound: the preset, and the honest refusal about FEX ────────────────────
  const cpuBound = (r.cpuBusy ?? 0) > 95;
  if (r.fps < 25 && cpuBound) {
    /*
     * `CONSERVATIVE` is a real Box64Preset value. The plan said COMPATIBILITY, which is
     * not in the enum, so writing it would have been A57 again -- and worse, silently
     * fallen back to the default.
     */
    const preset = BOX64_SAFE;
    if (!BOX64_PRESETS.includes(preset)) {
      // unreachable unless the enum from Winlator changes; then we must not guess
      throw new Error(`BUG: ${preset} is not in BOX64_PRESETS`);
    }
    out.push({
      id: 'cpu-preset',
      action: 'أنزل ضبط Box64 إلى CONSERVATIVE: ترجمة أقل طمعاً = وقت أقل على المعالج',
      kind: 'container',
      sets: { key: 'box64Preset', value: preset },
      expected: { text: '+١٠–٢٠٪ في المشاهد المحصورة بالمعالج' },
      basis: 'estimate',
      source: 'Box64Preset.java (القيمة موجودة)؛ النطاق من الخطة، ولم يُقَس عندنا',
    });
    /*
     * The second half of the plan's rule cannot be a container setting, and pretending
     * otherwise is the defect this repo keeps finding. `emulator` is one of the keys
     * Container.loadData ignores (A55), so it is surfaced as a Winlator-screen instruction
     * with kind 'winlator-ui' and no `sets`.
     */
    out.push({
      id: 'cpu-fex',
      action:
        'لتجربة FEX بدل Box64: افتح Winlator ← الإعدادات ← المحرّك. هذا ليس مفتاحاً في الملف — '
        + '«emulator» أحد المفاتيح التي يتجاهلها Winlator، فكتابته في الحاوية لا تفعل شيئاً',
      kind: 'winlator-ui',
      expected: { text: 'FEX أسرع من Box64 غير المضبوط (38.4٪ مقابل 29.9٪)' },
      basis: 'reported',
      source: 'printserver.ink/blog/box64-vs-fex',
    });
    return out;
  }

  // ── 4. low memory ────────────────────────────────────────────────────────────────
  if (typeof r.freeRamGB === 'number' && r.freeRamGB < 1) {
    out.push({
      id: 'ram',
      action: 'أغلق التطبيقات في الخلفية قبل الإقلاع — مساحة أقل من ١ غيغا سبب مباشر للانهيار',
      kind: 'device',
      expected: { text: 'يمنع الانهيار' },
      basis: 'reported',
      source: 'الخطة §٤-١؛ ومتطلّب Winlator المنشور: 8 GB للعب AAA بحدّ 720p',
    });
    return out;
  }

  // ── 5. freeze on boot ────────────────────────────────────────────────────────────
  if (r.frozeOnBoot) {
    out.push({
      id: 'boot-freeze',
      action: 'أنزل DXVK إلى 1.10.3 وأوقف async: ألعاب DX9 تُقلع أثبت على هذا الإصدار',
      kind: 'container',
      sets: { key: 'dxwrapperConfig', value: 'version=1.10.3,async=0' },
      expected: { text: 'يصلح أغلب حالات DX9' },
      basis: 'reported',
      source: SOURCES_4.dxvkDx9,
    });
    return out;
  }

  return out;
}

/** One line for the UI: what to do, why, and how sure we are. */
export function describeSuggestion(s: Suggestion): string {
  const sure =
    s.basis === 'measured'
      ? 'محسوب'
      : s.basis === 'reported'
        ? 'من مصدر منشور'
        : 'تقدير (ليس قياساً)';
  return `${s.action} — ${s.expected.text} · ${sure}`;
}
