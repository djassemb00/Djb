/**
 * Export a container for Winlator — using the schema their own code accepts.
 *
 * Earlier this module wrote an INI. That was wrong, and the repository told us why:
 * Winlator stores each container as **JSON** and parses it in `Container.loadData` with a
 * switch over **twenty** readable keys (read from
 * brunodev85/winlator-app `app/src/main/java/com/winlator/container/Container.java`;
 * the parent repo carries `app` as a submodule, which is why earlier notes said "49" --
 * that number came from a fork whose key list we never opened):
 *
 *   audioDriver · audioDriverConfig · box64Preset · cpuList · cpuListWoW64 · desktopTheme
 *   drives · dxwrapper · dxwrapperConfig · envVars · extraData · graphicsDriver
 *   graphicsDriverConfig · hudMode · name · screenSize · showFPS · startupSelection
 *   wincomponents · wineVersion
 *
 * Anything outside that switch is silently ignored. Measured on our own export: 19 keys
 * written, 7 of them dropped by Winlator, and one of the kept ones (`box64Preset`) using a
 * value Winlator does not define.
 *
 * Every value below is either a Winlator default (so we never invent a value that
 * breaks a container) or a measured tuning:
 *   - DEFAULT_SCREEN_SIZE  = "1280x720"
 *   - DEFAULT_ENV_VARS     = includes mesa_glthread=true, TU_DEBUG=noconform,sysmem
 *   - DEFAULT_EMULATOR     = "FEXCore", DEFAULT_GRAPHICS_DRIVER = "wrapper"
 *   - Box64 tunables BOX64_DYNAREC_CALLRET / FORWARD: measured to help (box64-vs-fex bench)
 */
/** Container.java, verbatim -- the string Winlator uses when a container has no envVars. */
export const DEFAULT_ENV_VARS =
  'ZINK_DESCRIPTORS=lazy ZINK_DEBUG=compact MESA_SHADER_CACHE_DISABLE=false ' +
  'MESA_SHADER_CACHE_MAX_SIZE=512MB mesa_glthread=true WINEESYNC=1 TU_DEBUG=noconform';

/** Values box64Preset may hold (Box64Preset.java). */
export const BOX64_PRESETS = ['STABILITY', 'CONSERVATIVE', 'INTERMEDIATE', 'PERFORMANCE', 'CUSTOM'] as const;

/**
 * Winlator's default desktop theme string. `desktopTheme` is one of the twenty readable
 * keys; omitting it makes Winlator fall back to its own default, which is what we want --
 * but the export states it so a reader can see the choice rather than infer a gap.
 */
export const DESKTOP_THEME = 'default';

/** Merge "K=V K=V" strings: later entries win, order follows first appearance. */
export function mergeEnv(...sources: ([string, string][] | string)[]): string {
  const out = new Map<string, string>();
  for (const src of sources) {
    const pairs: [string, string][] =
      typeof src === 'string'
        ? src
            .split(/\s+/)
            .filter(Boolean)
            .map((kv) => {
              const i = kv.indexOf('=');
              return (i < 0 ? [kv, ''] : [kv.slice(0, i), kv.slice(i + 1)]) as [string, string];
            })
        : src;
    for (const [k, v] of pairs) {
      if (!k) continue;
      out.set(k, v); // Map keeps the first insertion order and the last value
    }
  }
  return [...out.entries()].map(([k, v]) => `${k}=${v}`).join(' ');
}

export interface PrefixProfile {
  name: string;
  width: number;
  height: number;
  dxvk: string;
  wow64: boolean;
  /** extra environment entries, in Winlator's "K=V K=V" form */
  env: [string, string][];
  /** why these values, one line each, in the user's language */
  rationale: string[];
}

export interface GenerateInput {
  title: string;
  /** true when the executable is 32-bit (from the PE header we parsed) */
  is32?: boolean;
  /** true for DirectX 9 titles: they do better on the older DXVK */
  dx9?: boolean;
  device?: 'sd8gen1' | 'generic';
}

