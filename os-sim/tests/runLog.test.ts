import { describe, expect, it } from 'vitest';
import { NO_LOG_REASON, describeParsedRun, parseWinlatorLog } from '../src/system/runLog';

/**
 * PLAN ٤-٢: the plan's premise was wrong, so what is tested is the correction.
 *
 * The plan says Winlator "writes a log inside its storage" and we can read it with SAF.
 * The source says otherwise: every child process is redirected to /dev/null unless a debug
 * callback is registered, and the rootfs lives in internal app storage. A picker built on
 * the plan's premise would open an empty folder -- a working-looking button that does
 * nothing, which is the defect class phase 2 removed.
 */
describe('٤-٢ the log does not exist, and we say so with sources', () => {
  it('states the refusal with file and line references', () => {
    expect(NO_LOG_REASON.found).toBe(false);
    expect(NO_LOG_REASON.detail).toContain('/dev/null');
    expect(NO_LOG_REASON.detail).toContain('getFilesDir');
    // the source cites the two files, because "trust me" is not a citation
    expect(NO_LOG_REASON.source).toContain('ProcessHelper.java');
    expect(NO_LOG_REASON.source).toContain('RootFS.java');
  });

  it('never claims a path exists that we could read', () => {
    // the plan's two candidate paths were external/Download and files/ -- neither is
    // reachable for the reasons above, so naming one as readable would be a false promise
    const text = `${NO_LOG_REASON.summary} ${NO_LOG_REASON.detail}`;
    expect(text).not.toContain('/storage/emulated/0');
  });
});

describe('٤-٢ the parser reads what the user pastes', () => {
  const log = [
    '[wine] preloader: start',
    'DXVK: v2.4.1',
    'info: screenSize=1280x720',
    'FrameRate 27.5',
    'battery temp 44.2°C',
    '[wine] exit code 0',
  ].join('\n');

  it('extracts the four fields, and shows the line each came from', () => {
    const p = parseWinlatorLog(log);
    expect(p.dxvkVersion).toBe('2.4.1');
    expect(p.fps).toBe(27.5);
    expect(p.screenSize).toBe('1280x720');
    expect(p.tempC).toBe(44.2);
    expect(p.missing).toEqual([]);
    // evidence, so the user can check us against their own text
    const fields = p.evidence.map((e) => e.field);
    expect(fields).toContain('fps');
    expect(fields).toContain('dxvkVersion');
    for (const e of p.evidence) expect(log).toContain(e.line);
  });

  it('does not invent a resolution from a bare number', () => {
    /*
     * The first rule of this parser: a wrong number is worse than a missing one, because
     * the decision table downstream trusts whatever it is handed. "1280" in a Wine trace is
     * not our resolution.
     */
    const p = parseWinlatorLog('[wine] buffer 1280\ncounter 60\nmemory 921600');
    expect(p.screenSize).toBeNull();
    expect(p.fps).toBeNull();
  });

  it('names what it could not find instead of returning silent nulls', () => {
    /*
     * Asserted as a bijection, not as three `toContain`s. Deleting any ONE of the four
     * `missing.push` lines used to leave this test green, because the other three still
     * satisfied the assertions -- so the check protected three quarters of the rule and
     * silently stopped covering the fourth.
     */
    const p = parseWinlatorLog('DXVK: v2.4\n[wine] exit');
    const fields: Array<[string, unknown]> = [
      ['إصدار DXVK', p.dxvkVersion],
      ['الإطارات', p.fps],
      ['الدقة', p.screenSize],
      ['الحرارة', p.tempC],
    ];
    for (const [label, value] of fields) {
      if (value === null) expect(p.missing, `missing does not name: ${label}`).toContain(label);
      else expect(p.missing, `${label} was read but still reported missing`).not.toContain(label);
    }
    // and the description says so in words
    expect(describeParsedRun(p)).toContain('ينقص');
  });

  it('reports a missing DXVK version too, not only the numeric fields', () => {
    /*
     * The bijection test above reads DXVK successfully, so every field it checked was
     * null except one -- and deleting the `dxvkVersion` branch of `missing` survived it.
     * A log with no DXVK line at all is the case that actually exercises that branch.
     */
    const p = parseWinlatorLog('screenSize=1280x720\nFPS 30\ntemp 40°C');
    expect(p.dxvkVersion).toBeNull();
    expect(p.missing).toContain('إصدار DXVK');
  });

  it('reports nothing missing when everything was read', () => {
    const p = parseWinlatorLog('DXVK: v2.4\nscreenSize=1280x720\nFPS 30\ntemp 40°C');
    expect(p.missing).toEqual([]);
  });

  it('keeps the last fifty lines, not the first', () => {
    // the interesting part of a log is the end: that is where the crash and the frame
    // counter are
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n');
    const p = parseWinlatorLog(long);
    expect(p.lines).toHaveLength(50);
    expect(p.lines[p.lines.length - 1]).toBe('line 79');
  });

  it('rejects an impossible frame rate rather than passing it downstream', () => {
    // "framerate 5000" is not a phone rendering a PC title; it is a misparse
    const p = parseWinlatorLog('FrameRate 5000');
    expect(p.fps).toBeNull();
    expect(p.missing).toContain('الإطارات');
  });

  it('says nothing was pasted when nothing was', () => {
    const p = parseWinlatorLog('   \n\n  ');
    expect(p.lines).toHaveLength(0);
    expect(describeParsedRun(p)).toContain('لم يُلصق');
  });
});
