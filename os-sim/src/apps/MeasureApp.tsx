/**
 * "قياساتي" — PLAN ٤-١ / ٤-٣ / ٤-٤ in one window.
 *
 * Phase 4's promise is "drop to 960x540, expect +8 frames". This window is where that
 * promise is either kept or caught: the user records what actually happened, the decision
 * table says what to try next, and after the next run the comparison states whether the
 * model was right. Nothing here is pre-filled with a sample session -- an empty state says
 * it is empty.
 */
import { useEffect, useMemo, useState } from 'react';
import { Activity, Plus, Ruler, Flame, Timer } from 'lucide-react';
import { CATALOG } from '../system/catalog';
import { advise, describeSuggestion, estimateFpsGainPct } from '../system/decide';
import {
  compareSessions,
  makeSession,
  readingOf,
  sessionsFor,
  sparkline,
  type Session,
} from '../system/sessions';
import { describeParsedRun, parseWinlatorLog } from '../system/runLog';
import { NOLOG_REASON_SHORT } from '../system/runLog';
import { sfx } from '../system/sound';
import { readGovernor, thermalSentence, type GovernorReading } from '../system/thermal';

const KEY = 'novaos-sessions';

/**
 * Sessions live in localStorage rather than IndexedDB.
 *
 * They are tiny text records (a few hundred bytes each), and localStorage is synchronous,
 * which means the panel can read them on first render without a loading state that would
 * otherwise flash "no sessions" before the real ones arrive. The disk images use
 * IndexedDB because they are megabytes; using it here would be cost without benefit.
 */
function loadSessions(): Session[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // re-validated on read: a hand-edited entry must not become a chart
    return parsed.filter(
      (s): s is Session =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as Session).gameId === 'string' &&
        typeof (s as Session).fps === 'number' &&
        typeof (s as Session).screenSize === 'string',
    );
  } catch {
    return [];
  }
}

function saveSessions(all: Session[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(KEY, JSON.stringify(all));
    return true;
  } catch {
    // quota or private mode: reported to the caller, never swallowed into "saved"
    return false;
  }
}

