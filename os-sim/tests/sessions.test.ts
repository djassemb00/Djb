import { describe, expect, it } from 'vitest';
import {
  compareSessions,
  makeSession,
  readingOf,
  sessionsFor,
  sparkline,
  type Session,
} from '../src/system/sessions';
import { advise, estimateFpsGainPct } from '../src/system/decide';
import { parseProfile } from '../src/system/profileSchema';

/**
 * PLAN ٤-٣ + ٤-٤: a hand-entered result must produce a VALID session, and the panel must
 * not draw a chart out of nothing.
 *
 * The ٤-٣ acceptance criterion is "a three-field form produces a valid `result`". The
 * subtle failure is `Number('') === 0`: an empty temperature box becomes 0 °C, which is a
 * plausible-looking reading that passes every range check and then corrupts the graph. That
 * case is tested explicitly below.
 */

const base = {
  gameId: 'gta5',
  screenSize: '1280x720',
  fps: 18,
  now: Date.UTC(2026, 10, 27),
};

describe('٤-٣ the three-field form produces a valid session', () => {
  it('accepts frames, temperature and minutes', () => {
    const r = makeSession({ ...base, tempC: 44, minutes: 15 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.fps).toBe(18);
    expect(r.session.tempC).toBe(44);
    expect(r.session.minutes).toBe(15);
    expect(r.session.date).toBe('2026-11-27');
  });

  it('an empty temperature is MISSING, never 0 °C', () => {
    /*
     * `Number('')` is 0 and `0` passes every plausible range check, so a user who leaves
     * the box empty would silently record a 0 °C reading. The field must come back null.
     */
    const r = makeSession({ ...base, tempC: '', minutes: '' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.tempC).toBeNull();
    expect(r.session.minutes).toBeNull();
    // and the reading handed to the decision table omits it rather than passing 0
    const reading = readingOf(r.session);
    expect(reading.tempC).toBeUndefined();
    expect(reading.minutes).toBeUndefined();
  });

  it('refuses an empty frame rate instead of recording 0 fps', () => {
    const r = makeSession({ ...base, fps: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.field)).toContain('fps');
      expect(r.issues[0].message).toMatch(/[؀-ۿ]/);
    }
  });

  it('refuses a literal 0 frame rate', () => {
    /*
     * "0" is not an empty box -- it is an explicit claim, and a game rendering zero frames
     * was not running. Accepting it would put a 0 on the graph and drag every average down.
     * No test covered this until a mutation removing the `fps <= 0` guard survived, because
     * every other case reached the empty-string branch first.
     */
    const r = makeSession({ ...base, fps: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('٠');
    expect(makeSession({ ...base, fps: '0' }).ok).toBe(false);
  });

  it('names the field that was wrong, not just "invalid"', () => {
    const r = makeSession({ ...base, screenSize: '720p', tempC: 400 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.issues.map((i) => i.field);
      expect(fields).toContain('screenSize');
      expect(fields).toContain('tempC');
    }
  });

  it('accepts numeric strings, because that is what a form gives', () => {
    const r = makeSession({ ...base, fps: '24.5', tempC: '41' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.fps).toBe(24.5);
  });
});

describe('٤-٣ the session feeds the decision table unchanged', () => {
  it('a recorded slow GPU-bound session produces the resolution advice', () => {
    const r = makeSession({ ...base, fps: 18 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reading = { ...readingOf(r.session), gpuBusy: 98 };
    const out = advise(reading);
    expect(out[0]?.id).toBe('resolution');
    expect(out[0]?.sets?.value).toBe('960x540');
  });

  it('a session with no temperature cannot trigger the thermal rule', () => {
    // the rule needs a real reading; a missing one must not be treated as "cool"
    const r = makeSession({ ...base, fps: 40 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const out = advise({ ...readingOf(r.session), minutes: 20 });
    expect(out.map((s) => s.id)).not.toContain('thermal');
  });
});

describe('٤-٤ comparing two sessions checks the model against reality', () => {
  const older: Session = {
    id: 'gta5-1',
    gameId: 'gta5',
    date: '2026-11-20',
    screenSize: '1280x720',
    fps: 18,
    tempC: 42,
    minutes: 15,
    source: 'user',
  };
  const newer: Session = { ...older, id: 'gta5-2', date: '2026-11-27', screenSize: '960x540', fps: 24 };

  it('computes the actual gain and compares it to the prediction', () => {
    const predicted = estimateFpsGainPct('1280x720', '960x540');
    const c = compareSessions(older, newer, predicted);
    expect(c).not.toBeNull();
    if (!c) return;
    expect(c.gained).toBe(6);
    expect(c.gainedPct).toBeCloseTo(33.3, 1);
    // the model said ~30.7%, reality said ~33.3%: inside tolerance, and it says so
    expect(c.verdict).toContain('النموذج قريب');
    expect(c.verdict).toContain('33.3');
  });

  it('says the model was wrong when it was, instead of hiding it', () => {
    /*
     * The whole point of the comparison is that a wrong model gets corrected. A verdict
     * that only ever says "close" would be the "correction beats defending a claim" rule
     * being broken by the code itself.
     */
    const flat: Session = { ...older, id: 'gta5-3', date: '2026-11-27', screenSize: '960x540', fps: 18.5 };
    const c = compareSessions(older, flat, estimateFpsGainPct('1280x720', '960x540'));
    expect(c).not.toBeNull();
    if (!c) return;
    // +2.8% actual against ~+30% predicted
    expect(c.gainedPct).toBeLessThan(10);
    expect(c.verdict).toContain('أخطأ');
  });

  it('refuses a comparison that would be meaningless', () => {
    // different game
    expect(compareSessions(older, { ...newer, gameId: 'other' }, 30)).toBeNull();
    // same resolution: nothing was changed, so there is no effect to measure
    expect(compareSessions(older, { ...newer, screenSize: '1280x720' }, 30)).toBeNull();
  });

  it('orders the pair itself rather than trusting argument order', () => {
    const c = compareSessions(newer, older, 30);
    expect(c?.from.date).toBe('2026-11-20');
    expect(c?.to.date).toBe('2026-11-27');
  });
});

describe('٤-٤ the panel draws only what exists', () => {
  it('returns no path for no data, rather than a flat line at zero', () => {
    // a sparkline of nothing that looks like "0 fps" is a false statement
    expect(sparkline([])).toBe('');
  });

  it('draws a flat line for a series of equal values, at mid-height', () => {
    // constant data is real data: it must still be visible, not divided by a zero span
    const path = sparkline([30, 30, 30]);
    expect(path.split(' ')).toHaveLength(3);
    for (const pt of path.split(' ')) expect(Number(pt.split(',')[1])).toBe(28);
  });

  it('lists a game\'s sessions newest first and nobody else\'s', () => {
    const all: Session[] = [
      { id: 'a', gameId: 'gta5', date: '2026-11-20', screenSize: '1280x720', fps: 18, tempC: null, minutes: null, source: 'user' },
      { id: 'b', gameId: 'other', date: '2026-11-25', screenSize: '1280x720', fps: 60, tempC: null, minutes: null, source: 'user' },
      { id: 'c', gameId: 'gta5', date: '2026-11-27', screenSize: '960x540', fps: 24, tempC: null, minutes: null, source: 'user' },
    ];
    const mine = sessionsFor(all, 'gta5');
    expect(mine.map((s) => s.id)).toEqual(['c', 'a']);
  });
});

describe('the session shape stays compatible with the profile schema', () => {
  it('a session maps onto the profile result block the schema already validates', async () => {
    /*
     * ٤-٣ says the entry "contributes to the rule". The natural place for it is the
     * `result` block of the profile document, so this asserts the two agree rather than
     * growing a second, incompatible result format.
     */
    const r = makeSession({ ...base, fps: 28, tempC: 46, minutes: 15 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { generateProfile, toContainerJson } = await import('../src/system/winePrefix');
    const doc = {
      schema: 1 as const,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: JSON.parse(toContainerJson(generateProfile({ title: 'GTA V' }))),
      result: {
        fps: r.session.fps,
        ...(r.session.tempC !== null ? { tempC: r.session.tempC } : {}),
        ...(r.session.minutes !== null ? { minutes: r.session.minutes } : {}),
        source: 'user',
      },
      meta: { author: 'nova', created: r.session.date, verifiedOnDevice: false },
    };
    const parsed = parseProfile(doc);
    expect(parsed.ok, JSON.stringify(parsed.ok ? '' : parsed.issues)).toBe(true);
  });

  it('a "measured" source still needs a temperature, even from a session', () => {
    // the schema rule must not be bypassed by entering the data through the panel
    const doc = {
      schema: 1 as const,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: {},
      result: { fps: 30, source: 'measured' },
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    };
    expect(parseProfile(doc).ok).toBe(false);
  });
});