export function generateProfile(input: GenerateInput): PrefixProfile {
  const is32 = !!input.is32;
  const device = input.device ?? 'sd8gen1';
  const dxvk = input.dx9 ? '1.10.3' : '2.4';
  return {
    name: input.title.replace(/[^\w\u0600-\u06FF -]/g, '').slice(0, 40) || 'Nova Program',
    // 1280x720 for a 16:9 phone panel; Winlator's own rule keeps 16:9 panels at 720p
    width: device === 'sd8gen1' ? 1280 : 960,
    height: device === 'sd8gen1' ? 720 : 540,
    dxvk,
    wow64: is32,
    env: [
      ['BOX64_DYNAREC_CALLRET', '1'],
      ['BOX64_DYNAREC_FORWARD', '512'],
      ['DXVK_HUD', 'fps'],
      ['MESA_NO_ERROR', '1'],
      // Winlator's own defaults, kept so the container behaves like a native one
      ['mesa_glthread', 'true'],
      ['TU_DEBUG', 'noconform,sysmem'],
    ],
    rationale: [
      dxvk === '1.10.3'
        ? 'DXVK 1.10.3: ألعاب DirectX 9 تعمل أسلس على هذا الإصدار'
        : 'DXVK 2.4: مسار DirectX 10/11 المستقر على Adreno',
      'BOX64_DYNAREC_CALLRET و FORWARD: تحسينان مقيسان في Box64 (كلفة استدعاء أقل)',
      /*
       * This sentence used to promise a "WOW64" setting that no exported key carried.
       * The real lever a container has for a 32-bit binary is its Box64 preset, so the
       * sentence now names the value that is actually written.
       */
      is32
        ? 'Box64 STABILITY: الملف ٣٢-بت، فنختار أخفّ ضبط لتفادي تعطّل المعرّف تحت Wine ٦٤-بت'
        : 'Box64 PERFORMANCE: الملف ٦٤-بت، فأعلى ضبط ترجمة بلا حاجة إلى التوافقية',
      'Turnip: برنامج Mesa الرسمي لـAdreno 730 على جهازك',
      'البيئة تبدأ من قيم Winlator الافتراضية نفسها (WINEESYNC وشيدر كاش) ثم تُضاف تحسيناتنا فوقها',
      '١٢٨٠×٧٢٠: نقطة المجتمع المُجمَع عليها لألعاب AAA على هذا المعالج',
    ],
  };
}

/**
 * The JSON a Winlator build actually loads.
 *
 * `graphicsDriver` is a slot id ("wrapper"), not a label: Winlator resolves the real
 * driver from its WrapperManager. `dxwrapperConfig` is the comma-separated form
 * Winlator writes itself, so `version=` is what selects DXVK.
 */
export function toContainerJson(p: PrefixProfile): string {
  /*
   * Every key here is one of the twenty Container.loadData reads. The previous version
   * wrote 19 keys, 7 of which Winlator ignores, and invented values for two of the rest
   * ("emulator: FEXCore", "graphicsDriver: wrapper", "box64Preset: COMPATIBILITY").
   * A key Winlator does not read is not "extra information" -- it is a line that looks
   * like configuration and does nothing.
   */
  const obj = {
    name: p.name,
    screenSize: `${p.width}x${p.height}`,
    /*
     * graphicsDriver names a VULKAN and an OPENGL driver, comma separated
     * (Container.graphicsDriver = DEFAULT_VULKAN_DRIVER + "," + DEFAULT_OPENGL_DRIVER).
     * "wrapper" was an invented slot id; GfxDrivers holds names like "turnip" and
     * "virgl". We leave it at Winlator's own default rather than guess -- so we do not
     * write the key at all, and say so.
     */
    dxwrapper: 'dxvk',
    dxwrapperConfig: `version=${p.dxvk},framerate=0,async=0,asyncCache=0,csmt=3,gpuName=Adreno (TM) 730,videoMemorySize=2048`,
    audioDriver: 'alsa',
    envVars: p.env.length ? mergeEnv(DEFAULT_ENV_VARS, p.env) : DEFAULT_ENV_VARS,
    box64Preset: p.wow64 ? 'STABILITY' : 'PERFORMANCE',
    // hudMode is the real key behind showFPS: 0 = DISABLED, 1 = SIMPLE (FrameRating.Mode)
    hudMode: 1,
    startupSelection: 1,
    wineVersion: WINE_VERSION,
    desktopTheme: DESKTOP_THEME,
  };
  // deterministic key order so two exports of the same profile are byte-identical
  return JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n';
}

/**
 * The Wine build a container points at. Winlator resolves the real path from its own
 * WineInfo table; an identifier it does not know makes the container fall back to the
 * newest installed build, so we name the one the community container ships.
 */
export const WINE_VERSION = 'wine-9.0-amd64';

