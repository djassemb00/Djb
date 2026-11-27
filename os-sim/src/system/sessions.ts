/**
 * PLAN ٤-٣ + ٤-٤: results entered by hand, and the session history they build.
 *
 * This is where the decision table stops being advice and starts being checkable: once a
 * session records "1280x720, 18 fps" and the next one records "960x540, 24 fps", the
 * estimate in `decide.ts` can be compared with what happened. That comparison is the only
 * honest way to know whether our numbers are any good, and it is why a session must carry
 * the resolution it was run at.
 *
 * Two rules carried over from the schema work:
 *   1. A field we cannot measure is `null`, never 0 and never a guess. `0 °C` is a
 *      plausible-looking temperature that would silently pass every downstream check.
 *   2. Nothing is stored that the user did not enter. No session is fabricated from
 *      defaults to "pre-fill" the graph.
 */
import type { RunReading } from './decide';

export interface Session {
  /** stable id: game id + timestamp, so two sessions of one game do not overwrite */
  id: string;
  gameId: string;
  /** ISO date (YYYY-MM-DD) when the run happened */
  date: string;
  /** resolution the container used */
  screenSize: string;
  fps: number;
  /** null when the user genuinely has no reading -- not 0 */
  tempC: number | null;
  minutes: number | null;
  /** where the numbers came from: the user, a pasted log, or a measurement */
  source: 'user' | 'paste' | 'measured';
  /** the DXVK version in play, when known, so a comparison is not confounded */
  dxvk?: string;
}

export type SessionIssue = { field: string; message: string };

export type AddResult =
  | { ok: true; session: Session }
  | { ok: false; issues: SessionIssue[] };

/**
 * Validate and build a session from a form. Every refusal names the field, in Arabic,
 * because the acceptance criterion for ٤-٣ is that a three-field form produces a VALID
 * `result` -- and "invalid" alone does not tell a user which of the three was wrong.
 */
export function makeSession(input: {
  gameId: string;
  screenSize: string;
  fps: string | number;
  tempC?: string | number | null;
  minutes?: string | number | null;
  source?: Session['source'];
  dxvk?: string;
  now?: number;
}): AddResult {
  const issues: SessionIssue[] = [];

  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.gameId)) {
    issues.push({ field: 'gameId', message: 'معرّف اللعبة غير صالح' });
  }
  if (!/^\d{3,4}x\d{3,4}$/.test(input.screenSize)) {
    issues.push({ field: 'screenSize', message: 'الدقة يجب أن تكون بالصيغة العرض×الارتفاع' });
  }

  // An empty box is a MISSING value, not zero. `Number('') === 0`, which would make an
  // untouched field look like a measured 0 fps.
  const num = (v: string | number | null | undefined): number | null => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const fps = num(input.fps);
  if (fps === null) {
    issues.push({ field: 'fps', message: 'الإطارات مطلوبة — رقم من غير قياس لا يدخل السجل' });
  } else if (fps <= 0 || fps >= 1000) {
    issues.push({ field: 'fps', message: 'الإطارات يجب أن تكون بين ١ و٩٩٩ — ٠ ليس قياساً' });
  }

  const tempC = num(input.tempC);
  if (tempC !== null && (tempC < -20 || tempC > 120)) {
    issues.push({ field: 'tempC', message: 'الحرارة خارج النطاق المعقول لهاتف (−٢٠ إلى ١٢٠)' });
  }

  const minutes = num(input.minutes);
  if (minutes !== null && (minutes < 0 || minutes > 24 * 60)) {
    issues.push({ field: 'minutes', message: 'المدة يجب أن تكون بين ٠ و١٤٤٠ دقيقة' });
  }

  if (issues.length) return { ok: false, issues };

  const at = input.now ?? Date.now();
  return {
    ok: true,
    session: {
      id: `${input.gameId}-${at}`,
      gameId: input.gameId,
      date: new Date(at).toISOString().slice(0, 10),
      screenSize: input.screenSize,
      fps: fps as number,
      tempC,
      minutes,
      source: input.source ?? 'user',
      ...(input.dxvk ? { dxvk: input.dxvk } : {}),
    },
  };
}

/** A session as the decision table wants it: only measured fields are passed on. */
export function readingOf(s: Session): RunReading {
  return {
    fps: s.fps,
    screenSize: s.screenSize,
    ...(s.tempC !== null ? { tempC: s.tempC } : {}),
    ...(s.minutes !== null ? { minutes: s.minutes } : {}),
  };
}

export interface Comparison {
  /** the two sessions being compared, older first */
  from: Session;
  to: Session;
  /** actual frames per second gained */
  gained: number;
  /** actual gain as a percentage of the older figure */
  gainedPct: number;
  /** what the model predicted for that resolution change, when it has an opinion */
  predictedPct: number | null;
  /** one sentence: actual vs predicted, and whether the model was close */
  verdict: string;
}

/**
 * Compare two sessions of the same game run at different resolutions.
 *
 * This is the payoff of ٤-١ and the reason the estimate there is labelled an estimate: the
 * model claims a resolution drop buys a certain percentage, and this function is how that
 * claim gets checked against reality. It refuses comparisons that would be misleading --
 * a different game, the same resolution, or a later run that is actually older -- instead
 * of producing a confident number from incomparable data.
 */
export function compareSessions(a: Session, b: Session, predictedPct: number | null): Comparison | null {
  if (a.gameId !== b.gameId) return null;
  if (a.screenSize === b.screenSize) return null;
  const [from, to] = new Date(a.date) <= new Date(b.date) ? [a, b] : [b, a];
  const gained = Math.round((to.fps - from.fps) * 10) / 10;
  const gainedPct = Math.round(((to.fps - from.fps) / from.fps) * 1000) / 10;
  const within =
    predictedPct !== null && Math.abs(gainedPct - predictedPct) <= Math.max(5, predictedPct * 0.35);
  const verdict =
    predictedPct === null
      ? `فعلياً ${gainedPct > 0 ? '+' : ''}${gainedPct}٪ (${from.screenSize} ← ${to.screenSize}) — لا تنبؤ لهذا الانتقال`
      : within
        ? `فعلياً ${gainedPct > 0 ? '+' : ''}${gainedPct}٪ مقابل تنبؤ ${predictedPct}٪ — النموذج قريب`
        : `فعلياً ${gainedPct > 0 ? '+' : ''}${gainedPct}٪ مقابل تنبؤ ${predictedPct}٪ — النموذج أخطأ، والنموذج يُصحَّح لا يُدافَع عنه`;
  return { from, to, gained, gainedPct, predictedPct, verdict };
}

/** Sessions for one game, newest first -- what the panel graphs. */
export function sessionsFor(all: Session[], gameId: string): Session[] {
  return all
    .filter((s) => s.gameId === gameId)
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}

/**
 * Points for a simple sparkline, scaled to the data.
 *
 * Returns an empty array rather than a flat line at zero when there is nothing to draw:
 * a chart of no data that looks like "0 fps" is a false statement, not an empty state.
 */
export function sparkline(values: number[], width = 100, height = 28): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
    })
    .join(' ');
}
