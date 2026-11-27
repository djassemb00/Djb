import { useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick, Info } from 'lucide-react';
import { useOS } from '../store/useOS';
import { OUR_THREADS, UNMEASURABLE, readVitals } from '../system/vitals';

/** the ticker only exists so the heap reading refreshes; nothing here is generated */

function useTicker(ms = 1200) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => set((n) => n + 1), ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function MonitorApp() {
  useTicker(1200);
  const windows = useOS((s) => s.windows);
  const notes = useOS((s) => s.notes);
  const fs = useOS((s) => s.fs);
  // Real heap figures, sampled on the ticker. Chromium exposes performance.memory;
  // if it does not, `measured` is false and the UI says "not available" instead of
  // printing a number that means nothing.
  const [vitals, setVitals] = useState(() => readVitals());
  useEffect(() => {
    setVitals(readVitals(undefined, { windows: windows.length, notes: notes.length }));
  }, [windows.length, notes.length]);

  return (
    <div className="app-shell">
      <div className="app-toolbar">
        <Activity size={14} />
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>مراقب النظام</span>
        <span className="chip">حيّ · كل 1.2 ثانية</span>
      </div>
      <div className="app-content">
        <div className="monitor">
          <div className="stat-grid">
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <Cpu size={12} /> الذاكرة (JS)
              </span>
              <b>{vitals.heapMB === null ? '—' : `${vitals.heapMB} MB`}</b>
              <span>
                {vitals.measured
                  ? `من ${vitals.heapLimitMB} MB متاحة لهذا التطبيق`
                  : 'المحرّك لا يفصح عن حجم الذاكرة'}
              </span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <MemoryStick size={12} /> النوافذ
              </span>
              <b>{vitals.windows}</b>
              <span>نافذة مفتوحة الآن</span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <HardDrive size={12} /> الملفات
              </span>
              <b>{countFS(fs)}</b>
              <span>عنصراً في نظام الملفات</span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <Activity size={12} /> العمليات
              </span>
              <b>{vitals.notes}</b>
              <span>ملاحظة محفوظة</span>
            </div>
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 650 }}>
                <Info size={11} /> ما لا يستطيع تطبيق ويب قياسه
              </span>
            </div>
            <p className="tiny muted" style={{ lineHeight: 1.7, margin: 0 }}>
              {UNMEASURABLE.join(' · ')}
              <br />
              محتواه محجوب عن كل تطبيق ويب (بلا صلاحية نظام أو Shizuku/root)، فلا
              نرسم له رسماً بيانياً: الرقم الذي لا يُقاس لا يُعرض.
            </p>
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 650 }}>العمليات</span>
              <span className="tiny muted">
                ملاحظات: {notes.length} · عناصر VFS: {countFS(fs)}
              </span>
            </div>
            {OUR_THREADS.map((t) => (
              <div className="process-row" key={t}>
                <span className="os-mono" style={{ width: 118, fontSize: 10.5 }}>
                  nova://{t}
                </span>
                <span className="tiny muted" style={{ fontSize: 10 }}>
                  خيط داخل هذا التطبيق — الحِمل لكل خيط لا يُقاس من الويب
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function countFS(node: { type: string; children?: unknown[] }): number {
  if (node.type === 'file') return 1;
  const kids = (node.children ?? []) as { type: string; children?: unknown[] }[];
  return 1 + kids.reduce((a, c) => a + countFS(c), 0);
}