export function MeasureApp() {
  const [all, setAll] = useState<Session[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [gameId, setGameId] = useState(CATALOG[0].id);
  const [screenSize, setScreenSize] = useState('1280x720');
  const [fps, setFps] = useState('');
  const [tempC, setTempC] = useState('');
  const [minutes, setMinutes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [paste, setPaste] = useState('');
  /**
   * PLAN ٤-٥. The governor's own reading, sampled while this window is open. It carries no
   * temperature -- the platform has none to give -- so the sentence below states the state
   * and never a degree figure.
   */
  const [thermal, setThermal] = useState<GovernorReading | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      void readGovernor().then((r) => {
        if (alive) setThermal(r);
      });
    };
    tick();
    const id = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setAll(loadSessions());
    setLoaded(true);
  }, []);

  const mine = useMemo(() => sessionsFor(all, gameId), [all, gameId]);
  const latest = mine[0];

  /*
   * The advice comes from the newest session plus whatever the log paste revealed. Only
   * measured fields are passed: `advise` rejects a rule when its input is absent, which is
   * what keeps a missing GPU reading from becoming "0% busy, everything is fine".
   */
  const parsed = useMemo(() => parseWinlatorLog(paste), [paste]);
  const advice = useMemo(() => {
    if (!latest) return [];
    const reading = {
      ...readingOf(latest),
      ...(parsed.fps !== null ? { fps: parsed.fps } : {}),
      ...(parsed.screenSize !== null ? { screenSize: parsed.screenSize } : {}),
      ...(parsed.tempC !== null ? { tempC: parsed.tempC } : {}),
    };
    return advise(reading);
  }, [latest, parsed]);

  const comparison = useMemo(() => {
    if (mine.length < 2) return null;
    const [newest, previous] = mine;
    return compareSessions(
      previous,
      newest,
      previous.screenSize !== newest.screenSize
        ? estimateFpsGainPct(previous.screenSize, newest.screenSize)
        : null,
    );
  }, [mine]);

  const add = () => {
    sfx.tap();
    const r = makeSession({ gameId, screenSize, fps, tempC, minutes, source: 'user' });
    if (!r.ok) {
      setMsg({
        ok: false,
        text: `لم يُسجَّل: ${r.issues.map((i) => i.message).join(' · ')}`,
      });
      return;
    }
    const next = [...all, r.session];
    const stored = saveSessions(next);
    setAll(next);
    setMsg(
      stored
        ? { ok: true, text: `سُجّلت جلسة ${r.session.screenSize}: ${r.session.fps} إطاراً` }
        : // the session is in memory for this window but not on disk -- say which
          { ok: false, text: 'سُجّلت لهذه الجلسة فقط: التخزين المحلي غير متاح، فلن تبقى بعد الإغلاق' },
    );
  };

  return (
    <div className="setup-app" style={{ padding: 12 }}>
      <h3 style={{ margin: 0 }}>
        <Activity size={16} /> قياساتي
      </h3>
      <p className="tiny muted" style={{ margin: '4px 0 8px' }}>
        سجّل ما حدث فعلاً، فيقول التطبيق ماذا تجرّب بعد ذلك — ويراجع تنبؤه أمام رقمك.
      </p>

      <div className="launcher-section">اللعبة</div>
      <select
        value={gameId}
        onChange={(e) => {
          setGameId(e.target.value);
          setMsg(null);
        }}
        aria-label="اختر اللعبة"
        style={{ width: '100%', fontSize: 12, padding: 4 }}
      >
        {CATALOG.filter((g) => g.lane !== 'none').map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </select>

      <div className="launcher-section" style={{ marginTop: 8 }}>
        جلسة جديدة
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            <Ruler size={11} /> الدقة
          </span>
          <select
            value={screenSize}
            onChange={(e) => setScreenSize(e.target.value)}
            aria-label="الدقة"
            style={{ fontSize: 11, padding: 3 }}
          >
            {['1920x1080', '1600x900', '1280x720', '960x540'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            <Activity size={11} /> الإطارات
          </span>
          <input
            value={fps}
            onChange={(e) => setFps(e.target.value)}
            inputMode="decimal"
            aria-label="الإطارات"
            style={{ width: 56, fontSize: 11, padding: 3 }}
          />
        </label>
        <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            <Flame size={11} /> الحرارة
          </span>
          <input
            value={tempC}
            onChange={(e) => setTempC(e.target.value)}
            inputMode="decimal"
            aria-label="الحرارة"
            style={{ width: 56, fontSize: 11, padding: 3 }}
          />
        </label>
        <label className="tiny" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            <Timer size={11} /> الدقائق
          </span>
          <input
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            inputMode="numeric"
            aria-label="الدقائق"
            style={{ width: 56, fontSize: 11, padding: 3 }}
          />
        </label>
        <button className="btn primary" onClick={add} disabled={!fps.trim()}>
          <Plus size={12} /> سجّل
        </button>
      </div>

      {msg && (
        <p
          className="tiny"
          role="status"
          style={{ margin: '6px 0 0', color: msg.ok ? 'var(--ok, #34d399)' : 'var(--danger, #f87171)' }}
        >
          {msg.text}
        </p>
      )}

      <div className="launcher-section" style={{ marginTop: 10 }}>
        ما جرّبه التطبيق بعد ذلك
      </div>
      {!loaded ? (
        <p className="tiny muted">جارٍ القراءة…</p>
      ) : !latest ? (
        <p className="tiny muted" role="status">
          لا توجد جلسات مسجّلة لهذه اللعبة بعد — سجّل واحدة ليصير للاقتراح أساس
        </p>
      ) : advice.length === 0 ? (
        <p className="tiny muted" role="status">
          لا اقتراح: الأرقام المسجّلة لا تُفعّل أي قاعدة (الإطارات كافية أو القراءة ناقصة)
        </p>
      ) : (
        <ul className="tiny" style={{ paddingInlineStart: 14, margin: '4px 0' }}>
          {advice.map((s) => (
            <li key={s.id} style={{ marginBottom: 3 }}>
              {describeSuggestion(s)}
              <div className="tiny muted" style={{ opacity: 0.8 }}>
                المصدر: {s.source}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="launcher-section" style={{ marginTop: 10 }}>
        آخر الجلسات
      </div>
      {mine.length === 0 ? (
        <p className="tiny muted" role="status">
          فارغ — لا رسم بياني بلا بيانات
        </p>
      ) : (
        <>
          <svg
            width="100%"
            height={28}
            viewBox="0 0 100 28"
            preserveAspectRatio="none"
            aria-label="منحنى الإطارات"
            role="img"
          >
            <polyline
              points={sparkline(
                [...mine].reverse().map((s) => s.fps),
                100,
                28,
              )}
              fill="none"
              stroke="var(--accent, #5b8cff)"
              strokeWidth={1.5}
            />
          </svg>
          <ul className="tiny" style={{ paddingInlineStart: 14, margin: '2px 0' }}>
            {mine.slice(0, 6).map((s) => (
              <li key={s.id}>
                {s.date} · {s.screenSize} · {s.fps} إطاراً
                {s.tempC !== null ? ` · ${s.tempC}°` : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {comparison && (
        <p className="tiny" role="status" style={{ margin: '6px 0 0' }}>
          {comparison.verdict}
        </p>
      )}

      <div className="launcher-section" style={{ marginTop: 10 }}>
        الحرارة أثناء اللعب
      </div>
      <p className="tiny muted" role="status" style={{ margin: '2px 0' }}>
        {thermal === null ? 'جارٍ قراءة إشارات الجهاز…' : thermalSentence(thermal)}
      </p>

      <details className="setup-details" style={{ marginTop: 10 }}>
        <summary className="tiny">لصق مخرجات Winlator (اختياري)</summary>
        <p className="tiny muted" style={{ margin: '4px 0' }}>
          {NOLOG_REASON_SHORT}
        </p>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={3}
          aria-label="مخرجات Winlator"
          placeholder="الصق أي نص تراه في نافذة التصحيح"
          style={{ width: '100%', fontSize: 11, fontFamily: 'monospace' }}
        />
        <p className="tiny muted" role="status" style={{ margin: '4px 0 0' }}>
          {describeParsedRun(parsed)}
        </p>
      </details>
    </div>
  );
}
