/**
 * PLAN ٣-١ / ٣-٢: one schema for a per-game setting, validated at runtime.
 *
 * Why this file exists at all: until now a "profile" was whatever `generateProfile()`
 * happened to return, and the only thing checking it was our own export function. Two
 * separate defects came from that (A55, A60) -- a key Winlator silently ignores, and a
 * test whose expected values were invented so it agreed with invented code. A schema is
 * the thing that can say "this key is not one of the twenty Winlator reads" without
 * asking the code that wrote it.
 *
 * Library choice is measured, not assumed. PLAN.md said "zod, 4 KB"; zod 4.6.7 bundled
 * minified and gzipped is 93 600 bytes -- 43% of our entire 217 KB image, against a
 * 240 KB ceiling. valibot with the same shapes is 1 680 bytes gzipped. The plan's "4 KB"
 * figure matches valibot, so the library *name* in the plan was the error and the
 * measurement settled it. Numbers and method: BENCHMARKS.md.
 *
 * The Arabic message on every failure is not decoration: the acceptance test for ٣-١ is
 * "a wrong file is rejected with a clear Arabic message", and a library default
 * ("Invalid input: expected string") would fail that while still passing a
 * `.success === false` assertion. So every message here is written, not inherited.
 */
import * as v from 'valibot';
import readKeysJson from '../../tests/fixtures/winlator-keys.json' with { type: 'json' };

/**
 * The twenty keys `Container.loadData` actually switches over.
 *
 * Imported from the fixture transcribed from Container.java, NOT re-typed here: A60 was
 * exactly that mistake -- a second hand-written list that drifted from the source and
 * then agreed with our own output.
 */
export const WINLATOR_READ_KEYS: readonly string[] = readKeysJson.readKeys;

export const BOX64_PRESET_VALUES = readKeysJson.box64Presets as readonly string[];

/** 1280x720 and similar; Winlator stores a string, not two numbers */
const screenSize = v.pipe(
  v.string(),
  v.regex(/^\d{3,4}x\d{3,4}$/, 'المقاس يجب أن يكون بالصيغة العرض×الارتفاع، مثل 1280x720'),
);

/**
 * `envVars` is Winlator's "K=V K=V" string. Validated structurally because a malformed
 * entry does not fail loudly inside Winlator -- it is ignored, which is the A55 shape:
 * a line that looks like configuration and does nothing.
 */
const envVars = v.pipe(
  v.string(),
  v.check(
    (s) =>
      s.trim() === '' ||
      s.split(' ').every((pair) => /^[A-Za-z_][A-Za-z0-9_]*=[^\s]*$/.test(pair)),
    'متغيّرات البيئة يجب أن تكون بالصيغة KEY=VALUE مفصولة بمسافة',
  ),
);

/**
 * The container object.
 *
 * Written out key by key for the seven we actually generate (they get real validation),
 * and kept open for the rest of the twenty so an imported Winlator file is not rejected
 * merely for carrying `drives` or `wincomponents`. The strict part -- "no key outside
 * the twenty" -- is applied in `exactKeyIssues`, so every unknown key is named
 * individually instead of the file failing as an opaque "invalid container".
 */
const ContainerSchema = v.looseObject({
  screenSize,
  graphicsDriver: v.optional(v.string()),
  dxwrapper: v.optional(
    v.picklist(['dxvk', 'wined3d'], 'طبقة DirectX يجب أن تكون dxvk أو wined3d — لا قيمة ثالثة'),
  ),
  dxwrapperConfig: v.optional(v.string()),
  box64Preset: v.optional(
    v.picklist(
      BOX64_PRESET_VALUES,
      `ضبط Box64 يجب أن يكون واحداً من: ${BOX64_PRESET_VALUES.join(' · ')}`,
    ),
  ),
  envVars: v.optional(envVars),
  name: v.optional(v.string()),
  audioDriver: v.optional(v.string()),
  audioDriverConfig: v.optional(v.string()),
  wineVersion: v.optional(v.string()),
  desktopTheme: v.optional(v.string()),
  startupSelection: v.optional(v.number()),
  hudMode: v.optional(v.number()),
  showFPS: v.optional(v.boolean()),
  cpuList: v.optional(v.string()),
  cpuListWoW64: v.optional(v.string()),
  drives: v.optional(v.string()),
  extraData: v.optional(v.string()),
  graphicsDriverConfig: v.optional(v.string()),
  wincomponents: v.optional(v.string()),
});

