import { describe, expect, it } from 'vitest';
import { detectDevice } from '../src/system/deviceProfile';

/**
 * deviceProfile is prose that makes numeric claims to the user. It had no test, and the
 * first thing the test found was a fabricated figure: "drops to 71% in 30 minutes",
 * which no measurement supports (TechX measured 80% over 30 minutes on a Moto X30;
 * technosports/Beebom measured 87% after 8 minutes and 79% at worst on a OnePlus 10 Pro).
 */
const withUA = (ua: string) => {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua }, configurable: true });
  return detectDevice();
};

describe('device profile', () => {
  it('detects an Honor device and gives MagicOS steps, not Huawei ones', () => {
    const p = withUA('Mozilla/5.0 (Linux; Android 14; BVL-N49) HONOR/...');
    expect(p.vendor).toBe('honor');
    expect(p.label).toContain('MagicOS');
    expect(p.keepAlive.join(' ')).toContain('بدء التشغيل');
  });

  it('quotes a throttling figure that a real measurement supports', () => {
    const p = withUA('HONOR BVL-N49');
    const line = p.limits.find((l) => l.includes('Snapdragon 8 Gen 1')) ?? '';
    expect(line).toContain('٨٠٪'); // TechX, 30-minute CPU throttling test
    expect(line).not.toContain('٧١٪'); // the figure we could not source
  });

  it('does not assert AVF support either way, it says how to check', () => {
    const p = withUA('HONOR BVL-N49');
    const avf = p.limits.find((l) => l.includes('AVF')) ?? '';
    expect(avf).toContain('pm list features');
    expect(avf).toContain('virtualization_framework');
  });

  it('never promises a modern AAA title runs in the browser engine', () => {
    for (const ua of ['HONOR BVL-N49', 'SM-S928B', 'Redmi', 'unknown']) {
      const p = withUA(ua);
      expect(p.verdict).not.toMatch(/تعمل GTA|يشغّل Cyberpunk|ألعاب AAA تعمل/);
    }
  });

  it('falls back to a generic profile instead of throwing', () => {
    const p = withUA('Mozilla/5.0 (X11; Linux x86_64)');
    expect(p.vendor).toBe('generic');
    expect(p.keepAlive.length).toBeGreaterThan(0);
  });
});
