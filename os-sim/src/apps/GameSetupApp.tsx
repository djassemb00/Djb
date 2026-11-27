/**
 * "إعداد لعبة" — the console-layer window.
 *
 * Our app cannot run GTA V (measured: 70 MIPS vs the thousands an AAA title needs),
 * but it can remove the two things that actually make people give up on the native
 * lane: not knowing which lane a title needs, and not knowing which container
 * settings to use. This window answers both, then hands over a real .container file
 * for Winlator plus a one-tap open of the native route.
 *
 * Everything shown is generated from src/system/winePrefix.ts, so the numbers live
 * in one audited place instead of drifting in this component.
 */
import { useEffect, useMemo, useState } from 'react';
import { Cpu, Download, Gamepad2, Info, Loader2, Smartphone } from 'lucide-react';
import { CATALOG, LANE_LABEL, type CatalogEntry } from '../system/catalog';
import {
  containerFileName,
  daysSince,
  generateProfile,
  PREREQUISITES,
  SOURCE_STALE_DAYS,
  SOURCES,
  toContainerJson,
} from '../system/winePrefix';
import { sfx } from '../system/sound';
import { EXPORT_DIR, describeExport, exportContainer, realExportDeps } from '../system/containerExport';
import { CONTAINER_GB, STATE_LABEL, evaluateRoute, type Answers } from '../system/routeStatus';
import { detectHost, judgeShare, openInHost, takeSharedFile } from '../system/nativeLaunch';
import { storageStatus } from '../system/diskStore';


