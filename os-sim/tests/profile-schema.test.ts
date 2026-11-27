import { describe, expect, it } from 'vitest';
import {
  BOX64_PRESET_VALUES,
  WINLATOR_READ_KEYS,
  buildProfile,
  containerFromProfile,
  parseProfile,
} from '../src/system/profileSchema';
import { DEFAULT_ENV_VARS, generateProfile, mergeEnv, toContainerJson } from '../src/system/winePrefix';
import winlatorKeys from './fixtures/winlator-keys.json';

/**
 * PLAN ٣-١ / ٣-٢: a profile is validated against the twenty keys Winlator actually reads.
 *
 * The acceptance criterion in the plan is specific: "a wrong file is rejected with a
 * clear Arabic message". That means a test asserting only `ok === false` is not enough --
 * a library default message ("Invalid input") would pass it. Every rejection test below
 * asserts the Arabic message names the offending thing.
 */

/** a complete document built from our real generator, not from a hand-written sample */
const goodDoc = () => {
  const p = generateProfile({ title: 'GTA V', is32: false, dx9: false });
  const container = JSON.parse(toContainerJson(p));
  const built = buildProfile({
    id: 'gta5',
    title: 'GTA V',
    year: 2013,
    sizeGB: 118,
    soc: 'sd8gen1',
    gpu: 'adreno730',
    ramGB: 8,
    container,
    result: { fps: 28, tempC: 46, minutes: 15, source: 'measured' },
    author: 'nova',
    created: '2026-11-27',
    verifiedOnDevice: false,
  });
  if (!built.ok) throw new Error('fixture rejected: ' + JSON.stringify(built.issues));
  return { profile: built.profile, container };
};

describe('٣-١ the schema accepts what we actually generate', () => {
  it('a profile built from generateProfile + toContainerJson validates', () => {
    const { profile } = goodDoc();
    const again = parseProfile(profile);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.profile.game.id).toBe('gta5');
  });

  it('EVERY key we export is one of the twenty Winlator reads', () => {
    /*
     * This is the ٣-٢ acceptance test and it is deliberately not a copy of our own output:
     * the expected list comes from the fixture transcribed from Container.java. A key we
     * write that Winlator ignores is invisible at runtime -- it loads, it is dropped, and
     * the container behaves as if the line were never there.
     */
    const p = generateProfile({ title: 'Test', is32: false, dx9: false });
    const written = Object.keys(JSON.parse(toContainerJson(p)));
    const unknown = written.filter((k) => !WINLATOR_READ_KEYS.includes(k));
    expect(unknown, `keys we write that Winlator ignores: ${unknown.join(', ')}`).toEqual([]);
    expect(WINLATOR_READ_KEYS.length).toBe(20);
  });

  it('rejects a key outside the twenty, naming the key and the count', () => {
    const { container } = goodDoc();
    // `emulator` is the exact key we used to write and Winlator silently ignored (A55)
    const bad = { ...container, emulator: 'FEXCore' };
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: bad,
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msg = r.issues.map((i) => i.message).join(' ');
    expect(msg).toContain('emulator');
    expect(msg).toContain('20');
    // the message must be Arabic prose, not a library default
    expect(msg).toMatch(/[؀-ۿ]/);
  });

  it('names every unknown key, not just the first', () => {
    const { container } = goodDoc();
    const bad = { ...container, emulator: 'FEXCore', fullscreenMode: '1', inputType: '4' };
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: bad,
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const paths = r.issues.map((i) => i.path);
    expect(paths).toContain('container.emulator');
    expect(paths).toContain('container.fullscreenMode');
    expect(paths).toContain('container.inputType');
  });

  it('rejects a box64Preset value Winlator does not define', () => {
    const { container } = goodDoc();
    // COMPATIBILITY was our invention; Box64Preset.java has no such constant (A57)
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: { ...container, box64Preset: 'COMPATIBILITY' },
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msg = r.issues.map((i) => i.message).join(' ');
      // the value must be named, and the five legal ones listed: "invalid" is not advice
      expect(msg).toContain('Box64');
      expect(msg).toContain('STABILITY');
      expect(msg).toContain('PERFORMANCE');
    }
    // and every value we do write is one of the five the enum holds
    expect(BOX64_PRESET_VALUES).toHaveLength(5);
    for (const preset of ['STABILITY', 'PERFORMANCE']) expect(BOX64_PRESET_VALUES).toContain(preset);
  });

  it('rejects a malformed screenSize with the expected shape in the message', () => {
    const { container } = goodDoc();
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: { ...container, screenSize: '720p' },
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('1280x720');
  });

  it('rejects malformed envVars, because Winlator drops a bad pair silently', () => {
    const { container } = goodDoc();
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: { ...container, envVars: 'BOX64_DYNAREC_CALLRET=1 NOT_A_PAIR' },
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('KEY=VALUE');
  });

  it('accepts the merged default env string we actually ship', () => {
    /*
     * An over-strict rule would reject our own generated file, so this asserts against
     * DEFAULT_ENV_VARS from winePrefix rather than against a sample written here.
     */
    const merged = mergeEnv(DEFAULT_ENV_VARS, [['BOX64_DYNAREC_CALLRET', '1']]);
    const { container } = goodDoc();
    const r = parseProfile({
      schema: 1,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container: { ...container, envVars: merged },
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    });
    expect(r.ok, JSON.stringify(r.ok ? '' : r.issues)).toBe(true);
  });
});

