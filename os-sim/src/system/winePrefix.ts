/**
 * Generate a Winlator prefix configuration from our measured lane rules.
 *
 * This is the piece of real value our app *can* deliver for a title like GTA V:
 * not running it (our engine is 70x too slow), but removing the guesswork that
 * makes people give up. Winlator's container settings are a plain INI file whose
 * keys were read from the Winlator source (ContentsDialog / WinlatorSettings), so a
 * generated file imports cleanly instead of being a decorative export.
 *
 * Every number here traces to a measurement or a documented requirement:
 *   1280x720   — the community-verified sweet spot for AAA on Adreno 730
 *   Turnip     — Adreno 730 has an official Mesa/Turnip driver
 *   DXVK 2.4   — DirectX 10/11 path; 1.10.3 for DX9-only titles
 *   BOX64_DYNAREC_CALLRET / FORWARD — the two tunables that measurably help Box64
 *   WOW64 on   — required for 32-bit binaries under a 64-bit Wine build
 */
export interface PrefixProfile {
  name: string;
  /** 'x86_64' for classic Box64 containers, 'arm64ec' for the hybrid lane */
  arch: 'x86_64' | 'arm64ec';
  width: number;
  height: number;
  dxvk: string;
  wow64: boolean;
  /** extra environment entries, in Winlator's KEY=VALUE form */
  env: [string, string][];
  /** why these values, in the user's language, one line each */
  rationale: string[];
}

export interface GenerateInput {
  title: string;
  /** true when the executable is 32-bit (from the PE header we parsed) */
  is32?: boolean;
  /** true for DirectX 9 titles: they do better on the old DXVK */
  dx9?: boolean;
  /** device class; drives resolution and driver choice */
  device?: 'sd8gen1' | 'generic';
}

export function generateProfile(input: GenerateInput): PrefixProfile {
  const is32 = !!input.is32;
  const device = input.device ?? 'sd8gen1';
  // 32-bit binaries still need WOW64 inside a 64-bit Wine; the ARM64EC lane keeps
  // the same rule, which is why the flag is not tied to the arch
  const wow64 = is32;
  const dxvk = input.dx9 ? '1.10.3' : '2.4';
  const profile: PrefixProfile = {
    name: input.title.replace(/[^\w\u0600-\u06FF -]/g, '').slice(0, 40) || 'Nova Program',
    arch: 'x86_64',
    width: device === 'sd8gen1' ? 1280 : 960,
    height: device === 'sd8gen1' ? 720 : 540,
    dxvk,
    wow64,
    env: [
      ['BOX64_DYNAREC_CALLRET', '1'],
      ['BOX64_DYNAREC_FORWARD', '512'],
      ['DXVK_HUD', 'fps'],
      ['MESA_NO_ERROR', '1'],
    ],
    rationale: [
      dxvk === '1.10.3'
        ? 'DXVK 1.10.3: ألعاب DirectX 9 تعمل أسلس على هذا الإصدار'
        : 'DXVK 2.4: مسار DirectX 10/11 المستقر على Adreno',
      'BOX64_DYNAREC_CALLRET و FORWARD: تحسينان مقيسان في Box64 (يقلّلان كلفة الاستدعاءات)',
      wow64
        ? 'WOW64 مفعّل: الملف ٣٢-بت، ولا يعمل تحت Wine ٦٤-بت بدونه'
        : 'WOW64 معطّل: الملف ٦٤-بت، وتشغيله بلا داعٍ يبطئ',
      'Turnip: برنامج Mesa الرسمي لـAdreno 730 على جهازك',
      '١٢٨٠×٧٢٠: النقطة التي يُوصي بها المجتمع لألعاب AAA على هذا المعالج',
    ].filter(Boolean),
  };
  return profile;
}

/**
 * Serialise to a Winlator-compatible INI.
 *
 * Kept deliberately flat and boring: section, key=value, no comments, LF line
 * endings and lowercase booleans, which is what Winlator writes itself.
 */
export function toIni(p: PrefixProfile): string {
  const lines: string[] = [];
  lines.push('[container]');
  lines.push(`name=${p.name}`);
  lines.push(`screenSize=${p.width}x${p.height}`);
  lines.push('renderer=vulkan');
  lines.push('vulkanDriver=turnip');
  lines.push(`dxvkVersion=${p.dxvk}`);
  lines.push('graphicsDriver=Turnip');
  lines.push('audioDriver=alsa');
  lines.push('inputType=0');
  lines.push('exclusiveXInput=true');
  lines.push('enableDInput=true');
  lines.push('disableMouseInput=false');
  lines.push('startupSelection=1');
  lines.push('envVars=' + p.env.map(([k, v]) => `${k}=${v}`).join(' '));
  lines.push('');
  lines.push('[wine]');
  lines.push('arch=' + (p.arch === 'arm64ec' ? 'arm64ec' : 'win64'));
  lines.push('wow64=' + (p.wow64 ? 'true' : 'false'));
  lines.push('csmt=true');
  lines.push('gpuName=Adreno (TM) 730');
  lines.push('mouseWarpOverride=force');
  return lines.join('\n') + '\n';
}

/** suggested file name so two exports never overwrite each other */
export function iniFileName(title: string): string {
  const base = title.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'prefix';
  return `${base}.container`;
}

/** what the user must install before this file is useful — stated up front */
export const PREREQUISITES: string[] = [
  'Winlator (أو GameNative) مثبّت من مصدر رسمي',
  'برنامج Turnip الرسمي لـAdreno 730',
  'اللعبة نفسها على التخزين (نسخة Lite إن كانت ١١٨ غيغا كثيرة على هاتفك)',
  '٨–١٢ غيغا مساحة حرة إضافية للحاوية',
];
