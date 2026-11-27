import { describe, expect, it } from 'vitest';
import {
  BOX64_SAFE,
  advise,
  describeSuggestion,
  estimateFpsGainPct,
  nextResolutionDown,
  pixelReductionPct,
  pixels,
} from '../src/system/decide';
import { BOX64_PRESETS } from '../src/system/winePrefix';

/**
 * PLAN ٤-١: the decision table.
 *
 * The acceptance criterion is "every rule has exactly ONE suggestion plus an expected
 * number and a source". A table that fires five tips at once is not a decision, and a
 * number with no traceable origin is the defect this repo has removed twice already.
 */

describe('٤-١ the arithmetic is exact and shown', () => {
  it('counts pixels correctly for the two resolutions in play', () => {
    expect(pixels('1280x720')).toBe(921_600);
    expect(pixels('960x540')).toBe(518_400);
    expect(pixels('1920x1080')).toBe(2_073_600);
  });

  it('reports the pixel reduction as a number, not an adjective', () => {
    expect(pixelReductionPct('1280x720', '960x540')).toBeCloseTo(43.8, 1);
    expect(pixelReductionPct('1920x1080', '1280x720')).toBeCloseTo(55.6, 1);
  });

  it('refuses to compute a reduction in the wrong direction', () => {
    // upscaling is not a saving, and returning a positive "saving" would be a lie
    expect(pixelReductionPct('960x540', '1280x720')).toBeNull();
  });

  it('its own estimate lands inside the range the plan states', () => {
    /*
     * 720p → 540p: the plan's table promises +30..40%. My independent arithmetic
     * (43.8% fewer pixels, damped to 70% because a frame is not pure fill rate) gives
     * 30.7%. Two routes to the same band is the strongest thing available here without a
     * device: neither number was copied from the other.
     */
    const gain = estimateFpsGainPct('1280x720', '960x540');
    expect(gain).toBeGreaterThanOrEqual(30);
    expect(gain).toBeLessThanOrEqual(40);
  });

  it('the published 1080p figure falls out of the same arithmetic', () => {
    /*
     * androidgamehub.com says "rendering at 1080p costs ~40% FPS". The model here, applied
     * to 1080p→720p, says 38.9%. That agreement is evidence the damping constant is
     * roughly right -- it is not proof, and the source string says so.
     */
    const gain = estimateFpsGainPct('1920x1080', '1280x720');
    expect(gain).toBeGreaterThan(35);
    expect(gain).toBeLessThan(42);
  });

  it('walks down the 16:9 ladder only', () => {
    expect(nextResolutionDown('1280x720')).toBe('960x540');
    expect(nextResolutionDown('1920x1080')).toBe('1600x900');
    // the bottom of the ladder: no further 16:9 step, so no suggestion
    expect(nextResolutionDown('960x540')).toBeNull();
    // a 4:3 container would letterbox on a 16:9 panel; refuse rather than shrink
    expect(nextResolutionDown('800x600')).toBeNull();
  });
});

