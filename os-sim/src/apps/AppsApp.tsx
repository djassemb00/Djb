/**
 * "تطبيقات الحاسوب" — the window that matches the product: run PC programs, no OS.
 *
 * The user drops an .exe/.com/.bat. Everything happens locally:
 *   1. read the PE headers (system/pe.ts) and say what the file actually is;
 *   2. pick the route: DOS program → boot it right now on a floppy we build around
 *      it (system/guest.ts + system/fat12.ts); Win32 32-bit → a Wine layer on this
 *      phone; .NET / 64-bit / ARM → say plainly that it will not run;
 *   3. when a program is launchable, a single button boots the machine with the
 *      program as the whole session.
 */
import { useRef, useState } from 'react';
import { AlertTriangle, AppWindow, CheckCircle2, FileWarning, Loader2, Play, Upload } from 'lucide-react';
import { describePE, inspectPE, type PEInfo } from '../system/pe';
import { buildProgramDisk } from '../system/guest';
import { useVM } from '../store/useVM';
import { sfx } from '../system/sound';

type Row = {
  name: string;
  size: number;
  data: Uint8Array;
  info: PEInfo;
  /** what this build can do with the file */
  route: 'dos-now' | 'wine' | 'none';
  routeText: string;
};

const VERDICT_STYLE: Record<PEInfo['verdict'], { cls: string; icon: typeof CheckCircle2 }> = {
  'native-32': { cls: 'warn', icon: CheckCircle2 },
  'native-64': { cls: 'warn', icon: AlertTriangle },
  dotnet: { cls: 'bad', icon: FileWarning },
  arm: { cls: 'bad', icon: FileWarning },
  unknown: { cls: 'ok', icon: CheckCircle2 },
};

const DOS_EXT = /\.(com|exe|bat)$/i;

export function AppsApp() {
  const ref = useRef<HTMLInputElement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const launchProgram = useVM((s) => s.launchProgram);

  const classify = (name: string, data: Uint8Array) => {
    const info = inspectPE(data);
    let route: Row['route'] = 'none';
    let routeText = info.verdictText;

    if (!info.ok) {
      // No PE header: a DOS-era program. That is our strongest path — we boot it.
      route = 'dos-now';
      routeText = 'برنامج DOS: نكتبه على قرص مرن مع نظام FreeDOS ونقلعه الآن — بلا ويندوز';
    } else if (info.isDotNet) {
      route = 'none';
      routeText = 'يحتاج .NET Framework — لا يعمل في أي طبقة على الهاتف اليوم';
    } else if (info.verdict === 'native-32') {
      route = 'wine';
      routeText = 'برنامج Win32 ٣٢-بت: يحتاج طبقة Wine على جهازك (Winlator/GameNative)';
    } else if (info.verdict === 'native-64') {
      route = 'wine';
      routeText = 'برنامج ٦٤-بت: يحتاج Wine + Box64؛ يعمل غالباً لكن ببطء';
    } else {
      route = 'none';
      routeText = 'معمارية غير مدعومة على معالج ARM';
    }
    if (!DOS_EXT.test(name)) route = route === 'dos-now' ? 'none' : route;
    return { info, route, routeText };
  };

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    sfx.tap();
    const next: Row[] = [];
    for (const f of files) {
      const data = new Uint8Array(await f.arrayBuffer());
      const { info, route, routeText } = classify(f.name, data);
      next.push({ name: f.name, size: f.size, data, info, route, routeText });
    }
    setRows((prev) => [...next, ...prev]);
    setBusy(false);
    sfx.open();
  };

  const launch = async (r: Row) => {
    try {
      setBusy(true);
      setError(null);
      const disk = await buildProgramDisk({ name: r.name, data: r.data });
      sfx.open();
      launchProgram({ name: r.name, disk });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="apps-inspector">
      <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>
            <AppWindow size={16} /> تطبيقات الحاسوب
          </h3>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            ألقِ ملف <code>.exe</code> أو <code>.com</code> هنا. يُفحص على جهازك بلا رفع، ونقول
            لك: هل يعمل، وبأي طريق — ثم زر «شغّل» إن كان يعمل الآن.
          </p>
        </div>
        <button className="btn primary" onClick={() => ref.current?.click()} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} اختر ملفاً
        </button>
      </div>

      <input ref={ref} type="file" accept=".exe,.com,.bat,.dll" hidden multiple onChange={onFiles} />

      {error && (
        <p className="tiny" style={{ color: '#f87171', margin: 0 }}>
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {rows.length === 0 && (
        <div className="apps-empty">
          <p className="muted tiny" style={{ margin: 0 }}>
            لا ملف بعد. الأسرع أن تجرّب برنامج DOS: أي <code>.com</code> أو لعبة من التسعينيات
            تعمل فوراً. برامج ويندوز الحديثة (.NET) لن تعمل، ونقول لك ذلك قبل أن تحاول.
          </p>
        </div>
      )}

      {rows.map((r, i) => {
        const v = VERDICT_STYLE[r.info.verdict];
        const Icon = v.icon;
        return (
          <div key={`${r.name}-${i}`} className={`pe-card ${v.cls}`}>
            <div className="row between">
              <b dir="ltr" style={{ unicodeBidi: 'plaintext' }}>
                {r.name}
              </b>
              <span className={`chip ${v.cls}`}>
                <Icon size={12} /> {r.info.ok ? r.info.machine : 'DOS'}
              </span>
            </div>
            <p className="tiny muted" style={{ margin: '4px 0' }}>
              {(r.size / 1024).toFixed(0)} كيلو · {r.info.ok ? describePE(r.info) : 'برنامج DOS'}
            </p>
            <p className="tiny" style={{ margin: '4px 0' }}>
              {r.routeText}
            </p>
            {r.info.ok && r.info.imports.length > 0 && (
              <p className="tiny" dir="ltr" style={{ opacity: 0.6, wordBreak: 'break-word' }}>
                {r.info.imports.slice(0, 8).join(' · ')}
                {r.info.imports.length > 8 ? ` +${r.info.imports.length - 8}` : ''}
              </p>
            )}
            {r.route === 'dos-now' && (
              <button className="btn primary" onClick={() => void launch(r)} disabled={busy}>
                <Play size={13} /> شغّل الآن
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
