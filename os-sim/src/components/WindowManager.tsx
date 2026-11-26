import { useRef } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import { useOS, type Win } from '../store/useOS';
import { APP_BY_ID } from '../system/apps';
import { cx } from '../system/cx';
import { AppRenderer } from '../apps/AppRenderer';
import { sfx } from '../system/sound';

function TitleBar({ win }: { win: Win }) {
  const app = APP_BY_ID[win.appId];
  const focusWin = useOS((s) => s.focusWin);
  const close = useOS((s) => s.close);
  const toggleMin = useOS((s) => s.toggleMin);
  const toggleMax = useOS((s) => s.toggleMax);
  const moveWin = useOS((s) => s.moveWin);
  const viewport = useOS((s) => s.viewport);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (win.max) return;
    focusWin(win.id);
    drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
    const move = (ev: PointerEvent) => {
      if (!drag.current) return;
      const x = Math.round(
        Math.min(Math.max(-win.w + 90, ev.clientX - drag.current.dx), viewport.w - 90),
      );
      const y = Math.round(Math.min(Math.max(34, ev.clientY - drag.current.dy), viewport.h - 70));
      moveWin(win.id, x, y);
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="titlebar" onPointerDown={onPointerDown} onDoubleClick={() => toggleMax(win.id)}>
      <div className="t-dots">
        <button
          className="tdot close"
          aria-label="إغلاق"
          onClick={() => {
            sfx.close();
            close(win.id);
          }}
        >
          <X />
        </button>
        <button className="tdot min" aria-label="تصغير" onClick={() => toggleMin(win.id)}>
          <Minus />
        </button>
        <button
          className="tdot max"
          aria-label="تكبير"
          onClick={() => {
            focusWin(win.id);
            toggleMax(win.id);
          }}
        >
          <Plus />
        </button>
      </div>
      <div className="t-title">{app?.name ?? 'نافذة'}</div>
    </div>
  );
}

function ResizeHandle({ win }: { win: Win }) {
  const resizeWin = useOS((s) => s.resizeWin);
  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = win.w;
    const h0 = win.h;
    const move = (ev: PointerEvent) => {
      resizeWin(win.id, w0 + (sx - ev.clientX), h0 + (ev.clientY - sy));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="resize-handle" onPointerDown={start} />;
}

export function WindowManager() {
  const windows = useOS((s) => s.windows);
  const focused = useOS((s) => s.focused);
  const viewport = useOS((s) => s.viewport);
  const focusWin = useOS((s) => s.focusWin);

  return (
    <div className="window-layer">
      {windows.map((win) => {
        const style = win.max
          ? { inset: `${38}px 0 0 0`, width: 'auto', height: 'auto', borderRadius: 0 }
          : {
              left: win.x,
              top: win.y,
              width: win.w,
              height: Math.min(win.h, Math.max(220, viewport.h - win.y - 12)),
              zIndex: win.z,
            };
        return (
          <div
            key={win.id}
            className={cx('window', focused === win.id && 'focused', win.min && 'minimized')}
            style={win.max ? { ...style, zIndex: win.z } : style}
            onPointerDown={() => focusWin(win.id)}
          >
            <TitleBar win={win} />
            <div className="window-body">
              <AppRenderer appId={win.appId} winId={win.id} />
            </div>
            {!win.max && <ResizeHandle win={win} />}
          </div>
        );
      })}
    </div>
  );
}
