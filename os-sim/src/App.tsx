import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, Power } from 'lucide-react';
import { useOS, WALLPAPERS } from './store/useOS';
import { setMuted, sfx } from './system/sound';
import { BootScreen } from './components/BootScreen';
import { LockScreen } from './components/LockScreen';
import { StatusBar } from './components/StatusBar';
import { Dock } from './components/Dock';
import { WindowManager } from './components/WindowManager';
import { DesktopIcons, Launcher, NotificationCenter, PowerMenu, Toasts } from './components/Desktop';
import { NovaMark } from './components/NovaMark';
import { MachineView } from './machine/MachineView';
import { useVM } from './store/useVM';
import { cx } from './system/cx';

export default function App() {
  const phase = useOS((s) => s.phase);
  const settings = useOS((s) => s.settings);
  const setViewport = useOS((s) => s.setViewport);
  const beginBoot = useOS((s) => s.beginBoot);
  const restart = useOS((s) => s.restart);

  const vmScreen = useVM((s) => s.screen);
  const [center, setCenter] = useState(false);
  const [launcher, setLauncher] = useState(false);
  const [power, setPower] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sync = () =>
      setViewport(window.innerWidth, window.innerHeight);
    sync();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, [setViewport]);

  // Start every launch from a clean session: replay the boot sequence.
  useEffect(() => {
    beginBoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setMuted(!settings.sounds);
    document.documentElement.style.setProperty('--accent', settings.accent);
    document.documentElement.style.setProperty(
      '--accent-soft',
      hexToRgba(settings.accent, 0.18),
    );
    document.documentElement.style.setProperty(
      '--accent-glow',
      hexToRgba(settings.accent, 0.42),
    );
  }, [settings.accent, settings.sounds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCenter(false);
        setLauncher(false);
        setPower(false);
      }
      if (e.key === 'F2' && phase === 'desktop') setLauncher((v) => !v);
      if (e.key === 'F5' && phase === 'desktop' && vmScreen !== 'machine') {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, restart, vmScreen]);

  const wp = WALLPAPERS.find((w) => w.id === settings.wallpaper) ?? WALLPAPERS[0];

  return (
    <div
      ref={shellRef}
      className={cx(
        'os',
        settings.theme === 'light' && 'theme-light',
        settings.reducemotion && 'no-motion',
      )}
      style={{ ['--accent' as string]: settings.accent }}
    >
      <div className="wallpaper" style={{ background: wp.css }} />

      {phase === 'boot' && <BootScreen />}

      {(phase === 'lock' || phase === 'desktop') && (
        <>
          <StatusBar onOpenCenter={() => setCenter((v) => !v)} />

          {phase === 'desktop' && (
            <>
              <div className="desktop">
                <DesktopIcons />
              </div>
              <WindowManager />

              <Dock />

              <button
                className="lock-action"
                aria-label="كل التطبيقات"
                onClick={() => {
                  sfx.tap();
                  setLauncher((v) => !v);
                }}
                style={{
                  position: 'absolute',
                  insetInlineStart: 14,
                  bottom: 22,
                  zIndex: 850,
                  background: 'var(--panel)',
                  backdropFilter: 'blur(var(--blur))',
                }}
              >
                <LayoutGrid />
              </button>

              <button
                className="lock-action"
                aria-label="قائمة الطاقة"
                onClick={() => setPower((v) => !v)}
                style={{
                  position: 'absolute',
                  insetInlineEnd: 14,
                  bottom: 22,
                  zIndex: 850,
                  background: 'var(--panel)',
                  backdropFilter: 'blur(var(--blur))',
                }}
              >
                <Power />
              </button>

              {launcher && <Launcher onClose={() => setLauncher(false)} />}
              {power && <PowerMenu onClose={() => setPower(false)} />}
            </>
          )}

          {center && <NotificationCenter onClose={() => setCenter(false)} />}

          {phase === 'lock' && <LockScreen />}
        </>
      )}

      {phase === 'desktop' && vmScreen === 'machine' && (
        <div className="machine-shell">
          <MachineView />
        </div>
      )}

      {phase === 'shutdown' && <ShutdownScreen />}

      <Toasts />
    </div>
  );
}

function ShutdownScreen() {
  const restart = useOS((s) => s.restart);
  return (
    <div className="shutdown">
      <div style={{ opacity: 0.9 }}>
        <NovaMark className="shutdown-mark" />
      </div>
      <p>إيقاف تشغيل NovaOS…</p>
      <div className="spinner" />
      <button className="btn" style={{ marginTop: 10 }} onClick={() => restart()}>
        تشغيل الجهاز
      </button>
    </div>
  );
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
