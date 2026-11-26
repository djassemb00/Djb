import { useEffect, useMemo, useState } from 'react';
import { Activity, Cpu, HardDrive, MemoryStick } from 'lucide-react';
import { useOS } from '../store/useOS';

const PROC = ['nova-wm', 'nova-shell', 'files', 'notes', 'terminal', 'gallery', 'settings', 'surfaceflinger'];

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
  const [cpuHist] = useState(() => Array.from({ length: 24 }, () => 10 + Math.random() * 18));
  const [cpu, setCpu] = useState(18);
  const [ram, setRam] = useState(2416);

  useEffect(() => {
    setCpu(Math.max(4, Math.min(88, cpu + (Math.random() - 0.5) * 22 + windows.length * 1.4)));
    setRam(() => Math.round(1900 + windows.length * 120 + Math.random() * 260));
  }, [windows.length, cpuHist]);

  const hist = useMemo(() => [...cpuHist.slice(1), cpu], [cpu, cpuHist]);

  const procs = PROC.map((name, i) => ({
    name,
    cpu: Math.max(0.2, (cpu / PROC.length) * (1 + Math.random()) * (i === 0 ? 2.4 : 1)),
    mem: 60 + Math.random() * 220,
  })).sort((a, b) => b.cpu - a.cpu);

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
                <Cpu size={12} /> المعالج
              </span>
              <b>{cpu.toFixed(0)}%</b>
              <span>nova-core · 4 أنوية</span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <MemoryStick size={12} /> الذاكرة
              </span>
              <b>{(ram / 1024).toFixed(1)} GB</b>
              <span>من 8 GB مستخدمة</span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <HardDrive size={12} /> التخزين
              </span>
              <b>4.9 GB</b>
              <span>من 8 GB مستخدمة</span>
            </div>
            <div className="stat">
              <span className="row" style={{ gap: 5 }}>
                <Activity size={12} /> العمليات
              </span>
              <b>{procs.length + windows.length}</b>
              <span>{windows.length} نافذة مفتوحة</span>
            </div>
          </div>

          <div className="card">
            <div className="row between">
              <span style={{ fontSize: 11.5, fontWeight: 650 }}>حمل المعالج — آخر 30 ثانية</span>
              <span className="tiny muted">{cpu.toFixed(1)}%</span>
            </div>
            <div className="spark">
              {hist.map((v, i) => (
                <i key={i} style={{ height: `${Math.max(6, Math.min(100, v))}%` }} />
              ))}
            </div>
          </div>

          <div className="card">
            <div className="row between" style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, fontWeight: 650 }}>العمليات</span>
              <span className="tiny muted">
                ملاحظات: {notes.length} · عناصر VFS: {countFS(fs)}
              </span>
            </div>
            {procs.map((p) => (
              <div className="process-row" key={p.name}>
                <span className="os-mono" style={{ width: 118, fontSize: 10.5 }}>
                  {p.name}
                </span>
                <span style={{ width: 44, fontSize: 10, color: 'var(--text-dim)' }}>{p.cpu.toFixed(1)}%</span>
                <div className="proc-bar">
                  <i style={{ width: `${Math.min(100, p.cpu * 6)}%` }} />
                </div>
                <span style={{ width: 52, fontSize: 10, color: 'var(--text-dim)', textAlign: 'left' }} className="os-mono">
                  {p.mem.toFixed(0)} MB
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
