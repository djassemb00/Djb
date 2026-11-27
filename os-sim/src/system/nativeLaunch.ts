/**
 * PLAN ٢-٢ and ٢-٣: the JavaScript side of the native launch bridge.
 *
 * Every function here answers with data, never with an assumption: "is Winlator
 * installed" is a query to the plugin, and an absent plugin reports `available: false`
 * rather than a guess. The web build keeps working -- it simply says the lane needs the
 * phone, which is true.
 */
export interface DetectResult {
  available: boolean;
  installed: string[];
  /** version of the first installed host app, '' when unknown */
  version: string;
}

export interface LaunchResult {
  launched: boolean;
  package?: string;
  storeUrl?: string;
  reason?: string;
}

export interface PendingShare {
  pending: boolean;
  name?: string;
  type?: string;
  uri?: string;
  reason?: string;
}

interface PluginLike {
  detect: () => Promise<DetectResult>;
  openContainer: (o: { path: string }) => Promise<LaunchResult>;
  takePendingShare: () => Promise<PendingShare>;
}

type Bridge = {
  Capacitor?: { isNativePlatform?: () => boolean };
  CapacitorPlugins?: { NativeLaunch?: PluginLike };
};

/**
 * A stand-in for the native bridge.
 *
 * `registerPlugin` on a web build hands back a proxy whose promise never settles without
 * a real WebView, so a suite cannot exercise the caching and classification in this file
 * through the real bridge -- I tried, and the test hung for 60 seconds on a pending
 * promise. This seam is the one place a test may supply a plugin; nothing in src/ sets it.
 */
let injected: PluginLike | null = null;

export function __setNativeLaunchForTest(p: PluginLike | null): void {
  injected = p;
}

async function plugin(): Promise<PluginLike | null> {
  if (injected) return injected;
  const w = (typeof window === 'undefined' ? undefined : window) as Bridge | undefined;
  if (!w?.Capacitor?.isNativePlatform?.()) return null;
  try {
    const mod = (await import('@capacitor/core')) as unknown as {
      registerPlugin?: <T>(name: string) => T;
    };
    return (mod.registerPlugin?.<PluginLike>('NativeLaunch') as PluginLike) ?? null;
  } catch {
    return null;
  }
}

/** Which host app, if any, can open a container. */
export async function detectHost(): Promise<DetectResult> {
  const p = await plugin();
  if (!p) return { available: false, installed: [], version: '' };
  try {
    const r = await p.detect();
    return {
      available: r.installed.length > 0,
      installed: r.installed ?? [],
      version: r.version ?? '',
    };
  } catch {
    return { available: false, installed: [], version: '' };
  }
}

/** Hand a container file to the host app, or explain why we cannot. */
export async function openInHost(path: string): Promise<LaunchResult> {
  const p = await plugin();
  if (!p) {
    return {
      launched: false,
      storeUrl: 'https://github.com/brunodev85/winlator/releases',
      reason: 'هذه الميزة تحتاج تطبيق الهاتف؛ المتصفح لا يفتح تطبيقات أخرى',
    };
  }
  try {
    return await p.openContainer({ path });
  } catch (e) {
    return { launched: false, reason: (e as Error)?.message ?? 'خطأ غير معروف' };
  }
}

/**
 * Extensions we accept from other apps (PLAN ٢-٣). A share-in of anything else is
 * rejected by name instead of opening a window that then cannot use it.
 */
export const ACCEPTED_EXT = ['.exe', '.com', '.img', '.iso', '.zip'] as const;

export interface ShareTarget {
  /** the file name as the sending app presented it */
  name: string;
  /** URI looks the same whether it is a content:// or a file:// */
  uri: string;
}

/** Decide what to do with a file handed to us by another app. */
export function classifyShare(t: ShareTarget):
  | { accept: true; kind: 'program' | 'image' | 'archive' }
  | { accept: false; reason: string } {
  const lower = t.name.toLowerCase();
  const ext = ACCEPTED_EXT.find((e) => lower.endsWith(e));
  if (!ext) {
    return { accept: false, reason: `صيغة غير مدعومة: ${t.name} (نقبل ${ACCEPTED_EXT.join(' ')})` };
  }
  if (ext === '.zip') return { accept: true, kind: 'archive' };
  if (ext === '.img' || ext === '.iso') return { accept: true, kind: 'image' };
  return { accept: true, kind: 'program' };
}

/**
 * PLAN ٢-٣: did the user open us *with* a file?
 *
 * The honest answer on the web build is "no": there is no share intent in a browser
 * tab, and inventing one would be the same lie as the dead buttons this cycle removed.
 * On the phone the answer comes from the activity's intent. A read clears it natively,
 * so calling this twice cannot re-import the same file.
 */
let shareAsked = false;
let shareCache: PendingShare | null = null;

export async function takeSharedFile(): Promise<PendingShare> {
  /*
   * Asked once per JS session, then answered from memory.
   *
   * The native side clears the pending intent on read (that is what stops the same file
   * being re-imported on the next launch). But two callers legitimately need the answer:
   * App.tsx opens the window the file belongs to, and GameSetupApp.tsx renders what the
   * file was judged to be. Asking twice meant the second caller always saw "nothing" and
   * the window opened empty -- a race I introduced and then measured.
   */
  if (shareAsked && shareCache) return shareCache;
  if (shareAsked) return { pending: false };
  const p = await plugin();
  shareAsked = true;
  if (!p) {
    shareCache = { pending: false, reason: 'المتصفح لا يستقبل ملفات من تطبيقات أخرى' };
    return shareCache;
  }
  try {
    const r = await p.takePendingShare();
    shareCache = r?.pending ? r : { pending: false, reason: r?.reason };
    return shareCache;
  } catch (e) {
    shareCache = { pending: false, reason: (e as Error)?.message ?? 'تعذّر قراءة الملف المشترك' };
    return shareCache;
  }
}

/** Test hook: the cache is per page load, so a suite needs a way to start over. */
export function __resetSharedFileCache(): void {
  shareAsked = false;
  shareCache = null;
}

/**
 * The one decision the receive lane makes: is this file something we can install?
 *
 * `classifyShare` only looks at the name, which is fine for a human-readable refusal but
 * not enough on its own -- a sender can label anything `.exe`. So the MIME type is
 * checked too, and disagreement between the two is reported rather than resolved
 * silently: guessing which one is right is how a `.jpg` becomes a "program".
 */
export function judgeShare(t: ShareTarget & { type?: string }):
  | { accept: true; kind: 'program' | 'image' | 'archive' }
  | { accept: false; reason: string } {
  const byName = classifyShare(t);
  if (!byName.accept) return byName;
  const type = (t.type ?? '').toLowerCase();
  if (!type) return byName; // no type offered: the name is all we have, and it is enough
  const looksGeneric = type === 'application/octet-stream' || type === '*/*';
  if (looksGeneric) return byName;
  const coherent =
    (byName.kind === 'archive' && (type.includes('zip') || type.includes('archive'))) ||
    (byName.kind === 'image' && (type.includes('iso') || type.includes('disk') || type.includes('image'))) ||
    (byName.kind === 'program' &&
      (type.includes('executable') || type.includes('msdownload') || type.includes('dos-')));
  if (coherent) return byName;
  return {
    accept: false,
    reason: `نوع الملف (${type}) لا يطابق امتداده (${t.name}) — لن نخمّن أيّهما الصحيح`,
  };
}
