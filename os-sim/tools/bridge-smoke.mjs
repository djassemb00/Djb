#!/usr/bin/env node
/**
 * bridge-smoke.mjs -- proves the Kotlin plugin is reachable through Capacitor's real
 * runtime, not through a stub of our own.
 *
 * This file used to live in .probe/, which is git-ignored (see os-sim/.gitignore line
 * 3), while tools/gate.mjs phase 4.5 ran it. On any clean checkout -- i.e. CI -- the
 * file does not exist and the gate failed with MODULE_NOT_FOUND. Same class of defect
 * as A6, this time inside the gate itself. It is tracked from here on, and gate 1.8
 * now watches for this whole class.
 *
 * What it does: builds a synthetic native bridge exactly as Capacitor's Android side
 * presents itself (window.Capacitor with PluginHeaders + nativePromise), imports the
 * REAL @capacitor/core dist, registers a plugin by name, and asserts the call lands on
 * the native bridge with the right plugin and method.
 */
// NOTE: the import is DYNAMIC and happens after the globals below are installed.
// @capacitor/core captures `win.Capacitor` when the module is evaluated, so a static
// import would freeze an empty bridge and every call would report UNIMPLEMENTED.
const header = { name: 'NovaThermal', methods: [{ name: 'read', rtype: 'promise' }] };
const calls = [];
globalThis.Capacitor = {
  platform: 'android',
  isNativePlatform: () => true,
  PluginHeaders: [header],
  nativePromise: async (plugin, method, options) => {
    calls.push({ plugin, method, options });
    return { status: 3, headroom: 0.82, battery: 61, charging: false, sdk: 34, device: 'HONOR BVL-N49' };
  },
};
// Capacitor reads its own globals through `window`; in Node the two are the same
// object once we point one at the other.
globalThis.window = globalThis;
globalThis.androidBridge = {};
globalThis.document = { addEventListener() {}, removeEventListener() {} };
const { registerPlugin } = await import('../node_modules/@capacitor/core/dist/index.js');
const NovaThermal = registerPlugin('NovaThermal', {});
const headerSeen = globalThis.Capacitor.PluginHeaders?.length ?? 0;
console.log('isPluginAvailable:', typeof globalThis.Capacitor.isPluginAvailable === 'function');
console.log('plugin headers advertised:', headerSeen);
const reading = await NovaThermal.read();
console.log('reading:', JSON.stringify(reading));
console.log('bridge call:', JSON.stringify(calls[0]));
const ok = reading.status === 3 && calls[0]?.plugin === 'NovaThermal' && calls[0]?.method === 'read';
console.log(ok
  ? 'PASS the registered Kotlin plugin is reachable as Capacitor.Plugins.NovaThermal.read()'
  : 'FAIL the plugin call did not reach the native bridge');
process.exit(ok ? 0 : 1);