const GameSchema = v.object({
  id: v.pipe(
    v.string(),
    v.regex(
      /^[a-z0-9][a-z0-9._-]{0,63}$/,
      'المعرّف يجب أن يكون حروفاً لاتينية صغيرة وأرقاماً و(- . _) فقط',
    ),
  ),
  title: v.pipe(
    v.string(),
    v.minLength(1, 'عنوان اللعبة مطلوب'),
    // control characters (including NUL and newlines) reach a label and a file name;
    // containerFileName turns them into "_", but the UI would still render the raw value
    v.check(
      (t) => !/[\u0000-\u001F\u007F]/.test(t),
      'عنوان اللعبة يحوي محارف تحكّم (سطر جديد أو NUL) — هذه ليست اسماً',
    ),
  ),
  year: v.optional(
    v.pipe(
      v.number(),
      v.integer('السنة يجب أن تكون عدداً صحيحاً'),
      v.minValue(1970, 'السنة قبل ١٩٧٠ غير معقولة'),
      v.maxValue(2100, 'السنة بعد ٢١٠٠ غير معقولة'),
    ),
  ),
  sizeGB: v.optional(v.pipe(v.number(), v.minValue(0, 'الحجم لا يكون سالباً'))),
});

const DeviceSchema = v.object({
  soc: v.string(),
  gpu: v.string(),
  ramGB: v.pipe(v.number(), v.minValue(1, 'الذاكرة لا تكون أقل من ١ جيجابايت')),
});

/**
 * The measured result. `source` is required and closed: a number without a stated
 * origin is exactly the defect this whole audit exists to prevent.
 */
const ResultSchema = v.pipe(
  v.object({
    fps: v.pipe(
      v.number(),
      v.minValue(0, 'الإطارات لا تكون سالبة'),
      v.maxValue(1000, 'الإطارات فوق ١٠٠٠ غير معقولة'),
    ),
    tempC: v.optional(
      v.pipe(
        v.number(),
        v.minValue(-20, 'حرارة أقل من −٢٠ مئوية غير معقولة'),
        v.maxValue(120, 'حرارة فوق ١٢٠ مئوية غير معقولة'),
      ),
    ),
    minutes: v.optional(v.pipe(v.number(), v.minValue(0, 'المدة لا تكون سالبة'))),
    source: v.picklist(
      ['user', 'measured', 'community'],
      'مصدر النتيجة يجب أن يكون user أو measured أو community — رقم بلا مصدر لا يُقبل',
    ),
  }),
  v.check(
    (r) => r.source !== 'measured' || r.tempC !== undefined,
    'نتيجة مصدرها «measured» يجب أن تحمل حرارة مقيسة — رقم بلا ظرف قياس ليس قياساً',
  ),
);

export const ProfileSchema = v.object({
  schema: v.literal(1, 'إصدار المخطط يجب أن يكون 1'),
  game: GameSchema,
  device: DeviceSchema,
  container: ContainerSchema,
  result: v.optional(ResultSchema),
  meta: v.object({
    author: v.string(),
    created: v.pipe(
      v.string(),
      v.regex(/^\d{4}-\d{2}-\d{2}$/, 'التاريخ يجب أن يكون بصيغة YYYY-MM-DD'),
    ),
    verifiedOnDevice: v.boolean(),
  }),
});

export type Profile = v.InferOutput<typeof ProfileSchema>;

export interface ProfileIssue {
  /** dotted path into the document, '' for the whole file */
  path: string;
  message: string;
}

export type ParseResult =
  | { ok: true; profile: Profile }
  | { ok: false; issues: ProfileIssue[] };

/** Which keys in a container object Winlator does not read, named one by one. */
export function exactKeyIssues(container: Record<string, unknown>): ProfileIssue[] {
  return Object.keys(container)
    .filter((k) => !WINLATOR_READ_KEYS.includes(k))
    .map((k) => ({
      path: `container.${k}`,
      message:
        `مفتاح غير معروف: ${k} — Winlator لا يقرأ إلا ${WINLATOR_READ_KEYS.length} مفتاحاً`
        + ' (من Container.java)، والمفتاح الغريب يُهمَل صامتاً',
    }));
}

