import { useMemo, useState } from 'react';
import { FilePlus2, Search, Trash2 } from 'lucide-react';
import { useOS } from '../store/useOS';
import { cx } from '../system/cx';
import { relativeTime } from '../system/hooks';
import { sfx } from '../system/sound';

export function NotesApp() {
  const notes = useOS((s) => s.notes);
  const addNote = useOS((s) => s.addNote);
  const updateNote = useOS((s) => s.updateNote);
  const removeNote = useOS((s) => s.removeNote);
  const [activeId, setActiveId] = useState<string | null>(notes[0]?.id ?? null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim();
    const sorted = [...notes].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!q) return sorted;
    return sorted.filter((n) => n.title.includes(q) || n.body.includes(q));
  }, [notes, query]);

  const active = notes.find((n) => n.id === activeId) ?? filtered[0] ?? null;

  return (
    <div className="app-shell">
      <div className="app-toolbar">
        <div className="search-box" style={{ flex: 1, padding: '5px 9px' }}>
          <Search />
          <input
            placeholder="بحث في الملاحظات…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ fontSize: 12 }}
          />
        </div>
        <button
          className="btn primary"
          onClick={() => {
            const id = addNote();
            setActiveId(id);
            sfx.open();
          }}
        >
          <FilePlus2 /> جديدة
        </button>
      </div>
      <div className="app-split">
        <div className="notes-list">
          {filtered.length === 0 && <div className="tiny muted" style={{ padding: 12 }}>لا توجد ملاحظات</div>}
          {filtered.map((n) => (
            <button
              key={n.id}
              className={cx('note-card', active?.id === n.id && 'active')}
              onClick={() => setActiveId(n.id)}
            >
              <b>{n.title || 'بدون عنوان'}</b>
              <p>{n.body || 'ملاحظة فارغة'}</p>
            </button>
          ))}
        </div>
        {active ? (
          <div className="note-editor">
            <div className="row" style={{ padding: '8px 10px 0', gap: 6 }}>
              <span style={{ flex: 1 }} />
              <button
                className="btn ghost danger"
                title="حذف الملاحظة"
                onClick={() => {
                  removeNote(active.id);
                  setActiveId(null);
                  sfx.close();
                }}
              >
                <Trash2 />
              </button>
            </div>
            <input
              className="note-title-input"
              value={active.title}
              placeholder="عنوان الملاحظة"
              onChange={(e) => updateNote(active.id, { title: e.target.value })}
            />
            <div className="note-meta">آخر تعديل {relativeTime(active.updatedAt)}</div>
            <textarea
              className="note-body-input"
              value={active.body}
              placeholder="اكتب هنا…"
              onChange={(e) => updateNote(active.id, { body: e.target.value })}
            />
          </div>
        ) : (
          <div className="empty" style={{ flex: 1 }}>
            اختر ملاحظة أو أنشئ واحدة جديدة
          </div>
        )}
      </div>
    </div>
  );
}
