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
import { useMemo, useState } from 'react';
import { Cpu, Download, Gamepad2, Info, Loader2, Smartphone } from 'lucide-react';
import { CATALOG, LANE_LABEL, type CatalogEntry } from '../system/catalog';
import { containerFileName, generateProfile, PREREQUISITES, SOURCES, toContainerJson } from '../system/winePrefix';
import { sfx } from '../system/sound';

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // revoke on the next tick: Safari fails the download if the URL dies immediately
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function GameSetupApp() {
  const [selected, setSelected] = useState<CatalogEntry>(CATALOG[0]);
  const [dx9, setDx9] = useState(false);
  const [is32, setIs32] = useState(false);
  const [saving, setSaving] = useState(false);

  const profile = useMemo(
    () => generateProfile({ title: selected.title, is32, dx9 }),
    [selected, is32, dx9],
  );
  const lane = LANE_LABEL[selected.lane];
  const json = useMemo(() => toContainerJson(profile), [profile]);

  const save = () => {
    setSaving(true);
    sfx.tap();
    download(containerFileName(selected.title), json);
    window.setTimeout(() => setSaving(false), 700);
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

      <div className="setup-actions">
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? <Loader2 size={13} className="spin" /> : <Download size={13} />} نزّل ملف الحاوية
        </button>
        <button
          className="btn"
          onClick={() => {
            // the native lane lives in another app: open it rather than pretend
            const url = 'https://winlator.com';
            window.open(url, '_blank', 'noopener');
          }}
        >
          <Smartphone size={13} /> افتح صفحة Winlator
        </button>
      </div>

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
