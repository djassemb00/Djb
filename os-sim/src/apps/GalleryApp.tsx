import { Check } from 'lucide-react';
import { ACCENTS, useOS, WALLPAPERS } from '../store/useOS';
import { cx } from '../system/cx';
import { sfx } from '../system/sound';

export function GalleryApp() {
  const wallpaper = useOS((s) => s.settings.wallpaper);
  const accent = useOS((s) => s.settings.accent);
  const patch = useOS((s) => s.patchSettings);
  const notify = useOS((s) => s.notify);

  return (
    <div className="app-shell">
      <div className="app-toolbar">
        <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>استوديو الخلفيات</span>
        <span className="chip">{WALLPAPERS.length} خلفيات</span>
      </div>
      <div className="app-content">
        <div className="section-title" style={{ marginInline: 12 }}>
          الخلفية
        </div>
        <div className="gallery-grid">
          {WALLPAPERS.map((w) => (
            <div
              key={w.id}
              className={cx('gallery-cell')}
              style={{ background: w.css, outline: wallpaper === w.id ? '2px solid var(--accent)' : 'none' }}
              onClick={() => {
                patch({ wallpaper: w.id, theme: w.dark ? 'dark' : 'light' });
                sfx.open();
                notify({ app: 'gallery', title: 'الخلفيات', body: `طُبّقت خلفية «${w.name}»` });
              }}
            >
              <span>{w.name}</span>
              {wallpaper === w.id && (
                <div
                  style={{
                    position: 'absolute',
                    top: 6,
                    insetInlineEnd: 6,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: 'var(--accent)',
                    display: 'grid',
                    placeItems: 'center',
                    color: '#fff',
                  }}
                >
                  <Check size={12} strokeWidth={3} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="section-title" style={{ marginInline: 12 }}>
          اللون الأساسي
        </div>
        <div className="row" style={{ padding: '4px 12px 16px', flexWrap: 'wrap', gap: 9 }}>
          {ACCENTS.map((c) => (
            <button
              key={c}
              aria-label={`لون ${c}`}
              onClick={() => {
                patch({ accent: c });
                sfx.tap();
              }}
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: c,
                border: accent === c ? '2.5px solid var(--text)' : '2px solid transparent',
                cursor: 'pointer',
                boxShadow: `0 0 0 1px var(--border)`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