/**
 * Parse and validate an unknown value (a pasted file, an imported JSON, a fetch body).
 *
 * Every issue is collected rather than the first one thrown: someone fixing a file wants
 * the whole list, and a test asserting "rejected" is stronger when it can assert *which*
 * fields were named.
 */
/**
 * Top-level keys a profile may carry. Anything else is rejected by name.
 *
 * `v.object` strips unknown keys, which is the wrong behaviour for a format whose whole
 * purpose is to be auditable: an older build's `privacy: "off"` would be dropped on import
 * and the user would never learn their setting did not survive. Measured before this was
 * added: `parseProfile({...good, evil: 'x'})` returned `ok: true`.
 */
const TOP_LEVEL_KEYS = ['schema', 'game', 'device', 'container', 'result', 'meta'];

export function topLevelIssues(input: unknown): ProfileIssue[] {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return [];
  return Object.keys(input as Record<string, unknown>)
    .filter((k) => !TOP_LEVEL_KEYS.includes(k))
    .map((k) => ({
      path: k,
      message:
        `مفتاح غير معروف في الملف: ${k} — الإعدادات المعروفة: ${TOP_LEVEL_KEYS.join('، ')}؛`
        + ' المفتاح الغريب يُهمَل صامتاً عند التحويل، فحذفه أوضح من إبقائه',
    }));
}

export function parseProfile(input: unknown): ParseResult {
  const unknownTop = topLevelIssues(input);
  if (unknownTop.length) return { ok: false, issues: unknownTop };
  const r = v.safeParse(ProfileSchema, input);
  if (!r.success) {
    return {
      ok: false,
      issues: r.issues.map((issue) => ({
        path: (issue.path ?? [])
          .map((p) => {
            const seg = p as { key?: unknown; type?: string };
            return seg.key !== undefined ? String(seg.key) : '';
          })
          .filter((s) => s !== '')
          .join('.'),
        message: issue.message,
      })),
    };
  }
  // the strict half: every key must be one of the twenty (see exactKeyIssues)
  const keyIssues = exactKeyIssues(r.output.container as Record<string, unknown>);
  if (keyIssues.length) return { ok: false, issues: keyIssues };
  return { ok: true, profile: r.output };
}

/**
 * PLAN ٣-٥: build a complete, self-describing profile document from a container.
 *
 * The round trip this has to survive is stated in the plan as an acceptance test: "a file
 * exported on one device is imported on another and produces the same container, byte for
 * byte". Byte-for-byte is only achievable because `toContainerJson` sorts its keys and
 * this function stores the container object as-is rather than re-serialising it -- see
 * `containerFromProfile`, which reproduces the same sorted-key JSON.
 */
export interface BuildInput {
  id: string;
  title: string;
  year?: number;
  sizeGB?: number;
  soc: string;
  gpu: string;
  ramGB: number;
  /** the object `toContainerJson` would write, already parsed */
  container: Record<string, unknown>;
  result?: { fps: number; tempC?: number; minutes?: number; source: 'user' | 'measured' | 'community' };
  author: string;
  created: string;
  verifiedOnDevice: boolean;
}

export function buildProfile(input: BuildInput): ParseResult {
  const doc = {
    schema: 1 as const,
    game: {
      id: input.id,
      title: input.title,
      ...(input.year !== undefined ? { year: input.year } : {}),
      ...(input.sizeGB !== undefined ? { sizeGB: input.sizeGB } : {}),
    },
    device: { soc: input.soc, gpu: input.gpu, ramGB: input.ramGB },
    container: input.container,
    ...(input.result ? { result: input.result } : {}),
    meta: {
      author: input.author,
      created: input.created,
      verifiedOnDevice: input.verifiedOnDevice,
    },
  };
  return parseProfile(doc);
}

/**
 * The container JSON a profile produces, in the exact form Winlator reads.
 *
 * Same sorted-key serialisation as `toContainerJson`, so `JSON.stringify(containerFromProfile(p))`
 * equals the bytes of the export that produced it. The parity test asserts this against
 * the real generator rather than against a copy of its output (A60).
 */
export function containerFromProfile(p: Profile): string {
  const c = p.container as Record<string, unknown>;
  return JSON.stringify(c, Object.keys(c).sort(), 2) + '\n';
}
