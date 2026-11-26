import { useRef, useState } from 'react';
import { ArrowLeft, Battery, Bell, Fingerprint, Moon, Wifi } from 'lucide-react';
import { useOS } from '../store/useOS';
import { formatDate, formatTime, relativeTime, useNow } from '../system/hooks';
import { sfx } from '../system/sound';
import { cx } from '../system/cx';

export function LockScreen() {
  const unlock = useOS((s) => s.unlock);
  const user = useOS((s) => s.settings.user);
  const showSeconds = useOS((s) => s.settings.showSeconds);
  const notifications = useOS((s) => s.notifications);
  const quick = useOS((s) => s.quick);
  const toggleQuick = useOS((s) => s.toggleQuick);
  const now = useNow();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState(0);
  const dragging = useRef(false);

  const doUnlock = () => {
    sfx.unlock();
    unlock();
  };

  const maxDrag = () => {
    const el = trackRef.current;
    return el ? Math.max(40, el.clientWidth - 54) : 240;
  };

  const start = () => {
    dragging.current = true;
    const move = (x: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const rtl = getComputedStyle(el).direction === 'rtl';
      const delta = rtl ? rect.right - x : x - rect.left;
      const d = Math.min(maxDrag(), Math.max(0, delta - 27));
      setDrag(d);
      if (d >= maxDrag() - 6) {
        cleanup();
        doUnlock();
      }
    };
    const onMove = (e: PointerEvent) => move(e.clientX);
    const onUp = () => {
      setDrag(0);
      cleanup();
    };
    const cleanup = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const unread = notifications.filter((n) => !n.read).slice(0, 2);

  return (
    <div className="lock">
      <div className="lock-clock">
        <div className="lock-time">{formatTime(now, showSeconds)}</div>
        <div className="lock-date">{formatDate(now)}</div>

        <div className="lock-widgets">
          <div className="lock-widget">
            <div className="row" style={{ gap: 5 }}>
              <Wifi size={11} />
              الشبكة
            </div>
            <b>{quick.wifi ? 'Nova‑5G' : 'غير متصل'}</b>
          </div>
          <div className="lock-widget">
            <div className="row" style={{ gap: 5 }}>
              <Battery size={11} />
              البطارية
            </div>
            <b>87% · تشحن</b>
          </div>
          <div className="lock-widget">
            <div className="row" style={{ gap: 5 }}>
              <Bell size={11} />
              الإشعارات
            </div>
            <b>{notifications.filter((n) => !n.read).length} جديدة</b>
          </div>
        </div>
      </div>

      <div className="lock-bottom">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div className="avatar">{user.slice(0, 1).toUpperCase()}</div>
        </div>

        {unread.length > 0 && (
          <div className="lock-notif">
            {unread.map((n) => (
              <div key={n.id} className="notif">
                <div className="app-tile sm" style={{ background: 'linear-gradient(150deg,#5b8cff,#243a7a)' }}>
                  <Bell size={16} />
                </div>
                <div className="n-body">
                  <b>{n.title}</b>
                  <p>{n.body}</p>
                </div>
                <time>{relativeTime(n.at)}</time>
              </div>
            ))}
          </div>
        )}

        <div
          className="slide-track"
          ref={trackRef}
          onPointerDown={start}
          role="button"
          aria-label="اسحب لفتح القفل"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') doUnlock();
          }}
        >
          <div className="slide-knob" style={{ transform: `translateX(${-drag}px)` }}>
            <ArrowLeft />
          </div>
          <span className="slide-label" style={{ opacity: drag > 10 ? 0.2 : 1 }}>
            اسحب لفتح القفل
          </span>
        </div>

        <div className="lock-actions">
          <button
            className={cx('lock-action')}
            onClick={() => {
              toggleQuick('dnd');
              sfx.tap();
            }}
            title="عدم الإزعاج"
            style={quick.dnd ? { background: 'var(--accent)', borderColor: 'transparent', color: '#fff' } : undefined}
          >
            <Moon />
          </button>
          <button className="lock-action" onClick={doUnlock} title="فتح بالبصمة">
            <Fingerprint />
          </button>
          <button className="lock-action" onClick={doUnlock} title="إلغاء القفل">
            <ArrowLeft />
          </button>
        </div>

        <div className="lock-hint">
          <span>NovaOS · بصمة أو سحب للفتح</span>
        </div>
      </div>
    </div>
  );
}