describe('the schema refuses numbers that cannot be measurements', () => {
  const base = (result?: unknown) => ({
    schema: 1 as const,
    game: { id: 'gta5', title: 'GTA V' },
    device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
    container: goodDoc().container,
    ...(result ? { result } : {}),
    meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
  });

  it('rejects a negative frame rate', () => {
    const r = parseProfile(base({ fps: -3, source: 'user' }));
    expect(r.ok).toBe(false);
  });

  it('rejects a temperature a phone cannot reach', () => {
    const r = parseProfile(base({ fps: 30, tempC: 400, source: 'measured' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('١٢٠');
  });

  it('rejects a "measured" result with no measured temperature', () => {
    // a number labelled measured without its condition is the defect this repo exists for
    const r = parseProfile(base({ fps: 30, source: 'measured' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('حرارة مقيسة');
  });

  it('accepts a community figure with no temperature', () => {
    // a community number is explicitly not our measurement, so it needs no conditions
    expect(parseProfile(base({ fps: 30, source: 'community' })).ok).toBe(true);
  });

  it('rejects an unknown source rather than guessing one', () => {
    expect(parseProfile(base({ fps: 30, source: 'trust-me' })).ok).toBe(false);
  });

  it('rejects a date that is not a date', () => {
    const r = parseProfile({
      ...base(),
      meta: { author: 'nova', created: '27/11/2026', verifiedOnDevice: false },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('YYYY-MM-DD');
  });
});

describe('٣-٥ export → import is byte for byte', () => {
  it('a profile reproduces the exact bytes of the container it came from', () => {
    /*
     * The plan's acceptance test: "a file exported on one device is imported on another
     * and produces the same container, byte for byte". Comparing against the real
     * `toContainerJson` output (not a stored copy) is what makes this a test of parity
     * rather than a test of a transcript.
     */
    const p = generateProfile({ title: 'GTA V', is32: false, dx9: false });
    const original = toContainerJson(p);
    const { profile } = goodDoc();
    const reproduced = containerFromProfile(profile);
    expect(reproduced).toBe(original);
  });

  it('32-bit and 64-bit profiles do not collide on the same title', () => {
    const a = generateProfile({ title: 'Game', is32: true });
    const b = generateProfile({ title: 'Game', is32: false });
    const ja = JSON.parse(toContainerJson(a));
    const jb = JSON.parse(toContainerJson(b));
    expect(ja.box64Preset).not.toBe(jb.box64Preset);
  });

  it('survives JSON string → parse → validate → container (the real file path)', () => {
    const { profile } = goodDoc();
    const file = JSON.stringify(profile);
    const reread = parseProfile(JSON.parse(file));
    expect(reread.ok).toBe(true);
    if (!reread.ok) return;
    expect(containerFromProfile(reread.profile)).toBe(containerFromProfile(profile));
  });
});

describe('the schema file itself', () => {
  it('takes the key list from the fixture, not a second hand-written copy', async () => {
    /*
     * A60 was a test that defined its own expectations and therefore agreed with invented
     * code. The defence is structural: the module imports the same fixture the test reads,
     * so there is no second list to drift.
     */
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/system/profileSchema.ts', 'utf8'),
    );
    expect(src).toContain("from '../../tests/fixtures/winlator-keys.json'");
    // and it must not contain a literal 20-key array of its own
    const literals = src.match(/'(audioDriver|wineVersion|startupSelection)'/g) ?? [];
    expect(literals.length).toBe(0);
    // the fixture and the module agree at runtime
    expect(WINLATOR_READ_KEYS).toEqual(winlatorKeys.readKeys);
  });
});

describe('٣-٦ every value written into the container has a stated reason', () => {
  /**
   * The acceptance criterion is "every value in the UI has a clickable reason line
   * explaining its source". Before this check, six rationale sentences covered eleven
   * written keys: `audioDriver`, `hudMode`, `startupSelection` and `wineVersion` reached
   * Winlator with no explanation anywhere in the UI, and nothing noticed.
   */
  const cases = [
    { is32: false, dx9: false },
    { is32: true, dx9: true },
  ];

  for (const flags of cases) {
    it(`covers every written key (32-bit=${flags.is32}, dx9=${flags.dx9})`, async () => {
      const { reasonsFor } = await import('../src/system/winePrefix');
      const p = generateProfile({ title: 'Test', ...flags });
      const written = Object.keys(JSON.parse(toContainerJson(p)));
      const explained = reasonsFor(p).map((r) => r.key);
      const missing = written.filter((k) => !explained.includes(k));
      expect(missing, `written with no reason: ${missing.join(', ')}`).toEqual([]);
    });
  }

  it('every reason names a source, and none is a bare "because"', async () => {
    const { reasonsFor } = await import('../src/system/winePrefix');
    const p = generateProfile({ title: 'Test', is32: false });
    for (const r of reasonsFor(p)) {
      expect(r.why.length, `empty reason for ${r.key}`).toBeGreaterThan(10);
      expect(r.source.length, `empty source for ${r.key}`).toBeGreaterThan(0);
      // a source must be traceable: a URL, a file/constant name, or an explicit dash
      expect(
        /https?:\/\/|\.java|\.ts|[A-Za-z_]{4,}/.test(r.source),
        `source for ${r.key} is not traceable: ${r.source}`,
      ).toBe(true);
    }
  });

  it('does not claim to explain keys we do not write', async () => {
    // a reason for a key that is never written is prose that costs bytes and means nothing
    const { reasonsFor } = await import('../src/system/winePrefix');
    const p = generateProfile({ title: 'Test', is32: false });
    const written = Object.keys(JSON.parse(toContainerJson(p)));
    const extra = reasonsFor(p).map((r) => r.key).filter((k) => !written.includes(k));
    expect(extra, `documented but never written: ${extra.join(', ')}`).toEqual([]);
  });
});

describe('the schema refuses what it would otherwise drop silently', () => {
  const base = () => {
    const { container } = goodDoc();
    return {
      schema: 1 as const,
      game: { id: 'gta5', title: 'GTA V' },
      device: { soc: 'sd8gen1', gpu: 'adreno730', ramGB: 8 },
      container,
      meta: { author: 'nova', created: '2026-11-27', verifiedOnDevice: false },
    };
  };

  it('rejects an unknown TOP-LEVEL key instead of stripping it', () => {
    /*
     * Found by probing the parser with a document carrying `evil`. valibot's `v.object`
     * strips unknown keys, so the parse succeeded and the extra key vanished -- the same
     * silent-drop shape as a container key Winlator ignores, one level up. A setting a
     * future build writes would disappear on import with the user told "accepted".
     */
    const r = parseProfile({ ...base(), privacy: 'off' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const msg = r.issues.map((i) => i.message).join(' ');
      expect(msg).toContain('privacy');
      expect(msg).toMatch(/[؀-ۿ]/);
    }
    // and the six real keys are all still accepted
    expect(parseProfile(base()).ok).toBe(true);
  });

  it('rejects a title carrying control characters', () => {
    // `A\nB` and `A\u0000B` both reached a UI label; containerFileName sanitises the FILE
    // name, but nothing sanitised what the user reads.
    const r = parseProfile({ ...base(), game: { id: 'a', title: 'A\nB' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.message).join(' ')).toContain('تحكّم');
    expect(parseProfile({ ...base(), game: { id: 'a', title: 'A\u0000B' } }).ok).toBe(false);
  });

  it('still accepts a normal Arabic title', () => {
    // the control-character rule must not reject the language the app is for
    expect(parseProfile({ ...base(), game: { id: 'a', title: 'لعبة عربية ٢٠٢٦' } }).ok).toBe(true);
  });
});
