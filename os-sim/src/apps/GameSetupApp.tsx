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
import { Check, Cpu, Download, Gamepad2, Info, Loader2, Smartphone } from 'lucide-react';
import { CATALOG, LANE_LABEL, type CatalogEntry } from '../system/catalog';
import {
  containerFileName,
  daysSince,
  generateProfile,
  PREREQUISITES,
  SOURCE_STALE_DAYS,
  SOURCES,
  reasonsFor,
  toContainerJson,
} from '../system/winePrefix';
import { sfx } from '../system/sound';
import { EXPORT_DIR, describeExport, exportContainer, realExportDeps } from '../system/containerExport';
import { CONTAINER_GB, STATE_LABEL, evaluateRoute, type Answers } from '../system/routeStatus';
import { detectHost, judgeShare, openInHost, takeSharedFile } from '../system/nativeLaunch';
import { storageStatus } from '../system/diskStore';
import { buildProfile, containerFromProfile, parseProfile } from '../system/profileSchema';
import { saveProfile } from '../system/profileStore';
import { SYNC_DEFAULT, describeSync, pullProfiles } from '../system/profileSync';


export function GameSetupApp() {
  const [selected, setSelected] = useState<CatalogEntry>(CATALOG[0]);
  const [dx9, setDx9] = useState(false);
  const [is32, setIs32] = useState(false);
  const [saving, setSaving] = useState(false);
  /** what actually happened to the last export, in the user's words */
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * PLAN ٣-٣ + ٣-١. What happened to the local save, and what the schema said about a
   * pasted file. Both start as "not asked" (`null`), because rendering "محفوظ" or
   * "مقبول" before anything happened is the class of lie this repo exists to remove.
   */
  const [saveState, setSaveState] = useState<{ stored: boolean; text: string } | null>(null);
  const [importText, setImportText] = useState('');
  const [importState, setImportState] = useState<{ ok: boolean; text: string } | null>(null);
  /**
   * PLAN ٣-٤. Sync starts at SYNC_DEFAULT, which is `{ enabled: false }` -- not a state
   * this component decides. The toggle only ever changes `enabled`; the endpoint and key
   * are never stored, because a key on disk is a key in the next backup.
   */
  const [syncOn, setSyncOn] = useState(SYNC_DEFAULT.enabled);
  const [syncText, setSyncText] = useState<string | null>(null);
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
  /*
   * PLAN ٣-١: the same container, expressed as a validated profile document. This is what
   * gets stored (٣-٣) and what another device imports (٣-٥). It is built through the
   * schema rather than assembled by hand, so a container that carries a key Winlator
   * ignores cannot reach storage or the clipboard.
   */
  const doc = useMemo(
    () =>
      buildProfile({
        id: selected.id,
        title: selected.title,
        sizeGB: selected.sizeGB,
        soc: 'sd8gen1',
        gpu: 'adreno730',
        ramGB: 8,
        container: JSON.parse(json) as Record<string, unknown>,
        author: 'nova',
        created: new Date().toISOString().slice(0, 10),
        verifiedOnDevice: false, // we have never run this on a device; see AUDIT.md
      }),
    [json, selected],
  );

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

    /*
     * PLAN ٣-٣: also keep the profile on the device, so the same settings are here after
     * a restart with no network. The two outcomes are reported separately on purpose:
     * the file can be written while the local copy fails (private mode), and saying
     * "تم" for both would hide that.
     */
    /*
     * One source for the tick and the sentence.
     *
     * The first version built `stored` and `text` separately (stored came from the store,
     * the sentence from a ternary on the same field). Mutating only `stored` turned the
     * line green while it still read "لم يُحفظ" -- a green tick over a failure sentence,
     * which is the exact defect class this repo exists to remove. The verdict is now
     * derived once, so colour and words cannot disagree.
     */
    let verdict: { stored: boolean; text: string };
    if (doc.ok) {
      const saved = await saveProfile(doc.profile);
      verdict = saved.stored
        ? { stored: true, text: `محفوظ على الجهاز باسم ${doc.profile.game.id} — يبقى بعد إعادة التشغيل` }
        : { stored: false, text: saved.reason || 'لم يُحفظ: سبب غير معروف' };
    } else {
      verdict = {
        stored: false,
        text: `لم يُحفظ: الملف المولَّد لم يجتز المخطط — ${doc.issues.map((i) => i.message).join(' · ')}`,
      };
    }
    setSaveState(verdict);
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

      {/*
        PLAN ٣-٣. The local copy's outcome, stated separately from the file export.
        A profile that could not be stored (private mode, full disk) must not inherit the
        green tick of a file that was written successfully.
      */}
      {saveState && (
        <p
          className="tiny"
          role="status"
          style={{ margin: '6px 0 0', color: saveState.stored ? 'var(--ok, #34d399)' : 'var(--danger, #f87171)' }}
        >
          {saveState.text}
        </p>
      )}

      {/*
        PLAN ٣-٤. The switch is visible and its state is stated in words, because
        "المزامنة معطّلة" is a privacy claim the user is entitled to read, not infer from
        an unlit toggle.
      */}
      <details className="setup-details">
        <summary className="tiny">المزامنة (معطّلة افتراضياً)</summary>
        <div className="row between" style={{ marginTop: 6, gap: 8 }}>
          <span className="tiny">
            {syncOn ? 'مفعّلة — تخرج إعداداتك إلى خادمك أنت' : 'معطّلة — لا يخرج شيء من الجهاز'}
          </span>
          <button
            className="btn"
            onClick={() => {
              sfx.tap();
              setSyncOn((v) => !v);
              setSyncText(null);
            }}
          >
            {syncOn ? 'أوقف' : 'فعّل'}
          </button>
        </div>
        {syncOn && (
          <p className="tiny muted" style={{ margin: '6px 0 0' }}>
            لا خادم مُهيّأ في هذا البناء: العنوان والمفتاح يأتيان من إعداداتك، ولا يُكتب أي
            منهما على القرص. لذلك سيقول السحب إنه غير مُهيّأ بدل أن يتصل بجهة نخمّنها.
          </p>
        )}
        <div className="setup-actions" style={{ marginTop: 6 }}>
          <button
            className="btn"
            onClick={async () => {
              sfx.tap();
              const r = await pullProfiles({ enabled: syncOn });
              setSyncText(describeSync(r));
            }}
          >
            اسحب الآن
          </button>
        </div>
        {syncText && (
          <p className="tiny" role="status" style={{ margin: '6px 0 0' }}>
            {syncText}
          </p>
        )}
      </details>

      {/*
        PLAN ٣-١/٣-٥. Import a profile from another device. The box takes a pasted file
        because a WebView cannot read the clipboard or a picked file without a native
        plugin we have not built; pasting is honest about what works today. Validation is
        the schema's, and every refusal names the field.
      */}
      <details className="setup-details">
        <summary className="tiny">استيراد إعداد من جهاز آخر</summary>
        <textarea
          value={importText}
          onChange={(e) => {
            setImportText(e.target.value);
            setImportState(null);
          }}
          placeholder='الصق محتوى ملف .profile.json هنا'
          rows={4}
          style={{ width: '100%', marginTop: 6, fontSize: 11, fontFamily: 'monospace' }}
          aria-label="محتوى ملف الإعداد"
        />
        <div className="setup-actions" style={{ marginTop: 6 }}>
          <button
            className="btn"
            disabled={!importText.trim()}
            onClick={() => {
              sfx.tap();
              let raw: unknown;
              try {
                raw = JSON.parse(importText);
              } catch {
                setImportState({ ok: false, text: 'الملف ليس JSON صالحاً — تحقّق من نسخه كاملاً' });
                return;
              }
              const parsed = parseProfile(raw);
              if (!parsed.ok) {
                // every issue, because a file usually has more than one problem
                setImportState({
                  ok: false,
                  text: `مرفوض: ${parsed.issues.slice(0, 4).map((i) => `${i.path ? i.path + ': ' : ''}${i.message}`).join(' · ')}`,
                });
                return;
              }
              const container = containerFromProfile(parsed.profile);
              setImportState({
                ok: true,
                text: `مقبول: ${parsed.profile.game.title} — ${parsed.profile.container.screenSize ?? ''} · الحاوية ${container.length} بايت`,
              });
            }}
          >
            <Check size={13} /> تحقّق من الملف
          </button>
        </div>
        {importState && (
          <p
            className="tiny"
            role="status"
            style={{ margin: '6px 0 0', color: importState.ok ? 'var(--ok, #34d399)' : 'var(--danger, #f87171)' }}
          >
            {importState.text}
          </p>
        )}
      </details>

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
        {/*
          PLAN ٣-٦: one clickable line per written key, each naming its own source.
          The old list was six sentences for eleven keys, so four of them reached
          Winlator with nothing on this screen explaining them.
        */}
        <ul className="tiny" style={{ paddingInlineStart: 14 }}>
          {reasonsFor(profile).map((r) => (
            <li key={r.key} style={{ marginBottom: 4 }}>
              <details>
                <summary style={{ cursor: 'pointer' }}>
                  <code>{r.key}</code> = {r.value}
                </summary>
                <div className="tiny muted" style={{ margin: '2px 0 0 8px' }}>
                  {r.why}
                  <br />
                  <span style={{ opacity: 0.75 }}>المصدر: {r.source}</span>
                </div>
              </details>
            </li>
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
