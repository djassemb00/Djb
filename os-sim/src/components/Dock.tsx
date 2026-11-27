import { APPS } from '../system/apps';
import { useOS } from '../store/useOS';
import { AppIcon } from './AppIcon';
import { sfx } from '../system/sound';
import { ProgramIcon } from './ProgramIcon';
import { usePrograms } from '../store/usePrograms';
import { useLaunchProgram } from './Desktop';
import { cx } from '../system/cx';

export function Dock() {
  const open = useOS((s) => s.open);
  const windows = useOS((s) => s.windows);
  const sounds = useOS((s) => s.settings.sounds);
  const programs = usePrograms((s) => s.programs);
  const { launch, busyId } = useLaunchProgram();
  // like a phone's favourite row: the programs opened most often, newest first
  const pinned = [...programs].sort((a, b) => b.launches - a.launches || b.installedAt - a.installedAt).slice(0, 3);

  return (
    <div className="dock-wrap">
      <div className="dock" role="toolbar" aria-label="شريط التطبيقات">
        {pinned.map((p) => (
          <button
            key={p.id}
            className={cx('dock-btn', busyId === p.id && 'busy')}
            title={`${p.name} · برنامج حاسوب`}
            aria-label={p.name}
            onClick={() => void launch(p)}
          >
            <ProgramIcon program={p} />
            <span className="dock-dot" />
          </button>
        ))}
        {pinned.length > 0 && <span className="dock-sep" />}
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