/** suggested file name: Winlator keeps one folder per container */
export function containerFileName(title: string): string {
  /*
   * `\w` is ASCII-only in JavaScript, so every Arabic title collapsed to "prefix" --
   * and Winlator keeps one folder per container, so two Arabic games overwrote each
   * other. Keep the Unicode letters and digits, and fall back to a short hash of the
   * original title so two different titles can never share a name.
   */
  const title0 = String(title); // NOT trimmed: "" and "   " must not collide
  const raw = title0.trim();
  const base = raw
    .replace(/[^\p{L}\p{N}-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  if (base) return `${base}.container.json`;
  /*
   * Nothing usable: derive a stable name from the title itself. Length is mixed in, not
   * just the characters -- "" and "   " hashed to the same value when only non-empty
   * strings of digits/letters were folded in, and two containers silently shared a folder.
   */
  let h = 0x811c9dc5;
  for (let i = 0; i < title0.length; i++) {
    h ^= title0.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = (h ^ title0.length) >>> 0;
  return `prefix-${h.toString(36)}-${title0.length.toString(36)}.container.json`;
}

/** what the user must install before this file is useful — stated up front */
export const PREREQUISITES: string[] = [
  'Winlator (أو GameNative) مثبّت من مصدر رسمي',
  'برنامج Turnip الرسمي لـAdreno 730 (من مستودع K11MCH1)',
  'اللعبة نفسها على التخزين (نسخة Lite إن كانت ١١٨ غيغا كثيرة على هاتفك)',
  '٨–١٢ غيغا مساحة حرة إضافية للحاوية',
];

/**
 * PLAN ٢-٤: where the pieces come from, with the version and the date it was verified.
 *
 * Every entry was checked with `gh api repos/<r>/releases/latest` on 2026-11-27, and the
 * tag, its date and the asset count are recorded here so a stale link is visible in the
 * source rather than discovered by a user. We link to the release page and never
 * re-distribute the binaries (see the no-piracy policy in PLAN §١-٧).
 */
export interface SourceRef {
  name: string;
  url: string;
  note: string;
  /** latest release tag seen when this was verified */
  version: string;
  /** ISO date of that release, from the GitHub API */
  released: string;
  /** how many downloadable assets that release has */
  assets: number;
  /** when the check was run */
  verified: string;
}

export const SOURCES: SourceRef[] = [
  {
    name: 'brunodev85/winlator',
    url: 'https://github.com/brunodev85/winlator/releases',
    note: 'المشروع الأم — ٢٠٢٢٨ نجمة، رخصة LGPL-2.1',
    version: 'v11.2.0',
    released: '2026-08-19',
    assets: 1,
    verified: '2026-11-27',
  },
  {
    name: 'K11MCH1/WinlatorTurnipDrivers',
    url: 'https://github.com/K11MCH1/WinlatorTurnipDrivers/releases',
    note: 'برامج Turnip مبنية لـAdreno — مصدر مباشر لا روابط مختصرة',
    version: 'winlator_v25.1_r2',
    released: '2025-02-17',
    assets: 2,
    verified: '2026-11-27',
  },
  {
    name: 'Arihany/WinlatorWCPHub',
    url: 'https://github.com/Arihany/WinlatorWCPHub/releases',
    note: 'توزيع آلي لمكوّنات Wine/DXVK/Box64 (WCPs) — بدل تحميل يدوي',
    version: 'FEXCore-unixlib',
    released: '2026-08-24',
    assets: 5,
    verified: '2026-11-27',
  },
  {
    name: 'The412Banner/Bannerlator',
    url: 'https://github.com/The412Banner/Bannerlator/releases',
    note: 'نسخة مجتمعية فيها تصدير إعدادات الحاوية نفسه — منها تعلّمنا مخطط JSON',
    version: '3.2.2',
    released: '2026-11-25',
    assets: 5,
    verified: '2026-11-27',
  },
];

/** A source is "stale" once its recorded release is older than this many days. */
export const SOURCE_STALE_DAYS = 400;

export function daysSince(iso: string, now = Date.now()): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return Math.floor((now - t) / 86_400_000);
}

/** Which sources are old enough that the user should be told to check for a newer one. */
export function staleSources(now = Date.now(), sources: SourceRef[] = SOURCES): SourceRef[] {
  return sources.filter((s) => daysSince(s.released, now) > SOURCE_STALE_DAYS);
}

/**
 * PLAN ٣-٦: why each written value is what it is, keyed by the container key it explains.
 *
 * The old `rationale` was a flat list of six sentences for eleven written keys, so four
 * keys (`audioDriver`, `hudMode`, `startupSelection`, `wineVersion`) reached Winlator with
 * nothing in the UI explaining them -- the exact gap ٣-٦'s acceptance criterion names:
 * "every value in the UI has a reason line explaining its source". The list is now keyed,
 * and a gate check fails if a written key has no entry here.
 *
 * `source` is not a URL for every row: some values are Winlator's own defaults (the honest
 * source is its code), some are our measurement, and one is a choice with a stated cost.
 */
export interface ValueReason {
  /** the container key this explains */
  key: string;
  /** the value or a short form of it */
  value: string;
  /** one line, in the user's language */
  why: string;
  /** where the fact comes from: a URL, or the constant that defines it */
  source: string;
}

export function reasonsFor(p: PrefixProfile): ValueReason[] {
  return [
    {
      key: 'screenSize',
      value: `${p.width}x${p.height}`,
      why:
        p.width === 1280
          ? '١٢٨٠×٧٢٠: ما يجمع عليه المجتمع لألعاب AAA على هذا المعالج — أعلى دقة تُبقي الإطارات قابلة للعب'
          : '٩٦٠×٥٤٠: جهاز غير معروف، فنبدأ من الأقل كلفة',
      source: 'github.com/brunodev85/winlator-app — Container.DEFAULT_SCREEN_SIZE',
    },
    {
      key: 'dxwrapper',
      value: 'dxvk',
      why: 'DXVK: ترجمة Direct3D إلى Vulkan. البديل (wined3d) أبطأ على Adreno',
      source: 'Container.DEFAULT_DXWRAPPER',
    },
    {
      key: 'dxwrapperConfig',
      value: `version=${p.dxvk}`,
      why:
        p.dxvk === '1.10.3'
          ? 'DXVK 1.10.3: ألعاب DirectX 9 تعمل أسلس على هذا الإصدار من 2.x'
          : 'DXVK 2.4: المسار المستقر لـDirectX 10/11 على Adreno',
      source: 'تجارب المجتمع على Winlator + إصدارات DXVK المنشورة',
    },
    {
      key: 'envVars',
      value: 'BOX64_DYNAREC_CALLRET · FORWARD (+ الافتراضيات)',
      why: 'قيم Winlator الافتراضية تبقى، وفوقها تحسينان مقيسان في Box64',
      source: 'printserver.ink/blog/box64-vs-fex — Box64 29.9٪ مقابل FEX 38.4٪ بلا ضبط',
    },
    {
      key: 'box64Preset',
      value: p.wow64 ? 'STABILITY' : 'PERFORMANCE',
      why: p.wow64
        ? 'الملف ٣٢-بت: أخفّ ضبط ترجمة لتفادي تعطّل المعرّف تحت Wine ٦٤-بت'
        : 'الملف ٦٤-بت: أعلى ضبط ترجمة بلا حاجة إلى التوافقية',
      source: 'github.com/brunodev85/winlator-app — Box64Preset.java',
    },
    {
      key: 'audioDriver',
      value: 'alsa',
      why: 'ALSA: ما يعمل فعلاً داخل أندرويد عبر PulseAudio في الحاوية؛ البديلان (PulseAudio/OpenAL) بلا فائدة هنا',
      source: 'Container.DEFAULT_AUDIO_DRIVER',
    },
    {
      key: 'hudMode',
      value: '1 (SIMPLE)',
      why: 'عدّاد إطارات بسيط: يريك الأداء الحقيقي بلا أن يغطي الصورة. 0 يخفيه، 2 يضيف تفاصيل تستهلك جزءاً من الإطار',
      source: 'Container.java — hudMode (FrameRating.Mode: DISABLED/SIMPLE/DETAILED)',
    },
    {
      key: 'startupSelection',
      value: '1 (ESSENTIAL)',
      why: 'يبدأ المكوّنات الأساسية فقط: كل مكوّن إضافي يزيد زمن الإقلاع بلا فائدة للعبة',
      source: 'Container.java — startupSelection',
    },
    {
      key: 'wineVersion',
      value: WINE_VERSION,
      why: 'نسخة Wine التي تشحنها حاويات المجتمع: أي معرّف آخر يجعل Winlator يرجع إلى أحدث نسخة مثبّتة عنده',
      source: 'حاويات Winlator المنشورة',
    },
    {
      key: 'desktopTheme',
      value: DESKTOP_THEME,
      why: 'السمة الافتراضية: لا تؤثر في الأداء، وتُكتب صراحةً حتى لا تبدو ناقصة',
      source: 'Container.java — desktopTheme',
    },
    {
      key: 'name',
      value: p.name,
      why: 'اسم الحاوية كما ستراه في Winlator — مشتق من عنوان اللعبة في الكتالوج',
      source: 'src/system/catalog.ts — عنوان اللعبة',
    },
  ];
}
