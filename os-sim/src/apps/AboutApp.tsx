import { Cpu, HardDrive, MemoryStick, MonitorSmartphone, Smartphone } from 'lucide-react';
import { useOS } from '../store/useOS';
import { NovaMark } from '../components/NovaMark';
import { useElementSize } from '../system/hooks';

/** what we actually redistribute, and under which licence — BSD requires it on the UI */
const CREDITS: { name: string; licence: string; note: string; href?: string }[] = [
  { name: 'v86', licence: 'BSD-2-Clause', note: 'محرّك محاكاة x86 داخل WebAssembly', href: 'licenses/v86-LICENSE.txt' },
  { name: 'FreeDOS', licence: 'GPL-2.0', note: 'نظام DOS على قرص البرامج (ملفات النظام)' },
  { name: 'KolibriOS', licence: 'GPL-2.0', note: 'نظام سطح مكتب مصغّر' },
  { name: 'NovaDesk · NovaOS', licence: 'كل الحقوق محفوظة', note: 'نواتنا وواجهتنا وبرامجنا (MENU · SNAKE · PONG)' },
];

export function AboutApp() {
  const viewport = useOS((s) => s.viewport);
  const settings = useOS((s) => s.settings);
  const windows = useOS((s) => s.windows);
  const { ref, size } = useElementSize<HTMLDivElement>();

  return (
    <div className="app-shell">
      <div className="app-content" ref={ref}>
        <div className="about-hero">
          <div className="logo-badge">
            <NovaMark />
          </div>
          <b style={{ fontSize: 17, letterSpacing: 1 }}>NovaOS</b>
          <span className="tiny muted">نظام تشغيل محاكى · الإصدار 1.0.0</span>
          <span className="chip">build 2026.11 · nova-core</span>
        </div>

        <div style={{ padding: '0 14px 16px' }}>
          <div className="card">
            <div className="launcher-section" style={{ marginBottom: 4 }}>
              المكوّنات والتراخيص
            </div>
            {CREDITS.map((c) => (
              <div className="spec-row" key={c.name}>
                <span>{c.name}</span>
                <span className="os-mono tiny">
                  {c.href ? (
                    <a href={c.href} target="_blank" rel="noreferrer noopener">
                      {c.licence}
                    </a>
                  ) : (
                    c.licence
                  )}
                  {' · '}
                  <span className="muted">{c.note}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="spec-row">
              <span className="row" style={{ gap: 6 }}>
                <Smartphone size={12} /> الجهاز
              </span>
              <span>Nova Phone X1</span>
            </div>
            <div className="spec-row">
              <span className="row" style={{ gap: 6 }}>
                <Cpu size={12} /> المعالج
              </span>
              <span className="os-mono">nova-core · 4 cores</span>
            </div>
            <div className="spec-row">
              <span className="row" style={{ gap: 6 }}>
                <MemoryStick size={12} /> الذاكرة
              </span>
              <span className="os-mono">8 GB</span>
            </div>
            <div className="spec-row">
              <span className="row" style={{ gap: 6 }}>
                <HardDrive size={12} /> التخزين
              </span>
              <span className="os-mono">128 GB</span>
            </div>
            <div className="spec-row">
              <span className="row" style={{ gap: 6 }}>
                <MonitorSmartphone size={12} /> الشاشة
              </span>
              <span className="os-mono">
                {viewport.w}×{viewport.h}
              </span>
            </div>
          </div>

          <div className="section-title">الجلسة</div>
          <div className="card">
            <div className="spec-row">
              <span>المستخدم</span>
              <span>{settings.user}</span>
            </div>
            <div className="spec-row">
              <span>السمة</span>
              <span>{settings.theme === 'dark' ? 'داكنة' : 'فاتحة'}</span>
            </div>
            <div className="spec-row">
              <span>نوافذ مفتوحة</span>
              <span>{windows.length}</span>
            </div>
            <div className="spec-row">
              <span>مساحة النافذة</span>
              <span className="os-mono">
                {size.w}×{size.h}
              </span>
            </div>
          </div>

          <p className="tiny muted" style={{ marginTop: 12, lineHeight: 1.8 }}>
            NovaOS محاكاة لتجربة نظام تشغيل كاملة داخل تطبيق واحد. الإقلاع وشاشة القفل ومدير النوافذ ونظام
            الملفات والطرفية كلها تعمل فعليًا في هذا التطبيق — لكنها تعمل فوق نظام أندرويد، وليست بديلًا عن
            نواة الجهاز.
          </p>
        </div>
      </div>
    </div>
  );
}
