import { useEffect } from 'react';
import { Cpu, HardDrive, MonitorPlay, MousePointerClick, Power, Shield, Upload, Zap } from 'lucide-react';
import { useVM } from '../store/useVM';
import { useOS } from '../store/useOS';
import { sfx } from '../system/sound';

/**
 * Launcher card for the emulated PC. Opening the window only shows this card;
 * the real machine (v86 + our bootable kernel) takes over the screen so it can
 * render at a useful size and receive keyboard/mouse input directly.
 */
export function PCEmuApp() {
  const setScreen = useVM((s) => s.setScreen);
  const booted = useVM((s) => s.booted);
  const activeImageId = useVM((s) => s.activeImageId);
  const closeWin = useOS((s) => s.close);
  const wins = useOS((s) => s.windows);

  const enter = () => {
    sfx.open();
    setScreen('machine');
  };

  // Opening the app means "start the computer": no extra click, and the
  // launcher window closes itself once the machine owns the screen.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setScreen('machine');
      // the machine takes over the whole screen; drop the launcher window
      for (const w of wins) if (w.appId === 'pcemu') closeWin(w.id);
    }, 420);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="emu-launcher">
      <div className="emu-hero">
        <div className="emu-badge">
          <Cpu />
        </div>
        <div>
          <h3>محاكي الحاسوب</h3>
          <p className="muted">
            جهاز PC كامل داخل التطبيق: معالج x86 يعمل عبر WebAssembly، BIOS حقيقي، شاشة VBE، ماوس
            ولوحة مفاتيح، وصوت. شغّل نظام <b>NovaDesk</b> المرفق أو أقلع قرصك الخاص.
          </p>
        </div>
      </div>

      <div className="emu-grid">
        <div className="emu-card">
          <MonitorPlay size={18} />
          <b>شاشة حقيقية</b>
          <span className="tiny muted">640×400 · VBE linear framebuffer يُرسم بكود النواة</span>
        </div>
        <div className="emu-card">
          <Zap size={18} />
          <b>إقلاع فعلي</b>
          <span className="tiny muted">SeaBIOS يقرأ قرص المرن ثم يقفز إلى نواتنا 32-bit</span>
        </div>
        <div className="emu-card">
          <MousePointerClick size={18} />
          <b>تحكم كامل</b>
          <span className="tiny muted">PS/2 mouse + keyboard + PC speaker</span>
        </div>
        <div className="emu-card">
          <HardDrive size={18} />
          <b>أقراص قابلة للتبديل</b>
          <span className="tiny muted">IMG / ISO من جهازك — يعمل داخل الجهاز المحاكى</span>
        </div>
      </div>

      <div className="emu-actions">
        <button className="btn primary" onClick={enter}>
          <Power /> {booted ? 'العودة إلى الجهاز' : 'تشغيل الجهاز'}
        </button>
        <button className="btn" onClick={enter}>
          <Upload /> إقلاع قرص آخر
        </button>
      </div>

      <div className="emu-note">
        <Shield size={14} />
        <span className="tiny muted">
          لا يُضمَّن أي نظام تجاري. المحاكي يشغّل NovaDesk المرفق أو أي صورة نظام تملك حق استخدامها.
          القرص الحالي: <b>{activeImageId}</b>.
        </span>
      </div>
    </div>
  );
}
