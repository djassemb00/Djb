import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  Download,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  HardDrive,
  Home,
  Image as ImageIcon,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { nodeAt, useOS, type FSNode } from '../store/useOS';
import { cx } from '../system/cx';
import { sfx } from '../system/sound';

const PLACES = [
  { label: 'الرئيسية', path: [] as string[], icon: HardDrive },
  { label: 'مجلد المستخدم', path: ['home'], icon: Home },
  { label: 'المستندات', path: ['home', 'user', 'Documents'], icon: FileText },
  { label: 'الصور', path: ['home', 'user', 'Pictures'], icon: ImageIcon },
  { label: 'المشاريع', path: ['home', 'user', 'Projects'], icon: FileCode2 },
];

export function FilesApp() {
  const fs = useOS((s) => s.fs);
  const user = useOS((s) => s.settings.user);
  const setFileContent = useOS((s) => s.setFileContent);
  const removePath = useOS((s) => s.removePath);
  const mkdir = useOS((s) => s.mkdir);
  const writeFile = useOS((s) => s.writeFile);
  const notify = useOS((s) => s.notify);

  const [cwd, setCwd] = useState<string[]>(['home', user]);
  const [sel, setSel] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<{
    path: string[];
    node: Extract<FSNode, { type: 'file' }>;
  } | null>(null);
  const [draft, setDraft] = useState('');

  const dir = useMemo(() => {
    const n = nodeAt(fs, cwd);
    return n && n.type === 'dir' ? n : null;
  }, [fs, cwd]);

  const children = useMemo(() => {
    if (!dir) return [];
    return [...dir.children].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }, [dir]);

  const openNode = (node: FSNode) => {
    sfx.tap();
    if (node.type === 'dir') {
      setCwd([...cwd, node.name]);
      setSel(null);
      setOpenFile(null);
    } else {
      setSel(node.name);
      setOpenFile({ path: [...cwd, node.name], node });
      setDraft(node.content);
    }
  };

  const save = () => {
    if (!openFile) return;
    setFileContent(openFile.path, draft);
    setOpenFile({
      ...openFile,
      node: { ...openFile.node, content: draft } as Extract<FSNode, { type: 'file' }>,
    });
    notify({ app: 'files', title: 'الملفات', body: `حُفظ ${openFile.node.name}` });
    sfx.tap();
  };

  const createFolder = () => {
    const name = window.prompt('اسم المجلد الجديد', 'مجلد-جديد');
    if (!name) return;
    mkdir(cwd, name.trim());
    sfx.open();
  };

  const createFile = () => {
    const name = window.prompt('اسم الملف الجديد', 'ملف.txt');
    if (!name) return;
    writeFile(cwd, { type: 'file', name: name.trim(), content: '' });
    sfx.open();
  };

  const del = () => {
    if (!sel) return;
    removePath([...cwd, sel]);
    setSel(null);
    setOpenFile(null);
    sfx.close();
  };

  return (
    <div className="app-shell">
      <div className="app-split">
        <div className="app-sidebar">
          {PLACES.map((p) => {
            const Icon = p.icon;
            const active = p.path.join('/') === cwd.join('/');
            return (
              <button
                key={p.label}
                className={cx('side-item', active && 'active')}
                onClick={() => {
                  setCwd(p.path);
                  setSel(null);
                  setOpenFile(null);
                }}
              >
                <Icon />
                {p.label}
              </button>
            );
          })}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div className="app-toolbar">
            <button
              className="btn ghost"
              title="للأعلى"
              onClick={() => {
                setCwd(cwd.slice(0, -1));
                setOpenFile(null);
              }}
              disabled={cwd.length === 0}
            >
              <ArrowUp />
            </button>
            <div className="breadcrumb">
              <button onClick={() => { setCwd([]); setOpenFile(null); }}>الجذر</button>
              {cwd.map((part, i) => (
                <span key={`${part}-${i}`} className="row" style={{ gap: 2 }}>
                  <span className="sep">/</span>
                  <button onClick={() => { setCwd(cwd.slice(0, i + 1)); setOpenFile(null); }}>{part}</button>
                </span>
              ))}
            </div>
            <div style={{ flex: 1 }} />
            <button className="btn ghost" title="مجلد جديد" onClick={createFolder}>
              <Folder />
            </button>
            <button className="btn ghost" title="ملف جديد" onClick={createFile}>
              <Plus />
            </button>
            <button className="btn ghost danger" title="حذف" onClick={del} disabled={!sel}>
              <Trash2 />
            </button>
          </div>

          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div className="app-content" style={{ flex: 1 }}>
              {children.length === 0 ? (
                <div className="empty">
                  <FolderOpen />
                  مجلد فارغ
                </div>
              ) : (
                <div className="file-list">
                  {children.map((c) => (
                    <div
                      key={c.name}
                      className={cx('file-row', sel === c.name && 'sel')}
                      onClick={() => setSel(c.name)}
                      onDoubleClick={() => openNode(c)}
                      onTouchStart={() => {
                        if (sel === c.name) openNode(c);
                      }}
                    >
                      {c.type === 'dir' ? (
                        <Folder />
                      ) : c.kind === 'image' ? (
                        <ImageIcon />
                      ) : (
                        <FileText />
                      )}
                      <span className="f-name">{c.name}</span>
                      <span className="f-meta">
                        {c.type === 'dir' ? `${c.children.length} عناصر` : `${c.content.length} حرف`}
                      </span>
                      <button
                        className="btn ghost"
                        style={{ padding: '2px 7px', fontSize: 10.5 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          openNode(c);
                        }}
                      >
                        فتح
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {openFile && (
              <div
                style={{
                  width: '48%',
                  minWidth: 220,
                  borderInlineStart: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
              >
                <div className="app-toolbar" style={{ gap: 6 }}>
                  <span style={{ fontSize: 11.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {openFile.node.name}
                  </span>
                  {openFile.node.kind === 'image' ? (
                    <span className="chip">معاينة</span>
                  ) : (
                    <button className="btn primary" onClick={save}>
                      <Save /> حفظ
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => setOpenFile(null)}>
                    <ArrowRight />
                  </button>
                </div>
                {openFile.node.kind === 'image' ? (
                  <ImagePreview name={openFile.node.name} />
                ) : (
                  <textarea
                    className={cx('editor', /^[\u0600-\u06FF]/.test(draft) ? '' : 'ltr')}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                  />
                )}
              </div>
            )}
          </div>

          <div
            className="tiny muted"
            style={{ padding: '5px 11px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}
          >
            <HardDrive size={12} style={{ marginTop: 2 }} />
            <span>{children.length} عناصر</span>
            <span style={{ flex: 1 }} />
            <Download size={12} style={{ marginTop: 2 }} />
            <span>القرص: 61% مستخدم</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImagePreview({ name }: { name: string }) {
  const wallpapers = useOS((s) => s.settings.wallpaper);
  void wallpapers;
  const id = name.replace(/\.(png|jpg)$/i, '');
  const style = useMemo(() => {
    const map: Record<string, string> = {
      nebula: 'radial-gradient(600px 400px at 30% 20%, #6d28d9, transparent 60%), linear-gradient(160deg,#05060f,#1b1035)',
      aurora: 'radial-gradient(600px 400px at 70% 30%, #0f766e, transparent 62%), linear-gradient(160deg,#04121b,#062a3a)',
      dune: 'radial-gradient(500px 320px at 30% 20%, #fbbf24, transparent 60%), linear-gradient(160deg,#78350f,#fde68a)',
    };
    return { background: map[id] ?? 'linear-gradient(150deg,#334155,#0f172a)' };
  }, [id]);
  return <div style={{ flex: 1, ...style, margin: 10, borderRadius: 12, border: '1px solid var(--border)' }} />;
}
