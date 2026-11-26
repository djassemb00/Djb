import { Bell, Bluetooth, Moon, Wifi } from 'lucide-react';
import { useOS } from '../store/useOS';
import { formatTime, useNow } from '../system/hooks';
import { cx } from '../system/cx';

export function StatusBar({ onOpenCenter }: { onOpenCenter: () => void }) {
  const now = useNow();
  const showSeconds = useOS((s) => s.settings.showSeconds);
  const quick = useOS((s) => s.quick);
  const unread = useOS((s) => s.notifications.filter((n) => !n.read).length);

  return (
    <div className="statusbar">
      <div className="sb-side">
        <span className="sb-clock">{formatTime(now, showSeconds)}</span>
        <button
          onClick={onOpenCenter}
          aria-label="مركز التحكم"
          style={{ background: 'none', border: 'none', color: 'inherit', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0, position: 'relative' }}
        >
          <Bell />
          {unread > 0 && (
            <i
              style={{
                position: 'absolute',
                top: -2,
                insetInlineEnd: -3,
                width: 6,
                height: 6,
                borderRadius: 99,
                background: 'var(--accent)',
              }}
            />
          )}
        </button>
      </div>

      <div className="sb-side">
        <span className={cx('chip', 'tiny')} style={{ border: 'none', background: 'transparent', padding: 0 }}>
          NovaOS 1.0
        </span>
        {quick.dnd && <Moon />}
        {quick.bluetooth && <Bluetooth />}
        <Wifi style={{ opacity: quick.wifi ? 1 : 0.3 }} />
        <div className="sb-battery">
          <span style={{ fontSize: 10.5 }}>87</span>
          <div className="battery-shell">
            <div className="battery-fill" style={{ width: '87%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
