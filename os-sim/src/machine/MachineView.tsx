import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Gauge,
  HardDrive,
  Keyboard,
  Loader2,
  MonitorPlay,
  MousePointerClick,
  Pause,
  Play,
  Power,
  RotateCcw,
  Save,
  Terminal,
  Upload,
  Usb,
} from 'lucide-react';
import { createVM, loadImage, type VMApi, type VMState } from '../system/vm';
import { BUILTIN_IMAGES, useVM, type MachineImage } from '../store/useVM';
import { sfx } from '../system/sound';
import { cx } from '../system/cx';

export function MachineView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const vmRef = useRef<VMApi | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const screen = useVM((s) => s.screen);
  const setScreen = useVM((s) => s.setScreen);
  const booted = useVM((s) => s.booted);
  const setBooted = useVM((s) => s.setBooted);
  const scale = useVM((s) => s.scale);
  const setScale = useVM((s) => s.setScale);
  const paused = useVM((s) => s.paused);
  const setPaused = useVM((s) => s.setPaused);
  const serial = useVM((s) => s.serial);
  const pushSerial = useVM((s) => s.pushSerial);
  const activeImageId = useVM((s) => s.activeImageId);
  const setActiveImage = useVM((s) => s.setActiveImage);
  const userImages = useVM((s) => s.userImages);

  const [phase, setPhase] = useState<'idle' | 'loading' | 'booting' | 'ready' | 'failed'>('idle');
  const [loadPct, setLoadPct] = useState(0);
  const [vmState, setVmState] = useState<VMState>('starting');
  const [error, setError] = useState<string | null>(null);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const images = [...BUILTIN_IMAGES, ...userImages];
  const active = images.find((i) => i.id === activeImageId) ?? BUILTIN_IMAGES[0];

  const toast = (msg: string) => {
    setShowToast(msg);
    window.setTimeout(() => setShowToast(null), 2600);
  };

  /* ---------------- boot the machine ---------------- */
  const boot = useCallback(async () => {
    if (!containerRef.current) return;
    vmRef.current?.destroy();
    vmRef.current = null;
    setPhase('loading');
    setLoadPct(0);
    setError(null);
    try {
      const image = await loadImage(active.path, setLoadPct);
      setPhase('booting');
      const vm = createVM({
        container: containerRef.current,
        image,
        slot: 'fda',
        memoryMB: 32,
        onSerial: pushSerial,
        onState: setVmState,
      });
      vmRef.current = vm;
      vm.setScale(scale);
      frameRef.current?.focus();
      // wait until the guest really painted, instead of guessing a delay
      const started = Date.now();
      const poll = window.setInterval(() => {
        const alive = vm.isAlive();
        if (alive || Date.now() - started > 25000) {
          window.clearInterval(poll);
          setPhase('ready');
          setBooted(true);
        }
      }, 400);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  }, [active.path, pushSerial, scale, setBooted]);

  useEffect(() => {
    if (screen !== 'machine' || booted) return;
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, booted]);

  useEffect(() => {
    return () => {
      vmRef.current?.destroy();
      vmRef.current = null;
      setBooted(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    vmRef.current?.setScale(scale);
  }, [scale]);

  /* ---------------- toolbar actions ---------------- */
  const restart = () => {
    sfx.open();
    void vmRef.current?.restart();
    toast('إعادة تشغيل الجهاز');
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    vmRef.current?.setPaused(next);
    sfx.tap();
  };

  const saveSnapshot = async () => {
    const vm = vmRef.current;
    if (!vm) return;
    const state = await vm.saveState();
    const blob = new Blob([state], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-machine-state-${Date.now()}.bin`;
    a.click();
    URL.revokeObjectURL(url);
    toast('حُفظت صورة حالة الجهاز');
  };

  const pickFile = () => fileRef.current?.click();

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const slot: MachineImage['slot'] =
      /\.iso$/i.test(file.name) ? 'cdrom' : /\.(img|ima|vhd|raw|dsk)$/i.test(file.name) ? 'hda' : 'fda';
    const url = URL.createObjectURL(file);
    const img: MachineImage = {
      id: `user-${Date.now()}`,
      name: file.name,
      path: url,
      slot,
      memoryMB: slot === 'fda' ? 32 : 128,
      note: `${slot.toUpperCase()} · ${(file.size / 1048576).toFixed(1)} MB · من جهازك`,
      builtin: false,
      size: file.size,
    };
    useVM.getState().addUserImage(img);
    setActiveImage(img.id);
    setBooted(false);
    toast(`أُضيفت ${file.name} — جاهزة للإقلاع`);
  };

  const bootImage = (img: MachineImage) => {
    setActiveImage(img.id);
    setBooted(false);
    if (screen !== 'machine') setScreen('machine');
    window.setTimeout(() => void boot(), 60);
    toast(`إقلاع ${img.name}`);
  };

  const busy = phase === 'loading' || phase === 'booting';

  // Prevent the page from scrolling while the pointer is over the machine.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [screen]);

  return (
    <div className="machine">
      <div className="machine-head">
        <button className="btn ghost" onClick={() => setScreen('desktop')} title="عودة إلى NovaOS">
          <ArrowLeft />
        </button>
        <div className="machine-title">
          <b>Nova Machine</b>
          <span className="tiny">PC محاكى · x86 + SeaBIOS + VBE</span>
        </div>
        <div className="machine-state">
          <span className={cx('led', vmState === 'running' && 'on')} />
          <span className="tiny">{stateLabel(vmState, busy ? phase : 'ready')}</span>
        </div>
        <div className="machine-tools">
          <button className={cx('btn ghost', paused && 'primary')} onClick={togglePause} title="إيقاف/تشغيل مؤقت">
            {paused ? <Play /> : <Pause />}
          </button>
          <button className="btn ghost" onClick={restart} title="إعادة تشغيل الجهاز">
            <RotateCcw />
          </button>
          <button className="btn ghost" onClick={saveSnapshot} title="حفظ صورة حالة">
            <Save />
          </button>
          <button className="btn ghost" onClick={pickFile} title="إقلاع قرص من جهازك">
            <Upload />
          </button>
          <button
            className="btn ghost"
            title="تكبير/تصغير الشاشة"
            onClick={() => {
              setScale(scale === 2 ? 1 : 2);
              sfx.tap();
            }}
          >
            <Gauge />
          </button>
        </div>
      </div>

      <div className="machine-body">
        <div className="machine-stage">
          <div
            className="crt"
            ref={frameRef}
            tabIndex={0}
            onClick={() => frameRef.current?.focus()}
            aria-label="شاشة الجهاز المحاكى"
          >
            <div className="crt-screen" ref={containerRef}>
              {/* v86 injects a text <div> and a <canvas> here */}
            </div>
            <div className="crt-glass" />
            {busy && (
              <div className="crt-overlay">
                <div className="boot-logo sm">
                  <Usb />
                </div>
                <b>{phase === 'loading' ? 'تحميل صورة القرص' : 'إقلاع العتاد'}</b>
                <div className="boot-bar">
                  <i style={{ width: `${Math.round((phase === 'loading' ? loadPct : 0.35) * 100)}%` }} />
                </div>
                <span className="tiny muted">
                  {phase === 'loading' ? `${Math.round(loadPct * 100)}% · ${active.name}` : 'SeaBIOS → NovaDesk kernel'}
                </span>
              </div>
            )}
            {phase === 'failed' && (
              <div className="crt-overlay">
                <b>تعذّر تشغيل الجهاز</b>
                <span className="tiny muted">{error}</span>
                <button className="btn primary" onClick={() => void boot()}>
                  <RotateCcw /> إعادة المحاولة
                </button>
              </div>
            )}
          </div>

          <div className="crt-label">
            <span className="row" style={{ gap: 6 }}>
              <MonitorPlay size={12} /> 640×400 · VBE 8-bit · {scale}× scale
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Keyboard size={12} /> اكتب من لوحة المفاتيح
            </span>
            <span className="row" style={{ gap: 6 }}>
              <MousePointerClick size={12} /> انقر على الشاشة أولاً لتوجيه الإدخال
            </span>
          </div>

          <form
            className="emu-sendbar"
            onSubmit={(e) => {
              e.preventDefault();
              const vm = vmRef.current;
              if (!vm) return;
              vm.sendLine(typed);
              setTyped('');
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="أرسل أمرًا إلى الجهاز… (DIR ثم Enter)"
              spellCheck={false}
              dir="ltr"
            />
            <button className="btn primary" type="submit">
              إرسال ⏎
            </button>
          </form>
        </div>

        <aside className="machine-side">
          <div className="side-title">
            <HardDrive size={14} /> الأقراص
          </div>
          <div className="disk-list">
            {images.map((img) => (
              <div key={img.id} className={cx('disk', img.id === activeImageId && 'active')}>
                <div className="row between">
                  <b>{img.name}</b>
                  <span className="chip">{img.slot === 'fda' ? 'Floppy' : img.slot === 'hda' ? 'HDD' : 'CD-ROM'}</span>
                </div>
                <p className="tiny muted">{img.note}</p>
                <div className="row" style={{ gap: 6, marginTop: 7 }}>
                  <button className="btn primary" onClick={() => bootImage(img)}>
                    <Power /> إقلاع
                  </button>
                  {!img.builtin && (
                    <button
                      className="btn ghost danger"
                      onClick={() => {
                        useVM.getState().removeUserImage(img.id);
                        toast('حُذف القرص من القائمة');
                      }}
                    >
                      إزالة
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <button className="btn" style={{ marginTop: 8 }} onClick={pickFile}>
            <Usb /> إقلاع قرص من الجهاز
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".img,.ima,.iso,.vhd,.raw,.dsk"
            hidden
            onChange={onFile}
          />

          <div className="side-title" style={{ marginTop: 14 }}>
            <Terminal size={14} /> وحدة التحكم (COM1)
          </div>
          <pre className="serial-log">{serial.slice(-1400) || 'لا مخرجات بعد…'}</pre>

          <div className="side-title" style={{ marginTop: 14 }}>
            <Download size={14} /> عن الجهاز
          </div>
          <div className="spec-list">
            <div>
              <span>المعالج</span>
              <b>x86 / JIT → WebAssembly</b>
            </div>
            <div>
              <span>الذاكرة</span>
              <b>32 MB</b>
            </div>
            <div>
              <span>القرص</span>
              <b>{active.slot === 'fda' ? 'Floppy 1.44 MB' : 'IDE'}</b>
            </div>
            <div>
              <span>الصوت</span>
              <b>PC Speaker (PIT ch.2)</b>
            </div>
          </div>
        </aside>
      </div>

      {showToast && (
        <div className="machine-toast">
          <Loader2 size={12} /> {showToast}
        </div>
      )}
    </div>
  );
}

function stateLabel(state: VMState, phase: string) {
  if (phase === 'loading') return 'تحميل…';
  if (phase === 'booting') return 'إقلاع…';
  switch (state) {
    case 'running':
      return 'يعمل';
    case 'paused':
      return 'متوقف مؤقتًا';
    case 'stopped':
      return 'متوقف';
    case 'error':
      return 'خطأ';
    default:
      return 'بدء…';
  }
}


