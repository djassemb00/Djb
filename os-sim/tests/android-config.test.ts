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
    expect((css.match(/var\(--safe-/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(read('index.html')).toContain('viewport-fit=cover');
    expect(read('android/app/src/main/res/values/styles.xml')).toContain('windowDrawsSystemBarBackgrounds');
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
