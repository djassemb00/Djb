/**
 * The numbers the Monitor app is allowed to show, and where each one comes from.
 *
 * The old Monitor was pure theatre: `Math.random()` drove the CPU figure, the RAM
 * figure, the history graph AND all eight rows of the process table. It refreshed on a
 * timer and looked exactly like telemetry. Measured: five Math.random() calls in the
 * file, zero reads from any API.
 *
 * A web app runs inside a WebView. It cannot read the system CPU load, cannot read other
 * processes, and cannot read a temperature. What it CAN measure exactly is itself:
 *
 *   - how much JS heap it is using   (performance.memory, Chromium only)
 *   - how many windows/files/notes it holds   (our own store, exact)
 *   - how much disk it has persisted and how much quota is left
 *   - its own frame rate and the emulator's speed
 *
 * So this module returns only those, and marks everything else as unmeasurable rather
 * than inventing a plausible-looking digit.
 */
export interface Vitals {
  /** JS heap in MB, or null when the engine does not expose performance.memory */
  heapMB: number | null;
  /** JS heap limit in MB, or null */
  heapLimitMB: number | null;
  /** count of open windows -- exact, from the store */
  windows: number;
  /** count of files across the virtual FS -- exact */
  files: number;
  notes: number;
  /** bytes persisted to the device, if the store could be read */
  diskUsedMB: number | null;
  diskQuotaMB: number | null;
  /** true when the heap figures came from a real API */
  measured: boolean;
}

type PerfLike = { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } };

/** Everything measurable, with no defaults that could be mistaken for readings. */
export function readVitals(
  perf?: PerfLike,
  counts?: { windows?: number; files?: number; notes?: number },
): Vitals {
  const p = perf ?? (typeof performance === 'undefined' ? undefined : (performance as unknown as PerfLike));
  const mem = p?.memory;
  const bytesToMB = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;
  return {
    heapMB: mem ? bytesToMB(mem.usedJSHeapSize) : null,
    heapLimitMB: mem ? bytesToMB(mem.jsHeapSizeLimit) : null,
    windows: counts?.windows ?? 0,
    files: counts?.files ?? 0,
    notes: counts?.notes ?? 0,
    diskUsedMB: null,
    diskQuotaMB: null,
    measured: !!mem,
  };
}

/**
 * Processes a browser app genuinely has. The old list named `surfaceflinger` -- an
 * Android system daemon -- as one of OUR processes, which is a claim about the phone,
 * not about us. These are real: the app's own threads plus the emulator worker.
 */
export const OUR_THREADS = ['main', 'render', 'emulator', 'audio'] as const;

/** Things this app will never be able to measure, stated so the UI can say so. */
export const UNMEASURABLE = [
  'حِمل المعالج الكلي للهاتف',
  'عمليات التطبيقات الأخرى',
  'درجة حرارة الجهاز',
  'استهلاك البطارية اللحظي',
] as const;
