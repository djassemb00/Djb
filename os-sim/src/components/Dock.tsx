import { APPS } from '../system/apps';
import { useOS } from '../store/useOS';
import { AppIcon } from './AppIcon';
import { sfx } from '../system/sound';

export function Dock() {
  const open = useOS((s) => s.open);
  const windows = useOS((s) => s.windows);
  const sounds = useOS((s) => s.settings.sounds);

  return (
    <div className="dock-wrap">
      <div className="dock" role="toolbar" aria-label="شريط التطبيقات">
        {APPS.filter((a) => a.dock).map((app) => {
          const isOpen = windows.some((w) => w.appId === app.id);
          return (
            <button
              key={app.id}
              className="dock-btn"
              title={app.name}
              aria-label={app.name}
              onClick={() => {
                if (sounds) sfx.open();
                open({ appId: app.id, width: app.width, height: app.height });
              }}
            >
              <AppIcon app={app} />
              {isOpen && <span className="dock-dot" />}
            </button>
          );
        })}
      </div>
      <div className="home-indicator" />
    </div>
  );
}