describe('٤-١ one suggestion at a time', () => {
  it('a GPU-bound slow run gets the resolution drop, and only that', () => {
    const out = advise({ fps: 18, gpuBusy: 98, cpuBusy: 40, screenSize: '1280x720' });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('resolution');
    expect(out[0].sets).toEqual({ key: 'screenSize', value: '960x540' });
    // the expected figure must be a number in the text, and labelled an estimate
    expect(out[0].expected.text).toMatch(/\+3\d(\.\d)?٪/);
    expect(out[0].basis).toBe('estimate');
    expect(out[0].source).toContain('921 600');
  });

  it('a CPU-bound slow run gets the preset, never a non-existent one', () => {
    const out = advise({ fps: 18, gpuBusy: 40, cpuBusy: 97, screenSize: '1280x720' });
    const preset = out.find((s) => s.id === 'cpu-preset');
    expect(preset, 'no preset suggestion').toBeTruthy();
    const value = preset?.sets?.value ?? '';
    // the plan said COMPATIBILITY; Box64Preset.java has no such value
    expect(value).not.toBe('COMPATIBILITY');
    expect(BOX64_PRESETS).toContain(value);
  });

  it('does not pretend it can set the emulator from a container file', () => {
    /*
     * The plan's rule says "try COMPATIBILITY or FEX". `emulator` is one of the keys
     * Container.loadData ignores (A55), so a suggestion that wrote it would produce a file
     * line that does nothing. It is surfaced as a Winlator-screen instruction instead, with
     * no `sets` at all.
     */
    const out = advise({ fps: 18, cpuBusy: 97, screenSize: '1280x720' });
    const fex = out.find((s) => s.id === 'cpu-fex');
    expect(fex, 'the FEX advice disappeared entirely').toBeTruthy();
    expect(fex?.kind).toBe('winlator-ui');
    expect(fex?.sets).toBeUndefined();
    expect(fex?.action).toContain('Winlator');
    // and it must explain WHY it is not a file setting
    expect(fex?.action).toContain('emulator');
  });

  it('heat comes before performance, because more pixels at 43°C is worse', () => {
    const out = advise({ fps: 18, gpuBusy: 98, tempC: 46, minutes: 12, screenSize: '1280x720' });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('thermal');
    // specifically NOT the resolution tip, even though fps and gpuBusy also qualify
    expect(out.map((s) => s.id)).not.toContain('resolution');
  });

  it('does not cry heat before ten minutes', () => {
    const out = advise({ fps: 30, tempC: 45, minutes: 3, screenSize: '1280x720' });
    expect(out.map((s) => s.id)).not.toContain('thermal');
  });

  it('says nothing when nothing is wrong, instead of inventing advice', () => {
    const out = advise({ fps: 45, gpuBusy: 60, cpuBusy: 50, tempC: 38, minutes: 20, screenSize: '1280x720' });
    expect(out).toEqual([]);
  });

  it('handles a missing GPU reading without guessing it is fine', () => {
    // an absent reading is not "0% busy": the resolution rule simply cannot fire
    const out = advise({ fps: 18, screenSize: '1280x720' });
    expect(out).toEqual([]);
  });

  it('never emits more than one container write per advice', () => {
    for (const reading of [
      { fps: 10, gpuBusy: 99, screenSize: '1280x720' },
      { fps: 10, cpuBusy: 99, screenSize: '1280x720' },
      { fps: 10, gpuBusy: 99, tempC: 50, minutes: 20, screenSize: '1280x720' },
    ]) {
      const writes = advise(reading).filter((s) => s.sets);
      expect(writes.length, `two writes in one advice for ${JSON.stringify(reading)}`).toBeLessThanOrEqual(1);
    }
  });
});

describe('٤-١ every rule carries a traceable source', () => {
  const readings = [
    { fps: 18, gpuBusy: 98, screenSize: '1280x720' },
    { fps: 18, cpuBusy: 97, screenSize: '1280x720' },
    { fps: 18, tempC: 46, minutes: 12, screenSize: '1280x720' },
    { fps: 18, freeRamGB: 0.5, screenSize: '1280x720' },
    { fps: 18, frozeOnBoot: true, screenSize: '1280x720' },
  ];

  it('no suggestion has an empty source or a vague expected effect', () => {
    for (const r of readings) {
      for (const s of advise(r)) {
        expect(s.source.length, `empty source for ${s.id}`).toBeGreaterThan(12);
        expect(s.expected.text.length, `empty expected for ${s.id}`).toBeGreaterThan(3);
        expect(s.basis).toMatch(/^(measured|reported|estimate)$/);
        // a description must state the confidence, not only the action
        expect(describeSuggestion(s)).toContain('·');
      }
    }
  });

  it('an estimate is never described as measured', () => {
    const s = advise({ fps: 18, gpuBusy: 98, screenSize: '1280x720' })[0];
    expect(s.basis).toBe('estimate');
    expect(describeSuggestion(s)).toContain('تقدير');
  });
});

describe('٤-١ the preset constant is checked against the real enum', () => {
  it('BOX64_SAFE is a value Box64Preset.java defines', () => {
    expect(BOX64_PRESETS).toContain(BOX64_SAFE);
    expect(BOX64_SAFE).not.toBe('COMPATIBILITY');
  });
});
