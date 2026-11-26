import { useEffect, useRef, useState } from 'react';

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Animated counter driven by requestAnimationFrame, used by the boot sequence. */
export function useBootDriver(active: boolean, duration: number, onTick: (p: number) => void, onDone: () => void) {
  const cb = useRef({ onTick, onDone });
  cb.current = { onTick, onDone };
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      cb.current.onTick(p);
      if (p < 1) raf = requestAnimationFrame(loop);
      else cb.current.onDone();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, duration]);
}

export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return { ref, size };
}

export function formatTime(d: Date, withSeconds = false) {
  const h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const s = d.getSeconds().toString().padStart(2, '0');
  const hh = (h % 12 || 12).toString();
  const suffix = h < 12 ? 'ص' : 'م';
  return `${hh}:${m}${withSeconds ? `:${s}` : ''} ${suffix}`;
}

const AR_DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = [
  'جانفي',
  'فيفري',
  'مارس',
  'أفريل',
  'ماي',
  'جوان',
  'جويلية',
  'أوت',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

export function formatDate(d: Date) {
  return `${AR_DAYS[d.getDay()]} ${d.getDate()} ${AR_MONTHS[d.getMonth()]}`;
}

export function relativeTime(ts: number) {
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} د`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `قبل ${hrs} س`;
  return `قبل ${Math.floor(hrs / 24)} ي`;
}
