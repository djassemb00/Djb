import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { containerFileName, generateProfile, toContainerJson } from '../src/system/winePrefix';

/**
 * The keys below come from tests/fixtures/winlator-keys.json, which is transcribed from
 * brunodev85/winlator-app `Container.java`. This test used to carry its OWN list of 49
 * keys -- a list that had never been checked against any source, naming keys
 * (`emulator`, `box64Version`, `rendererNativeBackend`, …) that Container.loadData does
 * not switch over. A test whose expectations are invented agrees with invented code.
 */
const FACTS = JSON.parse(readFileSync('tests/fixtures/winlator-keys.json', 'utf8')) as {
  readKeys: string[];
  box64Presets: string[];
};
const ACCEPTED = new Set(FACTS.readKeys);

describe('Winlator container export', () => {
  it('emits only keys Winlator actually reads', () => {
    for (const input of [{ title: 'GTA V' }, { title: 'GTA 5 Lite', is32: true }, { title: 'Half-Life', dx9: true }]) {
      const obj = JSON.parse(toContainerJson(generateProfile(input)));
      const unknown = Object.keys(obj).filter((k) => !ACCEPTED.has(k));
      expect(unknown, `unknown keys for ${input.title}`).toEqual([]);
    }
  });

  it('uses the comma form Winlator writes itself', () => {
    const obj = JSON.parse(toContainerJson(generateProfile({ title: 'GTA V' })));
    /*
     * "graphicsDriver: wrapper" and "dxwrapper: dxvk+vkd3d" were both inventions:
     * graphicsDriver names a Vulkan AND an OpenGL driver ("turnip,wrapper" style) and
     * dxwrapper is one of DXWrappers' identifiers, not a plus-joined pair. We now leave
     * both at Winlator's own defaults instead of guessing, so the keys are absent.
     */
    expect(obj.graphicsDriver).toBeUndefined();
    expect(obj.dxwrapper).toBe('dxvk');
    expect(obj.dxwrapperConfig.startsWith('version=')).toBe(true);
    expect(obj.screenSize).toBe('1280x720');
  });

  it('switches DXVK for DirectX 9 titles', () => {
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'x', dx9: true }))).dxwrapperConfig).toContain('version=1.10.3');
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'y' }))).dxwrapperConfig).toContain('version=2.4');
  });

  it('sets the Box64 preset from bitness, using a real constant', () => {
    const x64 = JSON.parse(toContainerJson(generateProfile({ title: 'a' }))).box64Preset;
    const x86 = JSON.parse(toContainerJson(generateProfile({ title: 'b', is32: true }))).box64Preset;
    expect(x64).toBe('PERFORMANCE');
    expect(x86).toBe('STABILITY');
    // whatever we emit must exist in Box64Preset -- "COMPATIBILITY" did not
    for (const v of [x64, x86]) expect(FACTS.box64Presets).toContain(v);
  });

  it('names the file per title and produces valid JSON', () => {
    const name = containerFileName('GTA V');
    expect(name).toBe('GTA_V.container.json');
    expect(() => JSON.parse(toContainerJson(generateProfile({ title: 'GTA V' })))).not.toThrow();
  });

  it('ships the licence of the engine we redistribute', () => {
    expect(existsSync('public/licenses/v86-LICENSE.txt')).toBe(true);
    expect(readFileSync('public/licenses/v86-LICENSE.txt', 'utf8')).toContain('Redistribution');
  });
});
