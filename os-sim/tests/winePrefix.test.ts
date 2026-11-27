import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { containerFileName, generateProfile, toContainerJson } from '../src/system/winePrefix';

/**
 * Winlator parses a container with a fixed switch over 49 keys (Container.loadData).
 * The key list below is transcribed from that switch; it lives here as a fixture so
 * the suite keeps working without the Java source next to it.
 */
const ACCEPTED = new Set([
  'name', 'screenSize', 'envVars', 'cpuList', 'cpuListWoW64', 'graphicsDriver',
  'graphicsDriverConfig', 'emulator', 'wincomponents', 'dxwrapper', 'dxwrapperConfig',
  'drives', 'showFPS', 'fpsCounterConfig', 'fullscreenMode', 'screenAlignment',
  'fullscreenStretched', 'inputType', 'startupSelection', 'startupServices', 'extraData',
  'wineVersion', 'box64Version', 'emulator64', 'box64ecVersion', 'forceSsbs',
  'syncCpuTopology', 'fexcoreVersion', 'fexcorePreset', 'box64Preset',
  'fexcorePresetVars', 'box64PresetVars', 'audioDriver', 'desktopTheme', 'midiSoundFont',
  'lc_all', 'primaryController', 'controllerMapping', 'exclusiveXInput', 'bannerinXInput',
  'bannerinXInputSwitching', 'renderer', 'rendererNative', 'rendererNativeBackend',
  'rendererPresentMode', 'rendererDriverId', 'rendererFilterMode', 'rendererSwapRB',
  'rendererSfCompatMode',
]);

describe('Winlator container export', () => {
  it('emits only keys Winlator actually reads', () => {
    for (const input of [{ title: 'GTA V' }, { title: 'GTA 5 Lite', is32: true }, { title: 'Half-Life', dx9: true }]) {
      const obj = JSON.parse(toContainerJson(generateProfile(input)));
      const unknown = Object.keys(obj).filter((k) => !ACCEPTED.has(k));
      expect(unknown, `unknown keys for ${input.title}`).toEqual([]);
    }
  });

  it('uses slot ids and the comma form Winlator writes itself', () => {
    const obj = JSON.parse(toContainerJson(generateProfile({ title: 'GTA V' })));
    expect(obj.graphicsDriver).toBe('wrapper'); // slot id, not a label
    expect(obj.dxwrapper).toBe('dxvk+vkd3d');
    expect(obj.dxwrapperConfig.startsWith('version=')).toBe(true);
    expect(obj.screenSize).toBe('1280x720');
  });

  it('switches DXVK for DirectX 9 titles', () => {
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'x', dx9: true }))).dxwrapperConfig).toContain('version=1.10.3');
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'y' }))).dxwrapperConfig).toContain('version=2.4');
  });

  it('sets the Box64 preset from bitness', () => {
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'a' }))).box64Preset).toBe('PERFORMANCE');
    expect(JSON.parse(toContainerJson(generateProfile({ title: 'b', is32: true }))).box64Preset).toBe('COMPATIBILITY');
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
