/**
 * The games catalog: every title gets the *fastest possible lane*, not one engine.
 *
 * Deep research (RESEARCH.md §٧٧) produced a law that holds across every stack we
 * examined on Android, Linux and iOS:
 *
 *      fewer layers = more frames
 *
 * The measured order of cost, from best to worst:
 *   1. native ARM64 build of the game            (no translation at all)
 *   2. Wine compiled ARM64EC + a JIT for the game only  (the hybrid model)
 *   3. Box64/FEX translating the game *and* everything under it
 *   4. a full x86 machine emulated inside a browser  (our engine: ~70 MIPS)
 *
 * So a launcher that only knows one lane is guaranteed to run most titles badly.
 * This catalog assigns each title its lane, states the expected frame rate on a
 * Snapdragon 8 Gen 1 / Adreno 730 / 8 GB phone, and never pretends a lane exists
 * when it does not.
 */
export type Lane = 'native' | 'wine' | 'dos' | 'none';

export interface CatalogEntry {
  id: string;
  title: string;
  year: number;
  /** 0 = unknown / not shipped as a single folder */
  sizeGB?: number;
  lane: Lane;
  /** what the user actually installs, in their own words */
  install: string;
  /** frame rate we expect on this device, as a range or a single figure */
  fps: string;
  /** honest one-liner */
  note: string;
  /** Play Store / project link for the native lane */
  link?: string;
  /** tag used for grouping in the UI */
  kind: 'shooter' | 'racing' | 'strategy' | 'rpg' | 'arcade';
}

