import { useEffect, useRef, useState } from 'react';
import { Power, RefreshCw, Search, Moon, Lock, BellOff, Wifi, Bluetooth, X, PackagePlus } from 'lucide-react';
import { APPS, APP_BY_ID } from '../system/apps';
import { useOS } from '../store/useOS';
import { AppIcon } from './AppIcon';
import { cx } from '../system/cx';
import { relativeTime } from '../system/hooks';
import { sfx } from '../system/sound';
import { ProgramIcon } from './ProgramIcon';
import { usePrograms, type InstalledProgram } from '../store/usePrograms';
import { useVM } from '../store/useVM';

/**
 * Launch an installed computer program the way a phone launches an app: the icon
 * press is the whole interaction. The disk is read from IndexedDB, handed to the
 * machine and the screen switches to the running program.
 */
export function useLaunchProgram() {
  const diskOf = usePrograms((s) => s.diskOf);
  const bump = usePrograms((s) => s.bumpLaunch);
  const markBroken = usePrograms((s) => s.markBroken);
  const launchDisk = useVM((s) => s.launchProgram);
  const [busyId, setBusyId] = useState<string | null>(null);

  const launch = async (p: InstalledProgram) => {
    setBusyId(p.id);
    try {
      const disk = await diskOf(p.id);
      if (!disk) {
        markBroken(p.id);
        return;
      }
      bump(p.id);
      sfx.open();
      launchDisk({ name: p.name, disk });
    } finally {
      setBusyId(null);
    }
  };

  return { launch, busyId };
}

