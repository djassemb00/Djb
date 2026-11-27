import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BACK_ORDER, SHEET_Z, planBack } from '../src/system/backButton';
import { adviseRoute, storageNeededGB, EXPANSION_MIN, CONTAINER_GB, GB } from '../src/system/routes';

/**
 * Two defects of the same shape: a decision table that was never checked against reality.
 *
 * A44: the back-press handlers were passed in the order center, launcher, power. The
 *      sheets paint at z 960, 970, 980 -- so with two of them open, back closed the one
 *      UNDERNEATH. The visible sheet stayed, the hidden one vanished.
 *
 * A45: the storage a Windows program needs was computed as `bytes * 1.6` and labelled
 *      "the game + a Wine container". A 1.6 GB download was quoted 3 GB when the honest
 *      figure is 6.3 GB (installed size expands ~3x, plus a ~1.5 GB container).
 */
const css = readFileSync('src/styles.css', 'utf8');
const zOf = (cls: string) => {
  const m = new RegExp(`\\n\\.${cls}\\s*\\{([^}]*)\\}`).exec(css);
  const z = m && /z-index:\s*(\d+)/.exec(m[1]);
  return z ? Number(z[1]) : null;
};

describe('back always closes the sheet the user can see', () => {
  it('the order matches the z-indexes in the stylesheet, not a hand-written list', () => {
    expect(zOf('nc')).toBe(SHEET_Z.center);
    expect(zOf('launcher')).toBe(SHEET_Z.launcher);
    expect(zOf('power-menu')).toBe(SHEET_Z.power);
    // derived order: highest z first
    expect(BACK_ORDER).toEqual(['power', 'launcher', 'center', 'machine', 'desk']);
  });

  it('with every sheet open, back closes the power menu', () => {
    expect(planBack({ center: true, launcher: true, power: true, machine: false })).toBe('power');
  });

  it('with the notification centre and the launcher open, back closes the launcher', () => {
    // this is the exact pair that used to break: center (960) must not win over launcher (970)
    expect(planBack({ center: true, launcher: true, power: false, machine: false })).toBe('launcher');
  });

  it('the launcher outranks the notification centre in every combination', () => {
    for (const power of [false, true]) {
      for (const machine of [false, true]) {
        const layer = planBack({ center: true, launcher: true, power, machine });
        if (power) expect(layer).toBe('power');
        else expect(layer, `power=${power} machine=${machine}`).toBe('launcher');
      }
    }
  });

  it('the machine is above the desk but below any sheet', () => {
    expect(planBack({ center: false, launcher: false, power: false, machine: true })).toBe('machine');
    expect(planBack({ center: true, launcher: false, power: false, machine: true })).toBe('center');
  });

  it('with nothing open, it declines instead of exiting the app', () => {
    // 'desk' means: return false, let Android pause/exit. Never App.exitApp().
    expect(planBack({ center: false, launcher: false, power: false, machine: false })).toBe('desk');
    // strip comments: the file explains IN PROSE that it never calls exitApp, and an
    // assertion on raw text counted that explanation as a violation (A34 again).
    const code = readFileSync('src/system/backButton.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/exitApp\s*\(/);
  });

  it('App.tsx uses the plan instead of a hand-ordered stack', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('planBack(');
    expect(app).not.toMatch(/\(\) => center && \(setCenter\(false\), true\)/);
  });
});

describe('the storage figure is a real requirement', () => {
  it('states both multipliers it uses', () => {
    expect(EXPANSION_MIN).toBe(3);
    expect(CONTAINER_GB).toBe(1.5);
  });

  it('a 1.6 GB download needs 7 GB, not the 3 GB it used to quote', () => {
    const b = 1.6 * GB;
    expect(storageNeededGB(b)).toBe(7);
    // the old formula, kept here as a number so the regression is visible
    const old = Math.ceil((b * 1.6) / GB);
    expect(old).toBe(3);
    expect(storageNeededGB(b)).toBeGreaterThan(old);
  });

  it('never quotes less than the download itself plus the container', () => {
    for (const gb of [0.2, 1, 4, 12, 60, 118]) {
      const need = storageNeededGB(gb * GB);
      expect(need).toBeGreaterThan(gb);
      expect(need).toBeGreaterThanOrEqual(CONTAINER_GB);
    }
  });

  it('the advice text shows the download, the multiplier and the container', () => {
    const a = adviseRoute({ is64: true, bytes: 4 * GB });
    expect(a.route).toBe('native');
    expect(a.storage).toContain('14 غيغا حرة');
    expect(a.storage).toContain('× 3');
    expect(a.storage).toContain('1.5');
  });

  it('does not promise 20-40 fps for a title it never measured', () => {
    const a = adviseRoute({ is64: true, bytes: 3 * GB });
    // the figure came from GTA V; quoting it for every large file implied a measurement
    expect(a.detail).toContain('GTA V');
    expect(a.detail).toMatch(/قِسناه|كان على/);
  });

  it('a DOS program is still routed in-app, with no storage claim', () => {
    const a = adviseRoute({ dos: true, bytes: 1408 });
    expect(a.route).toBe('in-app');
    expect(a.storage).toBeUndefined();
  });

  it('a .NET binary is still refused rather than promised', () => {
    expect(adviseRoute({ isDotNet: true }).route).toBe('none');
  });
});
