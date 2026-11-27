import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { readNetInfo, describeNet, UNREADABLE_BY_WEB } from '../src/system/netInfo';
import { readVitals, OUR_THREADS, UNMEASURABLE } from '../src/system/vitals';

/**
 * The UI told the user things that no API had said.
 *
 *   - Settings/network printed MAC A4:7B:09:1C:EE:22, IP 192.168.1.42 and
 *     "download 184.2 Mbps" as constants in the measurement font.
 *   - Monitor (مراقب النظام) drove CPU, RAM, a 30-second history graph and eight
 *     process rows from Math.random(), refreshing every 1.2 s.
 *   - Terminal's `free` printed the phone's RAM (8192M) as a constant, and `df` claimed
 *     an 8.0 GB filesystem that does not exist.
 *
 * All three are gone. These tests read the source so the class cannot come back, and
 * they exercise the replacement modules against synthetic inputs.
 */
const src = (p: string) => readFileSync(p, 'utf8');
const stripComments = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('no screen may invent a measurement', () => {
  it('the apps and components contain no Math.random outside tests', () => {
    const files = [
      ...readdirSync('src/apps').map((f) => `src/apps/${f}`),
      ...readdirSync('src/components').map((f) => `src/components/${f}`),
    ].filter((f) => /\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((f) => /Math\.random/.test(stripComments(src(f))));
    expect(offenders, `simulated telemetry in ${offenders.join(', ')}`).toEqual([]);
  });

  it('settings does not print a fabricated MAC, IP or throughput', () => {
    const t = stripComments(src('src/apps/SettingsApp.tsx'));
    for (const fake of ['A4:7B:09:1C:EE:22', '192.168.1.42', '184.2']) {
      expect(t, `${fake} is an invented constant`).not.toContain(fake);
    }
    // and it must say, in words, why those are missing
    expect(t).toContain('لا يمكن للتطبيق قراءتها');
  });

  it('terminal free/df report the emulated machine, not the phone', () => {
    const t = stripComments(src('src/apps/TerminalApp.tsx'));
    expect(t, 'the phone RAM constant is back').not.toContain('8192M  2416M');
    expect(t, '"8.0G" filesystem claim is back').not.toContain('8.0G');
    // free must read the guest's memoryMB from the machine descriptor
    expect(t).toContain('memoryMB');
  });

  it('monitor names the four things a web app cannot measure', () => {
    const t = stripComments(src('src/apps/MonitorApp.tsx'));
    // the component renders UNMEASURABLE from vitals.ts, so the link is what matters,
    // not a copy of the strings: assert it joins that constant AND that the constant is
    // the one holding the four facts.
    expect(t).toContain('{UNMEASURABLE.join(');
    expect(UNMEASURABLE).toHaveLength(4);
    // the old fake process list is gone, including the Android daemon we never ran
    expect(t).not.toContain('surfaceflinger');
  });
});

describe('netInfo reports only what the browser exposes', () => {
  it('with no navigator at all, nothing is claimed', () => {
    const n = readNetInfo(undefined as never);
    expect(n.online).toBe(false);
    expect(n.measured).toBe(false);
    expect(describeNet(n)).toBe('لا يمكن قراءة حالة الشبكة');
  });

  it('reads onLine and connection fields when they exist', () => {
    const n = readNetInfo({ onLine: true, connection: { type: 'wifi', effectiveType: '4g' } });
    expect(n).toMatchObject({ online: true, type: 'wifi', effective: '4g', measured: true });
    expect(describeNet(n)).toBe('wifi · 4g');
  });

  it('says "not connected" rather than guessing a type', () => {
    const n = readNetInfo({ onLine: false });
    expect(describeNet(n)).toBe('غير متصل');
  });

  it('a browser without connection.* still reports onLine honestly', () => {
    const n = readNetInfo({ onLine: true });
    expect(n).toMatchObject({ online: true, type: '', effective: '', measured: true });
    expect(describeNet(n)).toBe('متصل');
  });

  it('never contains a MAC or IP, because a web app cannot read one', () => {
    expect(UNREADABLE_BY_WEB).toEqual(['MAC', 'IP محلي']);
    const mod = stripComments(src('src/system/netInfo.ts'));
    expect(mod).not.toMatch(/[0-9a-f]{2}:[0-9a-f]{2}:[0-9a-f]{2}/i);
    expect(mod).not.toMatch(/192\.168\./);
  });
});

describe('vitals measures the app, not the phone', () => {
  it('returns null heap when the engine does not expose performance.memory', () => {
    const v = readVitals({}, { windows: 3, files: 12, notes: 2 });
    expect(v.heapMB).toBeNull();
    expect(v.measured).toBe(false);
    expect(v).toMatchObject({ windows: 3, files: 12, notes: 2 });
  });

  it('converts real heap bytes to MB', () => {
    const v = readVitals(
      { memory: { usedJSHeapSize: 64 * 1024 * 1024, jsHeapSizeLimit: 4096 * 1024 * 1024 } },
    );
    expect(v.heapMB).toBe(64);
    expect(v.heapLimitMB).toBe(4096);
    expect(v.measured).toBe(true);
  });

  it('every thread it lists is one this app really has', () => {
    expect(OUR_THREADS).toEqual(['main', 'render', 'emulator', 'audio']);
    // the old list called Android's surfaceflinger one of our processes
    expect(OUR_THREADS.join(' ')).not.toContain('surfaceflinger');
  });
});
