/**
 * "تطبيقات الحاسوب" — the app that matches the product's real goal.
 *
 * The point of the project is running PC *applications*, not touring a Windows
 * desktop. So this window takes a .exe the user picks, reads its PE headers here in
 * the browser (no upload, no backend), and answers honestly:
 *   - what it is (32-bit Win32? .NET? ARM? 64-bit?)
 *   - whether it can run in this build today
 *   - which route it needs when it cannot (Wine layer, or our Win32 runtime)
 */
import { useRef, useState } from 'react';
import { AlertTriangle, AppWindow, CheckCircle2, FileWarning, Loader2, Upload } from 'lucide-react';
import { describePE, inspectPE, type PEInfo } from '../system/pe';
import { sfx } from '../system/sound';

type Row = { name: string; size: number; info: PEInfo };

const VERDICT_STYLE: Record<PEInfo['verdict'], { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  'native-32': { label: 'في نطاق محاكينا', cls: 'ok', icon: CheckCircle2 },
  'native-64': { label: 'يحتاج طبقة Wine', cls: 'warn', icon: AlertTriangle },
  dotnet: { label: 'يحتاج .NET — غير مدعوم', cls: 'bad', icon: FileWarning },
  arm: { label: 'معالج مختلف', cls: 'bad', icon: FileWarning },
  unknown: { label: 'غير معروف', cls: 'bad', icon: FileWarning },
};

export function AppsApp() {
  const ref = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    sfx.tap();
    const next: Row[] = [];
    for (const f of files) {
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        next.push({ name: f.name, size: f.size, info: inspectPE(buf) });
      } catch {
        next.push({ name: f.name, size: f.size, info: { ok: false, imports: [], verdict: 'unknown', verdictText: 'تعذّرت القراءة' } });
      }
    }
    setRows((prev) => [...next, ...prev]);
    setBusy(false);
    sfx.open();
  };

  return (
    <div className="apps-inspector">
      <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>
            <AppWindow size={16} /> تطبيقات الحاسوب
          </h3>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            اختر ملف <code>.exe</code> أو <code>.dll</code> — يُقرأ هنا على جهازك بلا رفع، ونقول لك
            بصراحة: هل يعمل، وبأي مسار.
          </p>
        </div>
        <button className="btn primary" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} اختر ملفاً
        </button>
      </div>

      <input ref={ref} type="file" accept=".exe,.dll,.com" hidden multiple onChange={onFiles} />

      {rows.length === 0 && (
        <div className="apps-empty">
          <p className="muted tiny">
            لم يُختر ملف بعد. جرّب أي <code>.exe</code> قديم على جهازك: برامج ٣٢-بت من تسعينيات
            وألفينيات الألفية هي ما يعمل في هذا المسار.
          </p>
        </div>
      )}

      {rows.map((r) => {
        const v = VERDICT_STYLE[r.info.verdict];
        const Icon = v.icon;
        return (
          <div key={r.name + r.size} className={`pe-card ${v.cls}`}>
            <div className="row between">
              <b dir="ltr" style={{ unicodeBidi: 'plaintext' }}>
                {r.name}
              </b>
              <span className={`chip ${v.cls}`}>
                <Icon size={12} /> {v.label}
              </span>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0' }}>
              {(r.size / 1024).toFixed(0)} كيلو · {r.info.ok ? describePE(r.info) : r.info.reason}
            </p>
            {r.info.ok && r.info.imports.length > 0 && (
              <p className="tiny" dir="ltr" style={{ opacity: 0.75, wordBreak: 'break-word' }}>
                {r.info.imports.slice(0, 8).join(' · ')}
                {r.info.imports.length > 8 ? ` +${r.info.imports.length - 8}` : ''}
              </p>
            )}
            <p className="tiny" style={{ marginTop: 4 }}>
              {r.info.verdictText}
            </p>
          </div>
        );
      })}
    </div>
  );
}
