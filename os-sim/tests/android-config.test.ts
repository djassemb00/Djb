import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/**
 * Guards for stage 1 that can be checked without a phone or an SDK.
 *
 * These are cheap, and each one caught (or would have caught) a mistake we actually
 * made: a packaging block in the wrong place, a targetSdk left behind, a plugin file
 * that is never registered, a missed edge-to-edge inset.
 */
const read = (p: string) => readFileSync(p, 'utf8');

describe('android stage 1', () => {
  it('targets API 36 with a toolchain that supports it', () => {
    const v = read('android/variables.gradle');
    expect(v).toMatch(/compileSdkVersion = 36/);
    expect(v).toMatch(/targetSdkVersion = 36/);
    expect(read('android/build.gradle')).toMatch(/com\.android\.tools\.build:gradle:8\.9\./);
    expect(read('android/gradle/wrapper/gradle-wrapper.properties')).toMatch(/gradle-8\.1[0-9]/);
  });

  it('declares 16 KB page packaging at module level, not inside defaultConfig', () => {
    const g = read('android/app/build.gradle');
    expect(g).toContain('useLegacyPackaging = false');
    const defaultBlock = g.slice(g.indexOf('defaultConfig'), g.indexOf('buildTypes'));
    expect(defaultBlock).not.toContain('packagingOptions'); // AGP rejects it there
    expect(g.includes('packaging {') || g.includes('packagingOptions {')).toBe(true);
  });

  it('has no native libraries, so the 16 KB rule has nothing to bite', () => {
    const dir = 'android/app/src/main/jniLibs';
    expect(existsSync(dir) ? readdirSync(dir).length : 0).toBe(0);
  });

  it('registers the thermal plugin before the bridge starts', () => {
    const activity = read('android/app/src/main/java/os/nova/shell/MainActivity.java');
    expect(activity).toContain('registerPlugin(ThermalPlugin.class)');
    expect(activity.indexOf('registerPlugin')).toBeLessThan(activity.indexOf('super.onCreate'));
  });

  it('matches Capacitor 7\'s Java 21 bytecode, not Java 17', () => {
    // capacitor/build.gradle compiles the library at VERSION_21 and
    // capacitor.build.gradle re-applies 21 to this module. Declaring 17 here produces
    // "class file has wrong version 65.0, should be 61.0" at compile time.
    const cap = read('node_modules/@capacitor/android/capacitor/build.gradle');
    expect(cap).toContain('JavaVersion.VERSION_21');
    const app = read('android/app/build.gradle');
    expect(app).toContain('sourceCompatibility JavaVersion.VERSION_21');
    expect(app).toContain("jvmTarget = '21'");
  });

  it('has no duplicate resource names in one folder', () => {
    // res/drawable/splash.xml next to res/drawable/splash.png is a hard
    // duplicate-resource error, not a tie-break, and it blocked the build.
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      );
    const names = walk('android/app/src/main/res')
      .filter((f) => /\.(xml|png|webp|jpg)$/.test(f))
      .map((f) => f.replace(/\.(xml|png|webp|jpg)$/, ''));
    expect(names.length).toBe(new Set(names).size);
  });

  it('resolves every @drawable/@color/@style/@string it references', () => {
    const res = 'android/app/src/main/res';
    const defined = new Set<string>();
    for (const f of ['values/colors.xml', 'values/strings.xml', 'values/styles.xml']) {
      const xml = read(`${res}/${f}`);
      for (const m of xml.matchAll(/<(color|string|style)\s+name="([^"]+)"/g)) {
        defined.add(m[2]);
      }
    }
    for (const f of readdirSync(`${res}/drawable`)) {
      defined.add(f.replace(/\.(xml|png|webp|jpg)$/, ''));
    }
    for (const f of readdirSync(`${res}/mipmap-anydpi-v26`)) {
      defined.add(f.replace(/\.(xml|png)$/, ''));
    }
    const files = ['AndroidManifest.xml', 'values/styles.xml'].map((f) =>
      f === 'AndroidManifest.xml' ? read('android/app/src/main/AndroidManifest.xml') : read(`${res}/${f}`),
    );
    const missing: string[] = [];
    for (const xml of files) {
      for (const m of xml.matchAll(/@(?:drawable|mipmap|color|style|string)\/([a-zA-Z0-9_]+)/g)) {
        if (!defined.has(m[1])) missing.push(m[1]);
      }
    }
    expect(missing).toEqual([]);
  });

  it('declares only manifest attributes that are public at API 36', () => {
    // Checked against aosp-mirror/platform_frameworks_base@android16-release
    // core/res/res/values/attrs_manifest.xml: showWhenLocked is public and documented
    // (I removed it on a wrong recollection and had to put it back), and turnScreenOn
    // sits next to it with no @hide either.
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:showWhenLocked="true"');
    expect(manifest).toContain('android:turnScreenOn="false"');
  });

  it('lets the native shell own the insets instead of trusting WebView env()', () => {
    // SafeAreaInsets.isSupported() is false for Theme.AppCompat, so env(safe-area-*)
    // is 0 in an AppCompat WebView. Capacitor's own edgeToEdgeHandler is the fix.
    expect(read('capacitor.config.ts')).toContain("adjustMarginsForEdgeToEdge: 'force'");
    const json = JSON.parse(read('android/app/src/main/assets/capacitor.config.json'));
    expect(json.android.adjustMarginsForEdgeToEdge).toBe('force');
  });

  it('keeps the Kotlin plugin inside the SDK levels the manifest allows', () => {
    const kt = read('android/app/src/main/java/os/nova/shell/ThermalPlugin.kt');
    // every API 29+ / 30+ call must sit behind its own guard
    expect(kt).toMatch(/VERSION_CODES\.Q[\s\S]{0,200}currentThermalStatus/);
    expect(kt).toMatch(/VERSION_CODES\.R[\s\S]{0,200}getThermalHeadroom/);
    expect(kt).not.toContain('uses-permission');
  });

  it('compensates for forced edge-to-edge with real insets', () => {
    const css = read('src/styles.css');
    expect(css).toContain('--safe-top: env(safe-area-inset-top');
    // the vars must actually be consumed, not just declared
    expect((css.match(/var\(--safe-/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read('index.html')).toContain('viewport-fit=cover');
    expect(read('android/app/src/main/res/values/styles.xml')).toContain('windowDrawsSystemBarBackgrounds');
  });

  it('puts the two floating desk buttons above the gesture bar', () => {
    // they were pinned at bottom:22 with no inset, which is exactly where MagicOS
    // draws its gesture handle.
    const app = read('src/App.tsx');
    const floating = app.slice(app.indexOf('aria-label="كل التطبيقات"'), app.indexOf('{launcher &&'));
    expect(floating).toContain('var(--safe-bottom)');
    expect(floating).not.toMatch(/bottom: 22,\n/);
  });

  it('intercepts back so one swipe does not throw the user out of the VM', () => {
    // strip comments: the file *explains* why we do not call exitApp, and a naive
    // substring test would flag its own documentation
    const back = read('src/system/backButton.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(back).toContain("addListener('backButton'");
    expect(back).toContain('minimizeApp');
    // never kill a running guest on a stray swipe
    expect(back).not.toMatch(/App\s*\.\s*exitApp\s*\(/);
    expect(read('src/App.tsx')).toContain('installBackHandler');
    expect(read('package.json')).toContain('@capacitor/app');
  });

  it('ships no Windows guest and no proprietary image', () => {
    const files = execSync('git ls-files public/ src/', { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => /windows101|win101/i.test(f))).toEqual([]);
    expect(readdirSync('public/images').filter((f) => /win/i.test(f))).toEqual([]);
  });

  it('carries the licence text BSD-2 requires', () => {
    expect(existsSync('public/licenses/v86-LICENSE.txt')).toBe(true);
    expect(read('public/licenses/v86-LICENSE.txt')).toContain('Redistribution');
    expect(read('src/apps/AboutApp.tsx')).toContain('CREDITS');
  });
});