export function DesktopIcons() {
  const grid = useOS((s) => s.settings.grid);
  const open = useOS((s) => s.open);
  const sounds = useOS((s) => s.settings.sounds);
  const programs = usePrograms((s) => s.programs);
  const { launch, busyId } = useLaunchProgram();

  return (
    <div className={cx('icon-grid')} style={grid ? undefined : { display: 'flex', flexWrap: 'wrap', width: '100%', maxWidth: 460 }}>
      {programs.map((p) => (
        <button
          key={p.id}
          className={cx('desk-icon', busyId === p.id && 'busy')}
          onClick={() => void launch(p)}
          title={`${p.fileName} · ${(p.size / 1024).toFixed(0)} كيلو`}
        >
          <ProgramIcon program={p} />
          <span>{p.name}</span>
        </button>
      ))}
      <GetAppsTile />
      {APPS.filter((a) => a.desktop).map((app) => (
        <button
          key={app.id}
          className="desk-icon"
          onClick={() => {
            if (sounds) sfx.open();
            open({ appId: app.id, width: app.width, height: app.height });
          }}
        >
          <AppIcon app={app} />
          <span>{app.name}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The "store" tile a phone user expects on the home screen. Pressing it opens the
 * app that installs computer programs — the whole path is three taps from a cold
 * start: store tile → pick a .com/.exe → press its new icon.
 */
function GetAppsTile() {
  const open = useOS((s) => s.open);
  const programs = usePrograms((s) => s.programs);
  return (
    <button
      className="desk-icon"
      onClick={() => {
        sfx.tap();
        open({ appId: 'apps', width: 720, height: 540 });
      }}
      title="ثبّت برامج حاسوب على هاتفك"
    >
      <div className="app-tile get-apps">
        <PackagePlus size={23} />
      </div>
      <span>{programs.length ? 'إضافة برنامج' : 'متجر البرامج'}</span>
    </button>
  );
}

export function Launcher({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const open = useOS((s) => s.open);
  const programs = usePrograms((s) => s.programs);
  const { launch, busyId } = useLaunchProgram();
  const installed = programs.filter(
    (p) => !q.trim() || p.name.toUpperCase().includes(q.trim().toUpperCase()) || p.fileName.includes(q.trim()),
  );
  const filtered = APPS.filter(
    (a) => a.name.includes(q.trim()) || a.desc.includes(q.trim()) || a.id.includes(q.trim().toLowerCase()),
  );

  return (
    <div className="launcher" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-box">
        <Search />
        <input
          autoFocus
          placeholder="ابحث عن تطبيق…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filtered[0]) {
              open({ appId: filtered[0].id, width: filtered[0].width, height: filtered[0].height });
              onClose();
            }
          }}
        />
        {q && (
          <button className="btn ghost" style={{ padding: 2 }} onClick={() => setQ('')}>
            <X size={13} />
          </button>
        )}
      </div>

      {installed.length > 0 && (
        <>
          <div className="launcher-section">برامج الحاسوب المثبّتة</div>
          <div className="launcher-grid">
            {installed.map((p) => (
              <button
                key={p.id}
                className={cx('launcher-app', busyId === p.id && 'busy')}
                onClick={() => {
                  void launch(p);
                  onClose();
                }}
              >
                <ProgramIcon program={p} size="lg" />
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="launcher-section">كل التطبيقات</div>
      <div className="launcher-grid">
        {filtered.map((app) => (
          <button
            key={app.id}
            className="launcher-app"
            onClick={() => {
              sfx.open();
              open({ appId: app.id, width: app.width, height: app.height });
              onClose();
            }}
          >
            <AppIcon app={app} size="lg" />
            {app.name}
          </button>
        ))}
      </div>
      {filtered.length === 0 && <div className="empty">لا نتائج</div>}
    </div>
  );
}

export function NotificationCenter({ onClose }: { onClose: () => void }) {
  const notifications = useOS((s) => s.notifications);
  const clear = useOS((s) => s.clearNotifications);
  const quick = useOS((s) => s.quick);
  const toggleQuick = useOS((s) => s.toggleQuick);
  const patch = useOS((s) => s.patchSettings);
  const user = useOS((s) => s.settings.user);
  const windows = useOS((s) => s.windows);

  const btns = [
    { key: 'wifi' as const, label: 'Wi‑Fi', icon: Wifi },
    { key: 'bluetooth' as const, label: 'Bluetooth', icon: Bluetooth },
    { key: 'dnd' as const, label: 'صامت', icon: Moon },
    { key: 'sounds' as const, label: 'الصوت', icon: BellOff },
  ];

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <div className="nc">
        <div className="row between" style={{ padding: '0 2px' }}>
          <span className="row" style={{ gap: 7 }}>
            <span className="avatar sm">{user.slice(0, 1).toUpperCase()}</span>
            <span style={{ fontSize: 12.5, fontWeight: 650 }}>{user}</span>
          </span>
          <span className="tiny muted">جلسة NovaOS</span>
        </div>

        <div className="quick-grid">
          {btns.map((b) => {
            const Icon = b.icon;
            const on = quick[b.key];
            return (
              <button
                key={b.key}
                className={cx('quick-btn', on && 'on')}
                onClick={() => {
                  toggleQuick(b.key);
                  if (b.key === 'sounds') patch({ sounds: !quick.sounds });
                  sfx.tap();
                }}
              >
                <Icon />
                {b.label}
              </button>
            );
          })}
        </div>

        <div className="row between" style={{ padding: '2px 2px 0' }}>
          <span style={{ fontSize: 11.5, fontWeight: 650 }}>الإشعارات</span>
          <button className="btn ghost" style={{ fontSize: 10.5, padding: '3px 7px' }} onClick={clear}>
            مسح الكل
          </button>
        </div>

        {notifications.length === 0 ? (
          <div className="empty" style={{ padding: '18px 0' }}>
            لا إشعارات
          </div>
        ) : (
          notifications.slice(0, 8).map((n) => (
            <div className="notif" key={n.id}>
              <div
                className="app-tile sm"
                style={{ background: 'linear-gradient(150deg,#5b8cff,#233a72)' }}
              >
                <BellOff size={15} />
              </div>
              <div className="n-body">
                <b>{n.title}</b>
                <p>{n.body}</p>
              </div>
              <time>{relativeTime(n.at)}</time>
            </div>
          ))
        )}

        <div className="tiny muted" style={{ textAlign: 'center', padding: '2px 0 4px' }}>
          {windows.length} نافذة نشطة · NovaOS 1.0
        </div>
      </div>
    </>
  );
}

export function PowerMenu({ onClose }: { onClose: () => void }) {
  const lock = useOS((s) => s.lock);
  const shutdown = useOS((s) => s.shutdown);
  const restart = useOS((s) => s.restart);
  const items = [
    { label: 'قفل الشاشة', icon: Lock, run: lock },
    { label: 'إعادة التشغيل', icon: RefreshCw, run: restart },
    { label: 'إيقاف التشغيل', icon: Power, run: shutdown },
  ];
  return (
    <>
      <div className="sheet-scrim" onClick={onClose} style={{ background: 'transparent' }} />
      <div className="power-menu">
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.label}
              onClick={() => {
                onClose();
                it.run();
              }}
            >
              <Icon />
              {it.label}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function Toasts() {
  const notifications = useOS((s) => s.notifications);
  const dnd = useOS((s) => s.quick.dnd);
  const [visible, setVisible] = useState<string[]>([]);
  const seen = useRef<Set<string>>(new Set(notifications.map((n) => n.id)));

  useEffect(() => {
    const arrivals = notifications.filter((n) => !seen.current.has(n.id));
    if (arrivals.length === 0) return;
    arrivals.forEach((n) => seen.current.add(n.id));
    setVisible((v) => [...arrivals.map((n) => n.id), ...v].slice(0, 3));
    const timers = arrivals.map((n) =>
      window.setTimeout(() => setVisible((v) => v.filter((id) => id !== n.id)), 4600),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [notifications]);

  if (dnd) return null;
  const items = notifications.filter((n) => visible.includes(n.id));

  return (
    <div className="toast-stack">
      {items.map((n) => {
        const app = n.app !== 'system' ? APP_BY_ID[n.app] : null;
        return (
          <div className="toast" key={n.id}>
            {app ? (
              <AppIcon app={app} size="sm" />
            ) : (
              <div className="app-tile sm" style={{ background: 'linear-gradient(150deg,#5b8cff,#233a72)' }}>
                <BellOff size={15} />
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <b>{n.title}</b>
              <p>{n.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
