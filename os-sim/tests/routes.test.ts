import { describe, expect, it } from 'vitest';
import { adviseRoute, isAaaSize, ENGINE_MIPS, NATIVE_MIPS } from '../src/system/routes';

/**
 * The routing module is what stops us from promising a modern AAA game runs inside a
 * WASM emulator. It had no test at all: an uncovered module that makes the project's
 * central honesty claim is the kind of gap this gate exists to remove.
 */
describe('route advice', () => {
  it('keeps the two measured ceilings honest', () => {
    // the app must never quote a number it did not measure: 70 MIPS is our own probe
    // (.probe/mips.test.ts), 5000 MIPS is the native core estimate
    expect(ENGINE_MIPS).toBe(70);
    expect(NATIVE_MIPS).toBe(5000);
    expect(NATIVE_MIPS / ENGINE_MIPS).toBeGreaterThan(50);
  });

  it('sends DOS programs to the in-app engine, with no Windows talk', () => {
    const r = adviseRoute({ dos: true });
    expect(r.route).toBe('in-app');
    expect(r.detail).toContain('DOS');
    expect(r.detail).not.toContain('Winlator');
  });

  it('refuses to route .NET rather than guessing', () => {
    expect(adviseRoute({ isDotNet: true }).route).toBe('none');
    expect(adviseRoute({ dotnet: true }).route).toBe('none');
    expect(adviseRoute({ isDotNet: true }).title).toBe('لا مسار على الهاتف');
  });

  it('never claims an in-app path for a Win32 binary, 32- or 64-bit', () => {
    expect(adviseRoute({ is64: false, bytes: 400_000 }).route).toBe('native');
    expect(adviseRoute({ is64: true, bytes: 400_000 }).route).toBe('native');
  });

  it('quotes a storage figure large enough for the game plus its Wine container', () => {
    const tiny = adviseRoute({ is64: false }).storage;
    expect(tiny).toBeUndefined(); // no size known -> no invented number
    const big = adviseRoute({ bytes: 3_000_000_000, is64: true });
    expect(big.storage).toMatch(/غيغا/);
    // 3 GB * 1.6 = 4.8 -> rounds up to 5, never down
    expect(big.storage).toContain('5');
  });

  it('marks AAA size before a huge download, and does not over-trigger', () => {
    expect(isAaaSize(80_000_000_000)).toBe(true);
    expect(isAaaSize(20_000_000_000)).toBe(false); // strictly greater
    expect(isAaaSize(0)).toBe(false);
  });

  it('promises 20-40 fps for big titles on the native path, not a fixed 60', () => {
    const r = adviseRoute({ bytes: 2_000_000_000, is64: true });
    expect(r.detail).toContain('٢٠–٤٠');
    expect(r.detail).not.toMatch(/\b60\b/);
  });
});