export const CATALOG: CatalogEntry[] = [
  {
    id: 'gta5',
    title: 'GTA V',
    year: 2013,
    sizeGB: 118,
    lane: 'wine',
    install: 'نسخة Lite (٢–٩ غيغا) + Winlator / GameNative',
    fps: '٢٠–٤٠',
    note: '٦٤-بت وDirectX 11: يحتاج DXVK + Turnip على ٧٢٠p. نسخة Enhanced لا تعمل على أي هاتف.',
    kind: 'shooter',
  },
  {
    id: 'gta-sa',
    title: 'GTA: San Andreas',
    year: 2004,
    sizeGB: 2.4,
    lane: 'native',
    install: 'نسخة أندرويد رسمية من Rockstar',
    fps: '٦٠',
    note: 'بناء ARM64 أصلي: بلا ترجمة إطلاقاً — أسرع بمرات من مسار Wine للعبة نفسها.',
    link: 'https://play.google.com/store/apps/details?id=com.rockstargames.gtasa',
    kind: 'shooter',
  },
  {
    id: 'gta-iii',
    title: 'GTA III',
    year: 2001,
    sizeGB: 1.1,
    lane: 'native',
    install: 'نسخة أندرويد رسمية من Rockstar',
    fps: '٦٠',
    note: 'أصلي على ARM64.',
    link: 'https://play.google.com/store/apps/details?id=com.rockstargames.gta3',
    kind: 'shooter',
  },
  {
    id: 'gta-vc',
    title: 'GTA: Vice City',
    year: 2002,
    sizeGB: 1.4,
    lane: 'native',
    install: 'نسخة أندرويد رسمية من Rockstar',
    fps: '٦٠',
    note: 'أصلي على ARM64.',
    link: 'https://play.google.com/store/apps/details?id=com.rockstargames.gtavc',
    kind: 'shooter',
  },
  {
    id: 'doom',
    title: 'DOOM (1993)',
    year: 1993,
    sizeGB: 0.05,
    lane: 'wine',
    install: 'Delta Touch (محرّك أصلي) — أو محرّكنا مع ملفات WAD التي تملكها',
    fps: '٦٠',
    note: 'محرّكات المصدر المفتوح (PrBoom+/GZDoom) مُنقّلة أصلياً إلى ARM64 — أسرع طريق بكثير من محاكاة DOS.',
    kind: 'shooter',
  },
  {
    id: 'quake',
    title: 'Quake (1996)',
    year: 1996,
    sizeGB: 0.5,
    lane: 'native',
    install: 'Quad Touch / vkQuake مُنقّل',
    fps: '٦٠',
    note: 'منافذ أصلية متعددة؛ داخل محرّكنا المتصفحي ~٣ إطارات فقط (قياس ٧٠ MIPS).',
    kind: 'shooter',
  },
  {
    id: 'wolf3d',
    title: 'Wolfenstein 3D',
    year: 1992,
    sizeGB: 0.1,
    lane: 'dos',
    // We can BOOT a DOS program the user supplies (measured: tests/guest.test.ts boots a
    // dropped program and prints its message). We cannot ship Wolfenstein 3D, so the
    // install line has to say who brings the files.
    install: 'أنت تجلب ملفات اللعبة (قرصك/شراؤك) — محرّكنا يُقلعها، أو ECWolf الأصلي',
    fps: '٦٠',
    note: 'DOS ١٦-بت خفيف: أسرع مسار له هو محرّكنا، شرط أن تملك ملفات اللعبة.',
    kind: 'shooter',
  },
  {
    id: 'openttd',
    title: 'OpenTTD',
    year: 2004,
    sizeGB: 0.5,
    lane: 'native',
    install: 'منفذ أندرويد رسمي',
    fps: '٦٠',
    note: 'مفتوح المصدر ومُنقّل أصلياً.',
    // The old link (org.openttd.sdl) has been dead on Play for years. OpenTTD ships
    // from its own site and on F-Droid; point at the project, not a dead listing.
    link: 'https://www.openttd.org/downloads/openttd-releases/latest',
    kind: 'strategy',
  },
  {
    id: 'diablo',
    title: 'Diablo (1996)',
    year: 1996,
    sizeGB: 0.6,
    lane: 'native',
    install: 'DevilutionX (محرّك مفتوح، بناء ARM64)',
    fps: '٦٠',
    note: 'يحتاج ملفات اللعبة الأصلية من نسختك، والباقي محرّك مفتوح يعمل أصلياً.',
    link: 'https://github.com/diasurgical/devilutionX',
    kind: 'rpg',
  },
  {
    id: 'snake',
    title: 'SNAKE',
    year: 2026,
    lane: 'dos',
    install: 'مثبّت داخل التطبيق بلمسة',
    fps: '٦٠',
    // 1408 bytes on disk (os-dos/SNAKE.COM). The old "1.3 KB" was the size of the
    // SOURCE file before assembly, not the program we ship.
    sizeGB: 0.0000013,
    note: 'لعبتنا: ١٤٠٨ بايتاً، تُقلع خلال ثانية واحدة.', // "1.3 KB" was the source, "600 ms" was never measured
    kind: 'arcade',
  },
  {
    id: 'pong',
    title: 'PONG',
    year: 2026,
    sizeGB: 0.0000023, // 2443 bytes (os-dos/PONG.COM)
    lane: 'dos',
    install: 'مثبّت داخل التطبيق بلمسة',
    fps: '٦٠',
    note: 'لعبتنا: ضد الحاسوب، حتى ١٠ نقاط.',
    kind: 'arcade',
  },
  {
    id: 'crysis',
    title: 'Crysis (2007)',
    year: 2007,
    sizeGB: 12,
    lane: 'wine',
    install: 'Winlator + DXVK (تجريبي)',
    fps: '١٥–٢٥',
    note: 'يعمل أحياناً؛ لا نعد به. DX10 يسقط إلى مسار أبطأ.',
    kind: 'shooter',
  },
];

export const LANE_LABEL: Record<Lane, { label: string; hint: string; cls: string }> = {
  native: {
    label: 'أصلي ARM64',
    hint: 'أسرع طريق: لا ترجمة — إطار كامل السرعة',
    cls: 'lane-native',
  },
  wine: {
    label: 'Wine + Box64',
    hint: 'ترجمة تعليمات — أبطأ لكنها الطريق الوحيدة للألعاب الحديثة',
    cls: 'lane-wine',
  },
  dos: {
    label: 'محرّكنا',
    hint: 'برامج DOS: يعمل داخل التطبيق بلا أي طبقة خارجية',
    cls: 'lane-dos',
  },
  none: { label: 'غير مدعوم', hint: 'لا مسار على الهاتف', cls: 'lane-none' },
};

/** does this title need the user to leave the app for a store/project page? */
export function needsExternalInstall(e: CatalogEntry): boolean {
  return !!e.link;
}
