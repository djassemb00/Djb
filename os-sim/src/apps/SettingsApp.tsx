import { useState } from 'react';
import {
  Info,
  Palette,
  Power,
  RotateCcw,
  Server,
  Settings2,
  User,
  Volume2,
  Wifi,
} from 'lucide-react';
import { ACCENTS, useOS, WALLPAPERS } from '../store/useOS';
import { cx } from '../system/cx';
import { readNetInfo } from '../system/netInfo';
import { usePrograms } from '../store/usePrograms';
import { sfx } from '../system/sound';

type Tab = 'appearance' | 'system' | 'network' | 'about-me' | 'reset';

const TABS: { id: Tab; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'المظهر', icon: Palette },
  { id: 'system', label: 'النظام', icon: Settings2 },
  { id: 'network', label: 'الشبكة', icon: Wifi },
  { id: 'about-me', label: 'المستخدم', icon: User },
  { id: 'reset', label: 'الصيانة', icon: RotateCcw },
];

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={cx('toggle', on && 'on')}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  );
}

export function SettingsApp() {
  const settings = useOS((s) => s.settings);
  const patch = useOS((s) => s.patchSettings);
  const resetSettings = useOS((s) => s.resetSettings);
  const resetAll = useOS((s) => s.resetAll);
  const quick = useOS((s) => s.quick);
  const toggleQuick = useOS((s) => s.toggleQuick);
  const restart = useOS((s) => s.restart);
  const shutdown = useOS((s) => s.shutdown);
  // read at render time, not at module load: navigator.onLine changes while the app runs
  const net = readNetInfo();
  const programs = usePrograms((s) => s.programs);
  const wipeAll = usePrograms((s) => s.wipeAll);
  const [wiping, setWiping] = useState(false);
  const lock = useOS((s) => s.lock);
  const notify = useOS((s) => s.notify);
  const [tab, setTab] = useState<Tab>('appearance');

  return (
    <div className="app-shell">
      <div className="app-toolbar">
        <Settings2 size={14} />
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>الإعدادات</span>
      </div>
      <div className="app-split">
        <div className="app-sidebar">
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className={cx('side-item', tab === t.id && 'active')}
                onClick={() => {
                  setTab(t.id);
                  sfx.tap();
                }}
              >
                <Icon />
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="app-content" style={{ flex: 1 }}>
          {tab === 'appearance' && (
            <div className="field-list">
              <div className="section-title">السمة</div>
              <div className="field">
                <div className="f-main">
                  <span>الوضع الداكن</span>
                  <span className="tiny muted">تبديل بين الوضعين الداكن والفاتح</span>
                </div>
                <Toggle
                  on={settings.theme === 'dark'}
                  onChange={(v) => patch({ theme: v ? 'dark' : 'light' })}
                />
              </div>
              <div className="section-title">الخلفية</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(64px,1fr))', gap: 7, padding: '4px 0' }}>
                {WALLPAPERS.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => patch({ wallpaper: w.id })}
                    title={w.name}
                    style={{
                      height: 44,
                      borderRadius: 9,
                      background: w.css,
                      cursor: 'pointer',
                      border: settings.wallpaper === w.id ? '2px solid var(--accent)' : '1px solid var(--border)',
                    }}
                  />
                ))}
              </div>
              <div className="section-title">لون النظام</div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8, padding: '4px 0' }}>
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    onClick={() => patch({ accent: c })}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: c,
                      border: settings.accent === c ? '2.5px solid var(--text)' : '2px solid transparent',
                      cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === 'system' && (
            <div className="field-list">
              <div className="section-title">الواجهة</div>
              <div className="field">
                <div className="f-main">
                  <span>إظهار الثواني في الساعة</span>
                </div>
                <Toggle on={settings.showSeconds} onChange={(v) => patch({ showSeconds: v })} />
              </div>
              <div className="field">
                <div className="f-main">
                  <span>تقليل الحركة</span>
                  <span className="tiny muted">إيقاف حركات الواجهة</span>
                </div>
                <Toggle on={settings.reducemotion} onChange={(v) => patch({ reducemotion: v })} />
              </div>
              <div className="field">
                <div className="f-main">
                  <span>شبكة أيقونات سطح المكتب</span>
                </div>
                <Toggle on={settings.grid} onChange={(v) => patch({ grid: v })} />
              </div>
              <div className="section-title">الصوت</div>
              <div className="field">
                <div className="f-main row" style={{ gap: 6 }}>
                  <Volume2 size={13} />
                  <span>أصوات النظام</span>
                </div>
                <Toggle
                  on={settings.sounds}
                  onChange={(v) => {
                    patch({ sounds: v });
                    if (v) sfx.notify();
                  }}
                />
              </div>
              <div className="section-title">الطاقة</div>
              <div className="row" style={{ gap: 7, padding: '4px 0 12px', flexWrap: 'wrap' }}>
                <button className="btn" onClick={lock}>
                  <Power /> قفل الجهاز
                </button>
                <button className="btn" onClick={() => restart()}>
                  <RotateCcw /> إعادة تشغيل
                </button>
                <button className="btn danger" onClick={shutdown}>
                  <Power /> إيقاف التشغيل
                </button>
              </div>
            </div>
          )}

          {tab === 'network' && (
            <div className="field-list">
              <div className="section-title">الاتصال</div>
              {[
                /*
                 * These two used to name a network that does not exist ("Nova‑5G ·
                 * إشارة قوية") and a Bluetooth state we cannot query. A web app can see
                 * neither the SSID nor the paired-device list; it can only draw a switch.
                 * So the label stays and the detail tells the truth about its reach.
                 */
                {
                  key: 'wifi' as const,
                  label: 'Wi‑Fi',
                  detail: net.online
                    ? 'مفتاح هذا النظام فقط — التطبيق لا يرى اسم الشبكة'
                    : 'الهاتف غير متصل — لا شيء يعمل عبر الشبكة',
                  icon: Wifi,
                },
                {
                  key: 'bluetooth' as const,
                  label: 'Bluetooth',
                  detail: 'تزيين سطح المكتب — لا يتحكم براديو الهاتف',
                  icon: Server,
                },
                { key: 'dnd' as const, label: 'عدم الإزعاج', detail: 'كتم الإشعارات الفورية', icon: Volume2 },
                { key: 'sounds' as const, label: 'أصوات النظام', detail: 'مؤثرات عند التفاعل', icon: Volume2 },
              ].map((row) => {
                const Icon = row.icon;
                return (
                  <div className="field" key={row.key}>
                    <div className="f-main">
                      <span className="row" style={{ gap: 6 }}>
                        <Icon size={13} />
                        {row.label}
                      </span>
                      <span className="tiny muted">{row.detail}</span>
                    </div>
                    <Toggle
                      on={quick[row.key]}
                      onChange={() => {
                        toggleQuick(row.key);
                        if (row.key === 'sounds') patch({ sounds: !quick.sounds });
                        sfx.tap();
                      }}
                    />
                  </div>
                );
              })}
              {/*
                These three used to be literal strings: MAC A4:7B:09:1C:EE:22, IP
                192.168.1.42, "سرعة التنزيل 184.2 Mbps". None of them was ever read
                from anywhere -- they were invented constants shown in the same mono
                font as real measurements, which is indistinguishable from telemetry
                that lies. A browser cannot read the MAC address at all, so the honest
                screen says what we can and cannot see.
              */}
              <div className="card" style={{ marginTop: 12 }}>
                <div className="row between">
                  <span className="tiny muted">نوع الاتصال</span>
                  <span className="tiny os-mono">
                    {net.online ? (net.type || 'متصل') : 'غير متصل'}
                    {net.effective ? ` · ${net.effective}` : ''}
                  </span>
                </div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="tiny muted">حالة الشبكة</span>
                  <span className="tiny os-mono">{net.online ? 'متصلة' : 'منقطعة'}</span>
                </div>
                <div className="row between" style={{ marginTop: 6 }}>
                  <span className="tiny muted">عنوان MAC · IP محلي</span>
                  <span className="tiny os-mono">لا يمكن للتطبيق قراءتها</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 8, lineHeight: 1.6 }}>
                  المتصفح لا يمنح أي تطبيق ويب عنوان MAC ولا عنوان IP المحلي؛ في أندرويد
                  تحتاج قراءتها إلى صلاحية الشبكة أو Shizuku/root. لا نعرض أرقاماً ملفّقة.
                </p>
              </div>
            </div>
          )}

          {tab === 'about-me' && (
            <div className="field-list">
              <div className="about-hero" style={{ paddingTop: 8 }}>
                <div className="avatar">{settings.user.slice(0, 1).toUpperCase()}</div>
                <b style={{ fontSize: 14 }}>{settings.user}</b>
                <span className="tiny muted">حساب محلي · مسؤول الجهاز</span>
              </div>
              <div className="section-title">اسم المستخدم</div>
              <input
                className="input"
                value={settings.user}
                onChange={(e) => patch({ user: e.target.value.replace(/\s/g, '') || 'user' })}
              />
              <div className="section-title">معلومات الحساب</div>
              <div className="card">
                <div className="spec-row">
                  <span>المجلد الرئيسي</span>
                  <span className="os-mono">/home/{settings.user}</span>
                </div>
                <div className="spec-row">
                  <span>الصلاحيات</span>
                  <span>مسؤول</span>
                </div>
                <div className="spec-row">
                  <span>الجلسة</span>
                  <span>nova-session</span>
                </div>
              </div>
            </div>
          )}

          {tab === 'reset' && (
            <div className="field-list">
              <div className="section-title">الصيانة</div>
              <div className="card">
                <b style={{ fontSize: 12.5 }}>إعادة تعيين الإعدادات</b>
                <p className="tiny muted" style={{ margin: '4px 0 9px' }}>
                  يعيد السمة والخلفية والألوان إلى الافتراضي دون حذف الملفات.
                </p>
                <button
                  className="btn"
                  onClick={() => {
                    resetSettings();
                    notify({ app: 'settings', title: 'الإعدادات', body: 'أُعيد ضبط المظهر إلى الافتراضي' });
                  }}
                >
                  <RotateCcw /> استعادة الافتراضي
                </button>
              </div>
              <div className="card" style={{ marginTop: 10 }}>
                <b style={{ fontSize: 12.5 }}>مسح كل البيانات</b>
                {/*
                  This card said "مسح كل البيانات" and its own fine print admitted it only
                  touched the virtual FS, the notes and the notifications -- while the
                  largest objects in the app, the installed program disks, sat untouched in
                  IndexedDB. The button now wipes them, and the list below names every
                  item so the heading cannot over-claim again.
                */}
                <p className="tiny muted" style={{ margin: '4px 0 6px' }}>
                  يحذف: نظام الملفات المحاكى · الملاحظات · الإشعارات · الإعدادات ·{' '}
                  <b>{programs.length}</b> برنامجاً مثبَّتاً وكل قرص محفوظ لها. لا يمكن التراجع.
                </p>
                <p className="tiny muted" style={{ margin: '0 0 9px', lineHeight: 1.6 }}>
                  يبقى كما هو: ملفات البرامج التي اخترتها من هاتفك (نقرأها ولا نمسحها) ·
                  وسجل الحاويات في تطبيق «إعداد لعبة» المحفوظ عندك.
                </p>
                <button
                  className="btn danger"
                  disabled={wiping}
                  onClick={async () => {
                    if (!window.confirm('مسح كل بيانات NovaOS، بما فيها البرامج المثبَّتة؟')) return;
                    setWiping(true);
                    const freed = await wipeAll();
                    resetAll();
                    setWiping(false);
                    notify({
                      app: 'settings',
                      title: 'مُسح كل شيء',
                      body: `أُزيل ${freed} قرصاً محفوظاً، ونظام الملفات والملاحظات والإعدادات`,
                    });
                  }}
                >
                  <RotateCcw /> {wiping ? 'جارٍ المسح…' : 'مسح شامل'}
                </button>
              </div>
              <div className="row" style={{ gap: 7, marginTop: 12 }}>
                <Info size={13} className="muted" />
                <span className="tiny muted">NovaOS 1.0.0 · build 2026.11 · nova-core</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
