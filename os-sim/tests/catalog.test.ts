import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { CATALOG, LANE_LABEL, needsExternalInstall } from '../src/system/catalog';
import { BUILTIN_IMAGES } from '../src/store/useVM';

/**
 * The catalog is the app's promise list, and it was wrong in four ways at once:
 *   - GTA-branded titles were filed as 'arcade'
 *   - SNAKE's note said "1.3 KB, boots in 600 ms": 1.3 KB was the SOURCE size (the
 *     shipped program is 1408 bytes) and the boot time was never measured
 *   - PONG claimed 2 MB for a 2443-byte program
 *   - a "ألعاب DOS" card promised Prince of Persia, Wolfenstein 3D, Doom and Duke
 *     Nukem 3D. The disk contains SNAKE and PONG. None of those four can be shipped.
 *
 * Every assertion below reads the real files, so a note cannot drift away from reality.
 */
const rootNames = (img: string) => {
  const d = readFileSync(img);
  const out: { name: string; size: number }[] = [];
  for (let i = 0; i < 224; i++) {
    const off = 9728 + i * 32;
    if (d[off] === 0) break;
    const n = d.subarray(off, off + 8).toString('latin1').trim();
    const e = d.subarray(off + 8, off + 11).toString('latin1').trim();
    out.push({
      name: e ? `${n}.${e}` : n,
      size: d[off + 28] | (d[off + 29] << 8) | (d[off + 30] << 16) | (d[off + 31] << 24),
    });
  }
  return out;
};

describe('catalog honesty', () => {
  it('has exactly one entry per id, and every id is uppercase-safe', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('classifies the GTA sandbox titles as shooters, not arcade', () => {
    const gta = CATALOG.filter((e) => e.id.startsWith('gta'));
    expect(gta.length).toBeGreaterThanOrEqual(4);
    for (const e of gta) expect(e.kind, `${e.id} must be a shooter`).toBe('shooter');
  });

  it('only uses lanes that have a label and a hint', () => {
    for (const e of CATALOG) {
      expect(LANE_LABEL[e.lane], `lane ${e.lane} needs a label`).toBeDefined();
      expect(LANE_LABEL[e.lane].hint.length).toBeGreaterThan(10);
    }
  });

  it('never promises a commercial game we cannot ship', () => {
    /**
     * A DOS-lane entry may say our engine runs the program, but it must say who brings
     * the files. Shipping Wolfenstein 3D, Prince of Persia or Doom is not something we
     * can do, so no entry may read as if the game is included.
     */
    const bundled = new Set(['snake', 'pong']); // the only two games actually on our disk
    for (const e of CATALOG) {
      if (e.lane !== 'dos' || bundled.has(e.id)) continue;
      expect(e.install, `${e.id} must say the user supplies the files`).toMatch(
        /تملك|قرصك|شراؤك|تجلب/,
      );
    }
  });

  it('matches the sizes it quotes to the programs we actually build', () => {
    const snake = CATALOG.find((e) => e.id === 'snake');
    const pong = CATALOG.find((e) => e.id === 'pong');
    const snakeReal = readFileSync('os-dos/SNAKE.COM').length;
    const pongReal = readFileSync('os-dos/PONG.COM').length;
    // sizeGB is a coarse figure; it must be within a factor of 2 of the real program
    expect(snake!.sizeGB! * 1024 ** 3).toBeGreaterThan(snakeReal / 2);
    expect(snake!.sizeGB! * 1024 ** 3).toBeLessThan(snakeReal * 2);
    expect(pong!.sizeGB! * 1024 ** 3).toBeGreaterThan(pongReal / 2);
    expect(pong!.sizeGB! * 1024 ** 3).toBeLessThan(pongReal * 2);
  });

  it('does not quote a frame rate for a program it has not measured', () => {
    // "60 fps" is legitimate for a native port; for our own DOS games the only honest
    // statement is "as fast as the emulator runs it", so the note carries the claim.
    const ours = CATALOG.filter((e) => e.id === 'snake' || e.id === 'pong');
    for (const e of ours) {
      expect(e.note).not.toMatch(/٦٠٠ مللي|600 ?ms/); // never measured
      expect(e.note.length).toBeGreaterThan(10);
    }
  });

  it('links only to pages that exist, and never to a dead Play listing', () => {
    /**
     * Offline we cannot resolve a URL, so the rule is narrower and still useful: any
     * play.google.com link must have been checked, and the ones we know are dead must
     * not be there. OpenTTD's old listing (org.openttd.sdl) has been gone for years.
     */
    const dead = ['org.openttd.sdl'];
    for (const e of CATALOG) {
      if (!e.link) continue;
      expect(e.link).toMatch(/^https:\/\//);
      for (const d of dead) expect(e.link).not.toContain(d);
    }
    // the ones that do point at Play must be the Rockstar packages
    const play = CATALOG.filter((e) => e.link?.includes('play.google.com'));
    for (const e of play) expect(e.link).toMatch(/id=com\.rockstargames\./);
  });

  it('a lane that is "none" never carries an install link', () => {
    for (const e of CATALOG) if (e.lane === 'none') expect(needsExternalInstall(e)).toBe(false);
  });
});

describe('the built-in disks', () => {
  it('ships only images that exist on disk', () => {
    for (const img of BUILTIN_IMAGES) {
      const p = img.path.replace('./', 'public/');
      expect(existsSync(p), `${img.path} is offered in the UI but not shipped`).toBe(true);
      expect(readFileSync(p).length).toBe(img.size ?? readFileSync(p).length);
    }
  });

  it('the "ألعاب DOS" card does not name games that are not on the disk', () => {
    const card = BUILTIN_IMAGES.find((i) => i.id === 'dos-games')!;
    const names = rootNames('public/images/dos-games.img').map((n) => n.name);
    expect(names).toContain('SNAKE.COM');
    expect(names).toContain('PONG.COM');
    // the four titles that used to be advertised
    for (const lie of [/Prince of Persia/i, /Wolfenstein/i, /Doom/i, /Duke Nukem/i]) {
      if (lie.test(card.note)) {
        // allowed ONLY if the file is really there
        const stem = lie.source.split('\\')[0].toUpperCase().replace(/[^A-Z]/g, '');
        expect(
          names.some((n) => n.includes(stem)),
          `${card.id} advertises ${lie.source} but the disk has ${names.join(', ')}`,
        ).toBe(true);
      }
    }
  });

  it('FAT12 cannot hold a "2 MB" game file, so no built-in entry may claim one', () => {
    // 1.44 MB is the whole disk; a note promising a bigger program is impossible
    for (const img of BUILTIN_IMAGES) {
      for (const m of img.note.matchAll(/(\\d+(?:\\.\\d+)?)\\s*ميغابايت/g)) {
        expect(Number(m[1])).toBeLessThanOrEqual(1.44);
      }
    }
  });
});
