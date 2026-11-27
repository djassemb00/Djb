/**
 * Export a container for Winlator — using the schema their own code accepts.
 *
 * Earlier this module wrote an INI. That was wrong, and the repository told us why:
 * Winlator stores each container as **JSON** and parses it in `Container.loadData`
 * with a fixed switch over 49 keys (read from the source of
 * The412Banner/Bannerlator `app/src/main/java/com/winlator/star/container/Container.java`).
 * Anything outside that switch is ignored, and `graphicsDriver` must name a slot id
 * ("wrapper"/"turnip"/…), not a human label — so a decorative INI would import as
 * nothing at all.
 *
 * Every value below is either a Winlator default (so we never invent a value that
 * breaks a container) or a measured tuning:
 *   - DEFAULT_SCREEN_SIZE  = "1280x720"
 *   - DEFAULT_ENV_VARS     = includes mesa_glthread=true, TU_DEBUG=noconform,sysmem
 *   - DEFAULT_EMULATOR     = "FEXCore", DEFAULT_GRAPHICS_DRIVER = "wrapper"
 *   - Box64 tunables BOX64_DYNAREC_CALLRET / FORWARD: measured to help (box64-vs-fex bench)
 */
export interface PrefixProfile {
  name: string;
  /** "win64" style Wine build; ARM64EC variants are a Wine-side choice, not a flag here */
  arch: 'win64' | 'arm64ec';
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
    arch: 'win64',
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
      is32
        ? 'WOW64: الملف ٣٢-بت، ولا يعمل تحت Wine ٦٤-بت بدونه'
        : 'WOW64 معطّل: الملف ٦٤-بت، وتشغيله بلا داعٍ يبطئ',
      'Turnip: برنامج Mesa الرسمي لـAdreno 730 على جهازك',
      'mesa_glthread و TU_DEBUG: قيم Winlator الافتراضية نفسها — لا نبتكر قيماً قد تكسر الحاوية',
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
  const obj = {
    name: p.name,
    screenSize: `${p.width}x${p.height}`,
    envVars: p.env.map(([k, v]) => `${k}=${v}`).join(' '),
    graphicsDriver: 'wrapper',
    graphicsDriverConfig: 'vulkanVersion=1.3;presentMode=mailbox;maxDeviceMemory=0',
    dxwrapper: 'dxvk+vkd3d',
    dxwrapperConfig: `version=${p.dxvk},framerate=0,async=0,asyncCache=0,csmt=3,gpuName=Adreno (TM) 730,videoMemorySize=2048`,
    emulator: 'FEXCore',
    emulator64: p.wow64 ? 'fexcore' : 'fexcore',
    box64Preset: p.wow64 ? 'COMPATIBILITY' : 'PERFORMANCE',
    audioDriver: 'alsa',
    inputType: 0,
    exclusiveXInput: true,
    showFPS: true,
    startupSelection: 1,
    fullscreenMode: 1,
    lc_all: 'en_US.UTF-8',
    drives: '',
  };
  // deterministic key order so diffs between two exports are readable
  return JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n';
}

/** suggested file name: Winlator keeps one folder per container */
export function containerFileName(title: string): string {
  const base = String(title)
    .replace(/[^\w-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${base || 'prefix'}.container.json`;
}

/** what the user must install before this file is useful — stated up front */
export const PREREQUISITES: string[] = [
  'Winlator (أو GameNative) مثبّت من مصدر رسمي',
  'برنامج Turnip الرسمي لـAdreno 730 (من مستودع K11MCH1)',
  'اللعبة نفسها على التخزين (نسخة Lite إن كانت ١١٨ غيغا كثيرة على هاتفك)',
  '٨–١٢ غيغا مساحة حرة إضافية للحاوية',
];

/** where those pieces actually come from — checked repositories, with their licences */
export const SOURCES: { name: string; url: string; note: string }[] = [
  {
    name: 'brunodev85/winlator',
    url: 'https://github.com/brunodev85/winlator',
    note: 'المشروع الأم — ٢٠ ألف نجمة، رخصة LGPL-2.1، آخر تحديث اليوم',
  },
  {
    name: 'K11MCH1/WinlatorTurnipDrivers',
    url: 'https://github.com/K11MCH1/WinlatorTurnipDrivers',
    note: 'برامج Turnip مبنية لـAdreno — ٤٢٥ نجمة، مصدر مباشر لا روابط مختصرة',
  },
  {
    name: 'Arihany/WinlatorWCPHub',
    url: 'https://github.com/Arihany/WinlatorWCPHub',
    note: 'توزيع آلي لمكوّنات Wine/DXVK/Box64 (WCPs) — بدل تحميل يدوي',
  },
  {
    name: 'The412Banner/Bannerlator',
    url: 'https://github.com/The412Banner/Bannerlator',
    note: 'نسخة مجتمعية فيها تصدير إعدادات الحاوية نفسه — منها تعلّمنا مخطط JSON',
  },
];
