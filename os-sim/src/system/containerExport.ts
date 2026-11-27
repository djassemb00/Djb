/**
 * Getting a container OFF the device and into the user's hands.
 *
 * PLAN.md ٢-١ asks for `Documents/NovaPC/<name>.container.json`, with the acceptance
 * test "the file appears in the phone's file manager with valid JSON".
 *
 * The old code did the browser thing: a Blob URL and an `<a download>`. That is correct
 * in a browser and dead inside the APK -- a WebView only downloads through a
 * DownloadListener, and this project's MainActivity installs none (measured: grep for
 * DownloadListener in android/app/src/main/java returns nothing). So on the phone the
 * button appeared to work and produced no file.
 *
 * Three lanes, in order of preference:
 *   1. Capacitor Filesystem -> Directory.Documents. Real shared storage; the file shows
 *      up in the phone's file manager, which is what the plan asks for.
 *   2. The browser download (a dev server or a desktop preview).
 *   3. Copy to the clipboard, so a failure never leaves the user with nothing.
 *
 * Every lane reports what actually happened; none of them says "saved" without a result.
 */
export type ExportLane = 'documents' | 'download' | 'clipboard' | 'failed';

export interface ExportResult {
  ok: boolean;
  lane: ExportLane;
  /** where it went, exactly as the user should be told */
  where: string;
  bytes: number;
  error?: string;
}

/** the folder the plan names, relative to Directory.Documents */
export const EXPORT_DIR = 'NovaPC';

interface FilesystemLike {
  writeFile: (o: unknown) => Promise<{ uri: string }>;
  mkdir?: (o: unknown) => Promise<unknown>;
}

export interface ExportDeps {
  /** injected in tests; the real one is dynamic-imported @capacitor/filesystem */
  Filesystem?: FilesystemLike;
  Directory?: { Documents: string };
  /** browser fallback; undefined in Node */
  browserDownload?: (name: string, text: string) => void;
  copy?: (text: string) => Promise<void>;
  /** true when running inside a Capacitor shell */
  native?: boolean;
}

/** Is a native shell present? Capacitor injects window.Capacitor at runtime. */
export function isNativeShell(win: unknown = typeof window === 'undefined' ? undefined : window): boolean {
  const w = win as { Capacitor?: { isNativePlatform?: () => boolean } } | undefined;
  try {
    return !!w?.Capacitor?.isNativePlatform?.();
  } catch {
    return false;
  }
}

export async function exportContainer(
  name: string,
  text: string,
  deps: ExportDeps = {},
): Promise<ExportResult> {
  const bytes = new TextEncoder().encode(text).length;
  const native = deps.native ?? isNativeShell();
  let nativeError: string | undefined;
  let browserError: string | undefined;

  // 1. native: write to shared Documents
  if (deps.Filesystem && deps.Directory) {
    try {
      await deps.Filesystem.mkdir?.({ path: EXPORT_DIR, directory: deps.Directory.Documents, recursive: true }).catch(
        () => undefined,
      );
      const res = await deps.Filesystem.writeFile({
        path: `${EXPORT_DIR}/${name}`,
        data: text,
        directory: deps.Directory.Documents,
        encoding: 'utf8',
        recursive: true,
      });
      return { ok: true, lane: 'documents', where: res?.uri || `Documents/${EXPORT_DIR}/${name}`, bytes };
    } catch (e) {
      // fall through: a failed native write must not end in a fake success
      nativeError = (e as Error)?.message ?? String(e);
    }
  }

  // 2. browser download
  if (!native && deps.browserDownload) {
    try {
      deps.browserDownload(name, text);
      return { ok: true, lane: 'download', where: `تنزيلات المتصفح/${name}`, bytes };
    } catch (e) {
      browserError = (e as Error)?.message ?? String(e);
    }
  }

  // 3. clipboard: the text is at least recoverable
  if (deps.copy) {
    try {
      await deps.copy(text);
      return {
        ok: true,
        lane: 'clipboard',
        where: 'الحافظة (الصقها في ملف بنفسك)',
        bytes,
        error: nativeError ?? browserError,
      };
    } catch {
      /* nothing left */
    }
  }

  return {
    ok: false,
    lane: 'failed',
    where: 'لم يُحفظ في أي مكان',
    bytes,
    error: nativeError ?? browserError ?? 'no storage lane available',
  };
}

/** The message the user sees. It names the lane, because "saved" alone is a claim. */
export function describeExport(r: ExportResult): string {
  if (!r.ok) return `فشل الحفظ: ${r.error ?? 'سبب غير معروف'}`;
  const kb = (r.bytes / 1024).toFixed(1);
  if (r.lane === 'documents') return `حُفظ في ${r.where} (${kb} كيلو) — افتح Winlator واستورد الملف`;
  if (r.lane === 'download') return `نُزّل إلى ${r.where} (${kb} كيلو)`;
  return `انسخ إلى ${r.where} — ${kb} كيلو`;
}

/** The real dependencies, resolved lazily so the browser build never loads the plugin. */
export async function realExportDeps(): Promise<ExportDeps> {
  const native = isNativeShell();
  const deps: ExportDeps = { native };
  if (native) {
    try {
      const fs = await import('@capacitor/filesystem');
      deps.Filesystem = fs.Filesystem as unknown as FilesystemLike;
      deps.Directory = fs.Directory as unknown as { Documents: string };
    } catch {
      /* plugin absent from this build: the clipboard lane will carry it */
    }
  } else if (typeof document !== 'undefined') {
    deps.browserDownload = (name, text) => {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    };
  }
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    deps.copy = (text) => navigator.clipboard.writeText(text);
  }
  return deps;
}
