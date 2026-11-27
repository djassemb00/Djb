/**
 * The two pure decisions inside NovaVM, lifted out of vm.ts so they can be tested.
 *
 * vm.ts imports v86 at module scope, which means no unit test can reach anything in it:
 * creating the emulator needs a real DOM, a WebAssembly build and a multi-megabyte BIOS.
 * Both of the defects found in this cycle were arithmetic in that file, and both would
 * have been caught by a test of two lines. So the arithmetic now lives here.
 */

export const THROTTLE_PERIOD_MS = 200;

/**
 * How long the CPU runs per throttle period.
 *
 * Returns 0 for "park the CPU" and the full period for "no throttle", so the caller has
 * one number to branch on instead of three cases.
 */
export function throttleActiveMs(factor: number, period = THROTTLE_PERIOD_MS): number {
  const f = Math.min(1, Math.max(0, Number.isFinite(factor) ? factor : 1));
  if (f <= 0) return 0;
  if (f >= 1) return period;
  return Math.max(1, Math.min(period - 1, Math.round(period * f)));
}

/**
 * The order in which throttle phases alternate, and for how long.
 *
 * The old scheduler scheduled the next toggle with the CURRENT phase's duration, which
 * inverted the duty cycle: at 25% the guest ran for 150 ms and stopped for 50 ms. Given
 * `active` ms of running per `period`, the run phase is `active` and the stop phase is
 * `period - active` -- in that order, starting from run.
 */
export function throttlePhaseMs(active: number, period = THROTTLE_PERIOD_MS): { run: number; stop: number } {
  const a = Math.max(0, Math.min(period, Math.round(active)));
  return { run: a, stop: period - a };
}

/** Fraction of wall-clock time the CPU actually runs, given the same numbers as above. */
export function dutyCycle(active: number, period = THROTTLE_PERIOD_MS): number {
  if (period <= 0) return 0;
  return Math.max(0, Math.min(1, active / period));
}

/**
 * Size of the guest's data disk, in bytes.
 *
 * A disk may GROW between sessions (the guest is given a bigger one, or the saved image
 * came from a bigger one) but must never SHRINK to fit a smaller saved image: shrinking
 * silently zeroes every byte past the new end. The old code used the requested size
 * whenever it was non-zero, so a user whose disk had grown from 1 MB to 3 MB lost 2 MB
 * of files on the next boot that still asked for 1 MB.
 */
export function dataDiskSize(requested: number, restoredBytes: number): number {
  const req = Math.max(0, Math.trunc(requested || 0));
  const got = Math.max(0, Math.trunc(restoredBytes || 0));
  return Math.max(req, got);
}
