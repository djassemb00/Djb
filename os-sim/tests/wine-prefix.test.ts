import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BOX64_PRESETS,
  DEFAULT_ENV_VARS,
  generateProfile,
  containerFileName,
  mergeEnv,
  toContainerJson,
} from '../src/system/winePrefix';

/**
 * The container export is the one artefact that leaves the app and gets loaded by someone
 * else's program, so every key in it has to be a key that program reads.
 *
 * Measured against brunodev85/winlator-app Container.java (transcribed to
 * tests/fixtures/winlator-keys.json): 20 readable keys, and our export used to write 19
 * of which 7 were ignored -- while claiming, in its own comments, to follow a "49-key
 * switch" from a fork whose source was never opened.
 */
const facts = JSON.parse(readFileSync('tests/fixtures/winlator-keys.json', 'utf8')) as {
  readKeys: string[];
  defaultEnvVars: string;
  box64Presets: string[];
};
const READ = new Set(facts.readKeys);

describe('every key we export is one Winlator reads', () => {
  it('the key table is the real one', () => {
    expect(facts.readKeys).toHaveLength(20);
    expect(READ.has('box64Preset')).toBe(true);
    expect(READ.has('envVars')).toBe(true);
    // keys the old export relied on that Winlator never reads
    for (const dead of ['emulator', 'emulator64', 'inputType', 'exclusiveXInput', 'fullscreenMode', 'lc_all']) {
      expect(READ.has(dead), `${dead} is not in the switch`).toBe(false);
    }
  });

  it('exports no unknown keys at all', () => {
    const keys = Object.keys(JSON.parse(toContainerJson(generateProfile({ title: 'T' }))));
    const unknown = keys.filter((k) => !READ.has(k));
    expect(unknown, `ignored by Winlator: ${unknown.join(', ')}`).toEqual([]);
  });

  it('writes the keys that carry a real decision', () => {
    const j = JSON.parse(toContainerJson(generateProfile({ title: 'T', is32: true })));
    for (const k of ['name', 'screenSize', 'envVars', 'box64Preset', 'dxwrapper', 'audioDriver']) {
      expect(j[k], k).toBeDefined();
    }
  });

  it('the output is valid JSON with a trailing newline and stable key order', () => {
    const a = toContainerJson(generateProfile({ title: 'GTA V' }));
    const b = toContainerJson(generateProfile({ title: 'GTA V' }));
    expect(a).toBe(b);
    expect(a.endsWith('\n')).toBe(true);
    const keys = Object.keys(JSON.parse(a));
    expect(keys).toEqual([...keys].sort());
  });
});

describe('values are ones Winlator defines, not ones we invented', () => {
  it('box64Preset is a real constant for both bitnesses', () => {
    for (const is32 of [true, false]) {
      const j = JSON.parse(toContainerJson(generateProfile({ title: 'T', is32 })));
      expect(facts.box64Presets, `${j.box64Preset} must exist in Box64Preset`).toContain(j.box64Preset);
    }
    // the value the old export wrote
    expect(facts.box64Presets).not.toContain('COMPATIBILITY');
    expect(BOX64_PRESETS).toEqual(facts.box64Presets);
  });

  it('envVars keeps Winlator defaults that would otherwise be replaced', () => {
    const j = JSON.parse(toContainerJson(generateProfile({ title: 'T' })));
    // supplying envVars REPLACES the default string, so the defaults must be merged in
    for (const kv of facts.defaultEnvVars.split(' ')) {
      const key = kv.split('=')[0];
      expect(j.envVars, `dropped Winlator default ${key}`).toContain(`${key}=`);
    }
    expect(j.envVars).toContain('WINEESYNC=1');
    expect(j.envVars).toContain('MESA_SHADER_CACHE_MAX_SIZE=512MB');
  });

  it('our tuning overrides a default with the same name', () => {
    const merged = mergeEnv('TU_DEBUG=noconform A=1', [['TU_DEBUG', 'noconform,sysmem']]);
    expect(merged).toContain('TU_DEBUG=noconform,sysmem');
    expect(merged).not.toContain('TU_DEBUG=noconform ');
    expect(merged).toContain('A=1');
  });

  it('mergeEnv is order-stable and later sources win', () => {
    expect(mergeEnv('a=1 b=2', 'b=3 c=4')).toBe('a=1 b=3 c=4');
    expect(mergeEnv('', '')).toBe('');
    expect(mergeEnv([['x', '1']], '')).toBe('x=1');
  });

  it('DEFAULT_ENV_VARS is the string from Container.java', () => {
    expect(DEFAULT_ENV_VARS).toBe(facts.defaultEnvVars);
  });

  it('the screen size is one Winlator accepts', () => {
    for (const device of ['sd8gen1', 'generic'] as const) {
      const j = JSON.parse(toContainerJson(generateProfile({ title: 'T', device })));
      expect(j.screenSize).toMatch(/^\d{3,4}x\d{3,4}$/);
      expect(j.screenSize.split('x').map(Number)).toEqual([
        generateProfile({ title: 'T', device }).width,
        generateProfile({ title: 'T', device }).height,
      ]);
    }
  });
});

describe('the profile says what it does', () => {
  it('does not claim a WOW64 setting the file never carries', () => {
    /*
     * The rationale said "WOW64: the file is 32-bit and will not run under 64-bit Wine
     * without it", but no exported key carried that decision. Now the decision is the
     * box64 preset, and the sentence describes it instead of a flag that does not exist.
     */
    const p = generateProfile({ title: 'T', is32: true });
    const j = JSON.parse(toContainerJson(p));
    const wowLine = p.rationale.find((r) => /WOW64|٣٢-بت/.test(r))!;
    expect(wowLine).toBeDefined();
    expect(wowLine).toContain(j.box64Preset);
    expect(p.rationale.join(' ')).not.toMatch(/WOW64 مطلوب|ولا يعمل تحت Wine ٦٤-بت بدونه/);
  });

  it('the FEXCore claim is gone, because the key carrying it was ignored', () => {
    const p = generateProfile({ title: 'T' });
    const j = JSON.parse(toContainerJson(p));
    expect(j.emulator).toBeUndefined();
    expect(p.rationale.join(' ')).not.toContain('FEXCore');
  });
});

describe('an Arabic title produces a distinct, usable file name', () => {
  it('keeps Arabic letters instead of collapsing to "prefix"', () => {
    expect(containerFileName('لعبة')).toBe('لعبة.container.json');
    expect(containerFileName('حرب النجوم')).toBe('حرب_النجوم.container.json');
  });

  it('two different titles never share a name', () => {
    const names = ['GTA V', 'لعبة', '!!!!', '', '   ', 'حرب', '???', '!!!'].map(containerFileName);
    expect(new Set(names).size, names.join(' ')).toBe(names.length);
  });

  it('strips path separators so a title cannot escape the folder', () => {
    for (const t of ['../../etc/passwd', 'a/b\\c', '.hidden']) {
      const n = containerFileName(t);
      expect(n).not.toContain('/');
      expect(n).not.toContain('\\');
      expect(n.endsWith('.container.json')).toBe(true);
    }
  });

  it('never returns an empty base', () => {
    expect(containerFileName('')).toMatch(/^prefix-[\da-z]+-[\da-z]+\.container\.json$/);
    expect(containerFileName('   ')).toMatch(/^prefix-[\da-z]+-[\da-z]+\.container\.json$/);
  });
});
