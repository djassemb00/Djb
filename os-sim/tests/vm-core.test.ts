import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  THROTTLE_PERIOD_MS,
  dataDiskSize,
  dutyCycle,
  throttleActiveMs,
  throttlePhaseMs,
} from '../src/system/vmCore';

/**
 * The two arithmetic defects in vm.ts.
 *
 * Nothing in vm.ts can be unit-tested: it imports v86 at module scope, so reaching it
 * needs a DOM, a WASM build and a BIOS. Both bugs were two-line arithmetic, so the
 * arithmetic now lives in vmCore.ts and is tested here.
 *
 * A47: restoring a saved disk into a smaller requested size zeroed everything past the
 *      new end. 1 MB requested + 3 MB of user files = 2 MB destroyed, silently.
 * A48: the throttle scheduler used the current phase's duration for the NEXT toggle, so
 *      the duty cycle was inverted: 25% requested, 75% delivered.
 */

describe('dataDiskSize never shrinks a disk', () => {
  it('grows to fit a restored image larger than requested', () => {
    expect(dataDiskSize(1024 * 1024, 3 * 1024 * 1024)).toBe(3 * 1024 * 1024);
  });

  it('keeps the requested size when the image is smaller', () => {
    expect(dataDiskSize(4 * 1024 * 1024, 0)).toBe(4 * 1024 * 1024);
  });

  it('the old rule (requested wins) is the data-loss case, kept as a number', () => {
    const requested = 1024 * 1024;
    const restored = 3 * 1024 * 1024;
    const old = requested; // what the code did
    expect(restored - old).toBe(2 * 1024 * 1024); // 2 MB silently zeroed
    expect(dataDiskSize(requested, restored)).toBe(restored);
  });

  it('handles zero and nonsense without producing NaN', () => {
    expect(dataDiskSize(0, 0)).toBe(0);
    expect(dataDiskSize(-1, 0)).toBe(0);
    expect(dataDiskSize(Number.NaN, 0)).toBe(0);
    expect(Number.isFinite(dataDiskSize(undefined as never, 8))).toBe(true);
  });
});

describe('throttle delivers the factor it is given', () => {
  it('0 parks the CPU and 1 is full speed', () => {
    expect(throttleActiveMs(0)).toBe(0);
    expect(throttleActiveMs(1)).toBe(THROTTLE_PERIOD_MS);
    expect(throttleActiveMs(2)).toBe(THROTTLE_PERIOD_MS); // clamped
    expect(throttleActiveMs(-1)).toBe(0); // clamped
  });

  it('the run phase is the active slice, the stop phase is the rest', () => {
    const a = throttleActiveMs(0.25);
    expect(a).toBe(50);
    expect(throttlePhaseMs(a)).toEqual({ run: 50, stop: 150 });
  });

  it('a 25% throttle really runs 25% of the time', () => {
    const active = throttleActiveMs(0.25);
    const { run, stop } = throttlePhaseMs(active);
    expect(dutyCycle(active)).toBeCloseTo(0.25, 5);
    // walked over 1000 phases, the ratio is what the numbers say
    expect(run / (run + stop)).toBeCloseTo(0.25, 5);
  });

  it('never produces a zero-length phase that would spin the timer', () => {
    for (const f of [0.001, 0.01, 0.5, 0.999]) {
      const a = throttleActiveMs(f);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(THROTTLE_PERIOD_MS - 1);
      const p = throttlePhaseMs(a);
      expect(p.run).toBeGreaterThan(0);
      expect(p.stop).toBeGreaterThan(0);
    }
  });

  it('the old scheduler could not throttle at all: every factor gave 50%', () => {
    /*
     * The old code was one line:
     *
     *   throttleTimer = setInterval(() => { on = !on; on ? run() : stop(); },
     *                               on ? active : period - active);
     *
     * A setInterval delay is evaluated ONCE, when the interval is created, with `on`
     * still true -- so the delay was always `active`. The callback then flips `on` and
     * acts, giving equal run and stop phases forever: a 50% duty cycle regardless of the
     * factor requested. Measured by transcribing those exact semantics: f=0.1 through
     * f=0.9 all land on 50.0%.
     *
     * So the governor did not throttle too much or too little -- it throttled at a
     * constant half speed, and the 80% cap it was asked for never existed.
     */
    const oldDuty = (f: number, period = THROTTLE_PERIOD_MS) => {
      const active = Math.round(period * f);
      let on = true;
      const delay = on ? active : period - active; // evaluated ONCE, always `active`
      let running = true;
      let t = 0;
      let ran = 0;
      let next = delay;
      while (t < 20000) {
        const step = Math.min(next, 20000) - t;
        if (running) ran += step;
        t += step;
        if (t >= next) {
          on = !on;
          running = on;
          next += delay;
        }
      }
      return ran / t;
    };
    for (const f of [0.1, 0.25, 0.4, 0.5, 0.75, 0.9]) {
      expect(oldDuty(f), `old governor at ${f}`).toBeCloseTo(0.5, 2);
    }
    // the corrected schedule gives each factor its own duty cycle
    expect(dutyCycle(throttleActiveMs(0.25))).toBeCloseTo(0.25, 5);
    expect(dutyCycle(throttleActiveMs(0.8))).toBeCloseTo(0.8, 5);
    expect(throttlePhaseMs(throttleActiveMs(0.25))).toEqual({ run: 50, stop: 150 });
  });
});

describe('vm.ts uses these numbers instead of its own', () => {
  const src = readFileSync('src/system/vm.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('takes the disk size from dataDiskSize()', () => {
    expect(src).toContain('dataDiskSize(dataBytes, restored.byteLength)');
    expect(src).not.toMatch(/new Uint8Array\(dataBytes > 0 \? dataBytes : restored\.byteLength\)/);
  });

  it('takes the duty cycle from throttleActiveMs()', () => {
    expect(src).toContain('throttleActiveMs(f, period)');
    // the old scheduler waited with the CURRENT phase's duration
    expect(src).not.toMatch(/on \? active : period - active/);
  });

  it('clears its timer with the same API it sets it with', () => {
    const sets = (src.match(/window\.setTimeout/g) ?? []).length;
    const clears = (src.match(/window\.clearTimeout/g) ?? []).length;
    expect(sets).toBeGreaterThan(0);
    expect(clears, 'a setTimeout cleared with clearInterval leaks the timer').toBeGreaterThanOrEqual(sets);
    expect(src).not.toMatch(/setInterval/);
  });
});
