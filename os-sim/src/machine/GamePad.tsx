/**
 * On-screen game controls for the emulated machine.
 *
 * Handheld PCs and DOS games are arrow-key games: on a phone the only way to play
 * our own SNAKE or any DOS arcade title is a real d-pad and fire buttons. Typing into
 * an invisible input box cannot express "hold left".
 *
 * Everything here is PS/2 set-1 scancodes sent straight to the guest, the same path
 * the hardware keyboard uses, so the guest cannot tell the difference.
 */
import { useEffect, useRef, useState } from 'react';

/** PS/2 set 1: make code, break = make | 0x80 */
const KEYS = {
  up: 0x48,
  down: 0x50,
  left: 0x4b,
  right: 0x4d,
  space: 0x39,
  enter: 0x1c,
  esc: 0x01,
} as const;

export type PadKey = keyof typeof KEYS;

/** host KeyboardEvent.code -> guest key (held keys are tracked, not repeated) */
const PHYSICAL: Record<string, PadKey> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'space',
  Enter: 'enter',
  Escape: 'esc',
};

export function useGamepad(send: (codes: number[]) => void, enabled: boolean) {
  const held = useRef<Set<PadKey>>(new Set());

  const press = (k: PadKey) => {
    if (held.current.has(k)) return; // guests see one make per hold, not a stream
    held.current.add(k);
    send([KEYS[k]]);
  };
  const release = (k: PadKey) => {
    if (!held.current.delete(k)) return;
    send([KEYS[k] | 0x80]);
  };

  // a real keyboard plugged into the phone should behave like the d-pad
  useEffect(() => {
    if (!enabled) return;
    const down = (e: KeyboardEvent) => {
      const k = PHYSICAL[e.code];
      if (!k) return;
      // let the guest's own typing keep working when a text field has focus
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      press(k);
    };
    const up = (e: KeyboardEvent) => {
      const k = PHYSICAL[e.code];
      if (!k) return;
      release(k);
    };
    const blur = () => {
      // holding a key while the app loses focus would leave the guest stuck
      for (const k of [...held.current]) release(k);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { press, release };
}

/**
 * The visible pad. Uses pointer events so a finger sliding between buttons still
 * releases the right one, and `touch-action: none` so the browser does not scroll.
 */
export function GamePad({ press, release }: { press: (k: PadKey) => void; release: (k: PadKey) => void }) {
  const [active, setActive] = useState<PadKey | null>(null);

  const bind = (k: PadKey) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setActive(k);
      press(k);
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      setActive(null);
      release(k);
    },
    onPointerCancel: () => {
      setActive(null);
      release(k);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      // only release if the pointer is actually up: a captured drag keeps the key
      if (e.buttons === 0) {
        setActive(null);
        release(k);
      }
    },
    className: `pad-btn ${active === k ? 'on' : ''}`,
  });

  return (
    <div className="gamepad" aria-label="أزرار اللعب">
      <div className="pad-dpad">
        <button {...bind('up')} aria-label="أعلى">
          ▲
        </button>
        <div className="pad-row">
          <button {...bind('left')} aria-label="يسار">
            ◀
          </button>
          <button {...bind('down')} aria-label="أسفل">
            ▼
          </button>
          <button {...bind('right')} aria-label="يمين">
            ▶
          </button>
        </div>
      </div>
      <div className="pad-fire">
        <button {...bind('esc')} aria-label="خروج">
          ESC
        </button>
        <button {...bind('enter')} aria-label="إدخال">
          ⏎
        </button>
        <button {...bind('space')} className="pad-btn big" aria-label="إطلاق">
          FIRE
        </button>
      </div>
    </div>
  );
}
