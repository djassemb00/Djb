import { useEffect, useState } from 'react';
import { useOS, bootScript, BOOT_DURATION } from '../store/useOS';
import { useBootDriver } from '../system/hooks';
import { sfx } from '../system/sound';
import { NovaMark } from './NovaMark';

export function BootScreen() {
  const progress = useOS((s) => s.bootProgress);
  const lines = useOS((s) => s.bootLines);
  const setProgress = useOS((s) => s.setBootProgress);
  const pushLine = useOS((s) => s.pushBootLine);
  const finishBoot = useOS((s) => s.finishBoot);
  const [done, setDone] = useState(false);

  useBootDriver(
    !done,
    BOOT_DURATION,
    (p) => setProgress(p),
    () => {
      setDone(true);
      setProgress(1);
      sfx.boot();
      window.setTimeout(() => finishBoot(), 420);
    },
  );

  useEffect(() => {
    const timers = bootScript.map((l) =>
      window.setTimeout(() => pushLine(l.text), Math.max(120, l.at * BOOT_DURATION)),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [pushLine]);

  const skip = () => {
    setDone(true);
    finishBoot();
  };

  return (
    <div className="boot">
      <button className="boot-skip" onClick={skip}>
        تخطّي الإقلاع ›
      </button>
      <div className="boot-logo">
        <NovaMark />
      </div>
      <div className="boot-title">NOVA OS</div>
      <div className="boot-sub">الإصدار 1.0.0 · نواة nova-core</div>
      <div className="boot-bar">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="boot-sub os-mono">{Math.round(progress * 100)}%</div>
      <div className="boot-log">
        {lines.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </div>
  );
}