export function GameSetupApp() {
  const [selected, setSelected] = useState<CatalogEntry>(CATALOG[0]);
  const [dx9, setDx9] = useState(false);
  const [is32, setIs32] = useState(false);
  const [saving, setSaving] = useState(false);
  /** what actually happened to the last export, in the user's words */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  /*
   * PLAN ٢-٥. A web app cannot list installed packages or read a driver version, so the
   * two facts only the user knows are ASKED, not faked. The one fact we can measure --
   * free space in our own storage bucket -- is measured.
   */
  const [answers, setAnswers] = useState<Answers>({});
  const [opening, setOpening] = useState(false);
  const [freeBytes, setFreeBytes] = useState<number | null>(null);
  /*
   * PLAN ٢-٣. A file shared into the app from the phone's file manager. `undefined` means
   * "we asked and there was none" (opened from the launcher); a verdict means we have a
   * real name and type. The distinction matters: rendering "لا يوجد ملف مشترك" before
   * asking would be a claim we have not measured.
   */
  const [shared, setShared] = useState<ReturnType<typeof judgeShare> | undefined>(undefined);
  const [sharedName, setSharedName] = useState<string>('');

  const profile = useMemo(
    () => generateProfile({ title: selected.title, is32, dx9 }),
    [selected, is32, dx9],
  );
  const lane = LANE_LABEL[selected.lane];
  const json = useMemo(() => toContainerJson(profile), [profile]);

  useEffect(() => {
    let alive = true;
    void storageStatus().then((st) => {
      if (!alive) return;
      // quota - usage, but only when the browser actually reported a quota
      // quota and usage are BYTES (diskStore), and either may be null
      const free =
        typeof st.quota === 'number' && typeof st.usage === 'number'
          ? Math.max(0, st.quota - st.usage)
          : null;
      setFreeBytes(free);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void takeSharedFile().then((r) => {
      if (!alive) return;
      if (!r.pending) {
        // Not an error: the app was simply opened from the launcher.
        setShared(undefined);
        return;
      }
      setSharedName(r.name || r.uri || '');
      setShared(judgeShare({ name: r.name ?? '', uri: r.uri ?? '', type: r.type }));
    });
    return () => {
      alive = false;
    };
  }, []);

  const route = evaluateRoute({
    answers,
    freeBytes,
    needGB: selected.sizeGB ?? 2,
    native: true,
  });

  const save = async () => {
    setSaving(true);
    sfx.tap();
    /*
     * PLAN ٢-١: write Documents/NovaPC/<name>.container.json and tell the user where it
     * went. The old code handed a Blob to an <a download>, which does nothing inside the
     * APK (no DownloadListener is installed on the WebView) -- the button looked alive
     * and produced no file. exportContainer() reports the lane it actually used.
     */
    const deps = await realExportDeps();
    const r = await exportContainer(containerFileName(selected.title), json, deps);
    setResult({ ok: r.ok, text: describeExport(r) });
    setSaving(false);
  };

  return (
    <div className="setup-app">
      <div className="row between" style={{ gap: 10, alignItems: 'flex-start' }}>
        <div>
          <h3 style={{ margin: 0 }}>
            <Gamepad2 size={16} /> إعداد لعبة للإقلاع
          </h3>
          <p className="tiny muted" style={{ margin: '4px 0 0' }}>
            اختر اللعبة، فيُولّد التطبيق ملف حاوية جاهزاً لـWinlator — بإعدادات مبنية على قياسات
            جهازك لا على التخمين.
          </p>
        </div>
      </div>

      <div className="launcher-section" style={{ marginTop: 6 }}>
        اللعبة
      </div>
      <div className="setup-games">
        {CATALOG.filter((g) => g.lane !== 'none').map((g) => (
          <button
            key={g.id}
            className={`setup-game ${g.id === selected.id ? 'on' : ''}`}
            onClick={() => {
              setSelected(g);
              sfx.tap();
            }}
          >
            {g.title}
          </button>
        ))}
      </div>

      <div className={`lane-banner ${lane.cls}`}>
        <b>{lane.label}</b>
        <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>
          {lane.hint} · {selected.fps} إطاراً/ثانية على جهازك
        </span>
      </div>

      <div className="setup-row">
        <label className="setup-check">
          <input type="checkbox" checked={is32} onChange={(e) => setIs32(e.target.checked)} />
          الملف ٣٢-بت (يفعّل WOW64)
        </label>
        <label className="setup-check">
          <input type="checkbox" checked={dx9} onChange={(e) => setDx9(e.target.checked)} />
          اللعبة DirectX 9 (يستخدم DXVK 1.10.3)
        </label>
      </div>

      <div className="setup-row">
        <span className="chip ok">
          <Cpu size={12} /> {profile.width}×{profile.height}
        </span>
        <span className="chip ok">Turnip</span>
        <span className="chip ok">DXVK {profile.dxvk}</span>
        <span className="chip ok">FEXCore · win64</span>
      </div>

      {/* PLAN ٢-٥: three states, and only the two facts the user can answer are asked */}
      <div className="card" style={{ margin: '10px 0' }}>
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <b style={{ fontSize: 12.5 }}>
            حالة المسار · {route.verdict === 'ready' ? '✅' : route.verdict === 'blocked' ? '⛔' : '⚠️'}
          </b>
          <span className="tiny muted">
            تحتاج {route.needGB} غيغا (اللعبة + {CONTAINER_GB} للحاوية)
          </span>
        </div>
        <p className="tiny muted" style={{ margin: '4px 0 6px' }}>{route.title}</p>
        {route.requirements.map((r) => {
          const s2 = STATE_LABEL[r.state];
          return (
            <div key={r.id} className="row between" style={{ gap: 8, padding: '3px 0' }}>
              <span className="tiny" style={{ flex: 1 }}>
                {s2.mark} {r.label}
                <span className="muted"> — {r.why}</span>
              </span>
              {r.state === 'unknown' && (
                <button
                  className="btn"
                  style={{ padding: '2px 7px', fontSize: 10.5 }}
                  onClick={() => {
                    sfx.tap();
                    setAnswers((a) => ({ ...a, [r.id]: true }));
                  }}
                >
                  عندي
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/*
        PLAN ٢-٣. The share lane's landing card. Without it a shared file parses into a
        verdict that nobody ever sees -- which is how the intent filter alone would have
        looked finished while doing nothing.
      */}
      {shared && (
        <div
          role="status"
          style={{
            margin: '8px 0',
            padding: '8px 10px',
            borderRadius: 8,
            border: `1px solid ${shared.accept ? 'var(--ok, #34d399)' : 'var(--danger, #f87171)'}`,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          <strong>{shared.accept ? 'ملف جاهز للتثبيت' : 'ملف مرفوض'}</strong>
          <div className="tiny" style={{ marginTop: 2 }}>
            {sharedName}
          </div>
          <div className="tiny" style={{ marginTop: 2 }}>
            {shared.accept
              ? shared.kind === 'program'
                ? 'برنامج Windows — يُثبَّت كتطبيق داخل النظام الوهمي'
                : shared.kind === 'image'
                  ? 'صورة قرص — تُستخدم كقرص C أو D'
                  : 'أرشيف — يُفكّ ثم يُثبَّت ما بداخله'
              : shared.reason}
          </div>
        </div>
      )}

      <div className="setup-actions">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="spin" /> : <Download size={13} />} نزّل ملف الحاوية
        </button>
        <button
          className="btn"
          disabled={opening}
          onClick={async () => {
            /*
             * PLAN ٢-٢. This used to window.open('https://winlator.com') -- a page, not
             * the app, and dead inside a WebView. Now: query which host app is installed,
             * hand it the exported file, and if neither is possible say which and why.
             */
            sfx.tap();
            setOpening(true);
            const host = await detectHost();
            if (!host.available) {
              setResult({
                ok: false,
                text: 'لا يوجد Winlator/GameNative على الجهاز — ثبّته أولاً، ثم سيفتح هذا الزر الملف مباشرة',
              });
              setOpening(false);
              return;
            }
            const r = await openInHost(`${EXPORT_DIR}/${containerFileName(selected.title)}`);
            setResult({
              ok: r.launched,
              text: r.launched
                ? `فُتح في ${r.package}`
                : `تعذّر الفتح: ${r.reason ?? 'سبب غير معروف'}`,
            });
            setOpening(false);
          }}
        >
          <Smartphone size={13} /> {opening ? 'جارٍ الفتح…' : 'افتح في Winlator'}
        </button>
      </div>

      {result && (
        <p
          className="tiny"
          style={{ margin: '6px 0 0', color: result.ok ? 'var(--ok, #34d399)' : 'var(--danger, #f87171)' }}
          role="status"
        >
          {result.text}
        </p>
      )}

      <details className="setup-details">
        <summary className="tiny">
          <Info size={12} /> لماذا هذه القيم؟
        </summary>
        <ul className="tiny">
          {profile.rationale.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <div className="launcher-section">المتطلبات قبل أن يعمل الملف</div>
        <ul className="tiny">
          {PREREQUISITES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>

      <details className="setup-details">
        <summary className="tiny">
          <Info size={12} /> من أين تأتي المكوّنات؟
        </summary>
        <ul className="tiny">
          {SOURCES.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer noopener" dir="ltr">
                {s.name}
              </a>{' '}
              — {s.note}
              <span className="muted">
                {' '}
                · <span dir="ltr">{s.version}</span> ({s.released} · {s.assets} ملفات · تحقّقنا في{' '}
                {s.verified})
              </span>
              {daysSince(s.released) > SOURCE_STALE_DAYS && (
                <b className="tiny" style={{ color: '#fbbf24' }}>
                  {' '}
                  · إصدار قديم: تحقّق من الأحدث
                </b>
              )}
            </li>
          ))}
        </ul>
      </details>

      <details className="setup-details">
        <summary className="tiny">معاينة الملف (JSON الذي يقرأه Winlator فعلاً)</summary>
        <pre className="setup-ini" dir="ltr">
          {json}
        </pre>
      </details>

      <p className="tiny muted" style={{ marginTop: 6 }}>
        هذا الملف لا يُشغّل اللعبة داخل تطبيقنا — محرّكنا داخل المتصفح أبطأ ٧٠ مرة من العتاد. إنه
        يجعل مسارها الأصلي (Winlator) مضبوطاً من أول محاولة بدل عشر محاولات.
      </p>
    </div>
  );
}
