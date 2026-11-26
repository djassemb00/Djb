import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Phase = 'boot' | 'lock' | 'desktop' | 'shutdown';
export type AppId =
  | 'files'
  | 'notes'
  | 'terminal'
  | 'calc'
  | 'gallery'
  | 'monitor'
  | 'settings'
  | 'pcemu'
  | 'about';

export type FSNode =
  | { type: 'dir'; name: string; children: FSNode[] }
  | { type: 'file'; name: string; content: string; kind?: 'text' | 'image' };

export interface Win {
  id: string;
  appId: AppId;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  min: boolean;
  max: boolean;
}

export interface NoteDoc {
  id: string;
  title: string;
  body: string;
  updatedAt: number;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  at: number;
  read: boolean;
  app: AppId | 'system';
}

export interface Wallpaper {
  id: string;
  name: string;
  css: string;
  dark: boolean;
}

export const WALLPAPERS: Wallpaper[] = [
  {
    id: 'nebula',
    name: 'سديم',
    dark: true,
    css: 'radial-gradient(1200px 700px at 18% 12%, #3b1d6e 0%, transparent 60%), radial-gradient(1000px 600px at 82% 18%, #0b4f6c 0%, transparent 62%), radial-gradient(900px 700px at 50% 100%, #6d1b4b 0%, transparent 65%), linear-gradient(160deg, #05060f 0%, #0a0f1f 55%, #05060c 100%)',
  },
  {
    id: 'aurora',
    name: 'شفق',
    dark: true,
    css: 'radial-gradient(900px 600px at 20% 80%, #064e3b 0%, transparent 60%), radial-gradient(800px 600px at 70% 20%, #1e3a8a 0%, transparent 62%), radial-gradient(700px 500px at 90% 90%, #4c1d95 0%, transparent 60%), linear-gradient(200deg, #04070d, #060d18 60%, #03060b)',
  },
  {
    id: 'dune',
    name: 'كثبان',
    dark: false,
    css: 'radial-gradient(1000px 600px at 80% 0%, #fde68a 0%, transparent 55%), radial-gradient(900px 700px at 10% 100%, #fb923c 0%, transparent 60%), linear-gradient(150deg, #f8fafc 0%, #fde8cf 45%, #f6c48f 100%)',
  },
  {
    id: 'ocean',
    name: 'محيط',
    dark: true,
    css: 'radial-gradient(1000px 700px at 15% 10%, #0e7490 0%, transparent 60%), radial-gradient(900px 600px at 85% 30%, #1e40af 0%, transparent 62%), linear-gradient(170deg, #020617 0%, #041427 55%, #020810 100%)',
  },
  {
    id: 'ember',
    name: 'جمر',
    dark: true,
    css: 'radial-gradient(1000px 700px at 25% 20%, #7f1d1d 0%, transparent 60%), radial-gradient(800px 600px at 80% 75%, #9a3412 0%, transparent 62%), linear-gradient(160deg, #090406 0%, #140708 55%, #050204 100%)',
  },
  {
    id: 'paper',
    name: 'ورق',
    dark: false,
    css: 'radial-gradient(800px 500px at 20% 10%, #e2e8f0 0%, transparent 60%), radial-gradient(700px 600px at 85% 80%, #dbeafe 0%, transparent 60%), linear-gradient(150deg, #ffffff, #f1f5f9)',
  },
];

export const ACCENTS = ['#5b8cff', '#22d3ee', '#a78bfa', '#34d399', '#f59e0b', '#f472b6'];

export interface Settings {
  theme: 'dark' | 'light';
  accent: string;
  wallpaper: string;
  user: string;
  sounds: boolean;
  reducemotion: boolean;
  showSeconds: boolean;
  grid: boolean;
}

const defaultFS = (user: string): FSNode => ({
  type: 'dir',
  name: '/',
  children: [
    {
      type: 'dir',
      name: 'home',
      children: [
        {
          type: 'dir',
          name: user,
          children: [
            {
              type: 'dir',
              name: 'Documents',
              children: [
                {
                  type: 'file',
                  name: 'welcome.txt',
                  content:
                    'مرحبًا بك في NovaOS 1.0\n\nهذا نظام تشغيل مُحاكى يعمل داخل تطبيق واحد.\nكل شيء تراه — الإقلاع، شاشة القفل، النوافذ، الطرفية،\nنظام الملفات — يعمل فعليًا في الذاكرة وليس مجرد صور.\n\nجرّب:\n  • اسحب النوافذ وأعد تحجيمها\n  • افتح الطرفية واكتب  help\n  • بدّل الخلفية من الإعدادات أو من استوديو الخلفيات\n  • أعد تشغيل الجهاز من قائمة الطاقة\n',
                },
                {
                  type: 'file',
                  name: 'ملاحظات-الإصدار.txt',
                  content:
                    'NovaOS changelog\n\n1.0.0\n- إقلاع محاكى + شاشة قفل\n- مدير نوافذ (سحب، تحجيم، تصغير، تكبير)\n- مدير ملفات بنظام ملفات حقيقي داخل الذاكرة\n- طرفية بأوامر متعددة\n- إعدادات المظهر والنظام\n- مراقب موارد حي\n',
                },
              ],
            },
            {
              type: 'dir',
              name: 'Pictures',
              children: [
                { type: 'file', name: 'nebula.png', content: 'nebula', kind: 'image' },
                { type: 'file', name: 'aurora.png', content: 'aurora', kind: 'image' },
                { type: 'file', name: 'dune.png', content: 'dune', kind: 'image' },
              ],
            },
            {
              type: 'dir',
              name: 'Projects',
              children: [
                {
                  type: 'file',
                  name: 'kernel-notes.md',
                  content:
                    '# Kernel notes\n\n- scheduler: round robin\n- filesystem: in-memory VFS\n- drivers: display, input, audio\n',
                },
              ],
            },
            {
              type: 'file',
              name: 'readme.txt',
              content: 'NovaOS — نظام تشغيل محاكى داخل تطبيق أندرويد.\n',
            },
          ],
        },
      ],
    },
    { type: 'dir', name: 'system', children: [{ type: 'file', name: 'version', content: 'NovaOS 1.0.0 (build 2026.11)\n' }] },
  ],
});

interface OpenArgs {
  appId: AppId;
  width?: number;
  height?: number;
}

interface OSState {
  phase: Phase;
  bootProgress: number;
  bootLines: string[];
  bootStartedAt: number;
  bootAt: number;

  viewport: { w: number; h: number };
  windows: Win[];
  focused: string | null;
  zTop: number;

  settings: Settings;
  notes: NoteDoc[];
  fs: FSNode;
  notifications: Notification[];
  quick: { wifi: boolean; bluetooth: boolean; dnd: boolean; sounds: boolean };

  setViewport: (w: number, h: number) => void;
  beginBoot: () => void;
  setBootProgress: (p: number) => void;
  pushBootLine: (line: string) => void;
  finishBoot: () => void;
  unlock: () => void;
  lock: () => void;
  shutdown: () => void;
  restart: () => void;

  open: (args: OpenArgs) => string;
  close: (id: string) => void;
  focusWin: (id: string) => void;
  moveWin: (id: string, x: number, y: number) => void;
  resizeWin: (id: string, w: number, h: number) => void;
  toggleMin: (id: string) => void;
  toggleMax: (id: string) => void;

  patchSettings: (patch: Partial<Settings>) => void;
  resetSettings: () => void;
  resetAll: () => void;

  addNote: () => string;
  updateNote: (id: string, patch: Partial<NoteDoc>) => void;
  removeNote: (id: string) => void;

  writeFile: (path: string[], node: FSNode) => void;
  removePath: (path: string[]) => void;
  setFileContent: (path: string[], content: string) => void;
  mkdir: (path: string[], name: string) => void;

  notify: (n: Omit<Notification, 'id' | 'at' | 'read'>) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  toggleQuick: (k: keyof OSState['quick']) => void;
  clearBoot: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const bootScript: { at: number; text: string }[] = [
  { at: 0, text: '[firmware] NOVA UEFI v2.4 — شاشة الطاقة جاهزة' },
  { at: 0.04, text: '[kernel] تحميل النواة nova-core 1.0.0 …' },
  { at: 0.09, text: '[kernel] تهيئة الذاكرة: 8192 MB' },
  { at: 0.14, text: '[kernel] جدولة المهام: round-robin · 4 أنوية' },
  { at: 0.2, text: '[driver] display: gpu-framebuffer 60Hz ✓' },
  { at: 0.26, text: '[driver] input: touch + pointer ✓' },
  { at: 0.31, text: '[driver] audio: nova-sfx ✓' },
  { at: 0.37, text: '[vfs] تحميل نظام الملفات …' },
  { at: 0.44, text: '[vfs] /home · /system · mounted rw' },
  { at: 0.52, text: '[service] window-manager' },
  { at: 0.58, text: '[service] notification-daemon' },
  { at: 0.64, text: '[service] settings-store' },
  { at: 0.71, text: '[boot] تشغيل الطرفية الافتراضية …' },
  { at: 0.78, text: '[boot] تحميل سطح المكتب …' },
  { at: 0.86, text: '[boot] بدء جلسة المستخدم' },
  { at: 0.94, text: '[boot] NovaOS جاهز.' },
];

export const BOOT_DURATION = 5200;

function nodeAt(root: FSNode, path: string[]): FSNode | null {
  let cur: FSNode = root;
  for (const part of path) {
    if (part === '' || part === '.') continue;
    if (cur.type !== 'dir') return null;
    const next = cur.children.find((c) => c.name === part);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function mutate(root: FSNode, path: string[], fn: (dir: FSNode & { type: 'dir' }) => void): FSNode {
  const clone = structuredClone(root);
  const target = nodeAt(clone, path);
  if (target && target.type === 'dir') fn(target);
  return clone;
}

export const useOS = create<OSState>()(
  persist(
    (set, get) => ({
      phase: 'boot',
      bootProgress: 0,
      bootLines: [],
      bootStartedAt: 0,
      bootAt: Date.now(),

      viewport: { w: 1280, h: 800 },
      windows: [],
      focused: null,
      zTop: 10,

      settings: {
        theme: 'dark',
        accent: '#5b8cff',
        wallpaper: 'nebula',
        user: 'user',
        sounds: true,
        reducemotion: false,
        showSeconds: false,
        grid: true,
      },
      notes: [
        {
          id: 'n1',
          title: 'أفكار',
          body: 'فكرة ١: واجهة أقفال بتأثير زجاجي.\nفكرة ٢: طرفية تدعم الأنابيب.\nفكرة ٣: مساحة عمل متعددة.',
          updatedAt: Date.now(),
        },
      ],
      fs: defaultFS('user'),
      notifications: [
        {
          id: uid(),
          title: 'NovaOS',
          body: 'اكتمل تثبيت النظام. مرحبًا بك!',
          at: Date.now(),
          read: false,
          app: 'system',
        },
      ],
      quick: { wifi: true, bluetooth: false, dnd: false, sounds: true },

      setViewport: (w, h) => set({ viewport: { w, h } }),

      beginBoot: () => {
        set({ phase: 'boot', bootProgress: 0, bootLines: [], bootStartedAt: Date.now() });
      },
      setBootProgress: (p) => set({ bootProgress: Math.min(1, Math.max(0, p)) }),
      pushBootLine: (line) =>
        set((s) => (s.bootLines.includes(line) ? s : { bootLines: [...s.bootLines, line] })),
      finishBoot: () => set({ phase: 'lock', bootProgress: 1, bootAt: Date.now() }),
      unlock: () => set({ phase: 'desktop', focused: null, windows: [] }),
      lock: () => set({ phase: 'lock', focused: null }),
      shutdown: () => set({ phase: 'shutdown', windows: [], focused: null }),
      restart: () => {
        get().beginBoot();
        get().clearBoot();
      },
      clearBoot: () => set({ bootProgress: 0, bootLines: [] }),

      open: ({ appId, width = 760, height = 520 }) => {
        const { windows, viewport, zTop } = get();
        const existing = windows.find((w) => w.appId === appId);
        if (existing) {
          set({
            windows: windows.map((w) =>
              w.id === existing.id ? { ...w, min: false, z: zTop + 1 } : w,
            ),
            focused: existing.id,
            zTop: zTop + 1,
          });
          return existing.id;
        }
        const narrow = viewport.w < 760;
        const w = narrow ? viewport.w - 16 : Math.min(width, viewport.w - 60);
        const h = narrow ? viewport.h - 128 : Math.min(height, viewport.h - 110);
        const count = windows.length;
        const x = narrow ? 8 : Math.round((viewport.w - w) / 2 + ((count % 4) - 1.5) * 28);
        const y = narrow ? 56 : Math.round((viewport.h - h) / 2 - 18 + ((count % 4) - 1.5) * 22);
        const id = `${appId}-${uid()}`;
        const win: Win = {
          id,
          appId,
          x: Math.max(8, x),
          y: Math.max(44, y),
          w,
          h,
          z: zTop + 1,
          min: false,
          max: narrow,
        };
        set({ windows: [...windows, win], focused: id, zTop: zTop + 1 });
        return id;
      },

      close: (id) =>
        set((s) => ({
          windows: s.windows.filter((w) => w.id !== id),
          focused: s.focused === id ? [...s.windows].reverse().find((w) => w.id !== id && !w.min)?.id ?? null : s.focused,
        })),

      focusWin: (id) =>
        set((s) => {
          const w = s.windows.find((x) => x.id === id);
          if (!w) return s;
          return {
            windows: s.windows.map((x) => (x.id === id ? { ...x, z: s.zTop + 1, min: false } : x)),
            focused: id,
            zTop: s.zTop + 1,
          };
        }),

      moveWin: (id, x, y) =>
        set((s) => ({ windows: s.windows.map((w) => (w.id === id ? { ...w, x, y } : w)) })),

      resizeWin: (id, w, h) =>
        set((s) => ({
          windows: s.windows.map((win) =>
            win.id === id ? { ...win, w: Math.max(280, w), h: Math.max(200, h) } : win,
          ),
        })),

      toggleMin: (id) =>
        set((s) => {
          const target = s.windows.find((w) => w.id === id);
          const willMin = !target?.min;
          return {
            windows: s.windows.map((w) => (w.id === id ? { ...w, min: willMin } : w)),
            focused: willMin ? null : id,
          };
        }),

      toggleMax: (id) =>
        set((s) => ({
          windows: s.windows.map((w) => (w.id === id ? { ...w, max: !w.max, min: false } : w)),
        })),

      patchSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      resetSettings: () =>
        set({
          settings: {
            theme: 'dark',
            accent: '#5b8cff',
            wallpaper: 'nebula',
            user: 'user',
            sounds: true,
            reducemotion: false,
            showSeconds: false,
            grid: true,
          },
        }),
      resetAll: () =>
        set({
          fs: defaultFS('user'),
          notes: [],
          notifications: [],
          windows: [],
          settings: {
            theme: 'dark',
            accent: '#5b8cff',
            wallpaper: 'nebula',
            user: 'user',
            sounds: true,
            reducemotion: false,
            showSeconds: false,
            grid: true,
          },
        }),

      addNote: () => {
        const id = uid();
        set((s) => ({
          notes: [{ id, title: 'ملاحظة جديدة', body: '', updatedAt: Date.now() }, ...s.notes],
        }));
        return id;
      },
      updateNote: (id, patch) =>
        set((s) => ({
          notes: s.notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)),
        })),
      removeNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),

      writeFile: (path, node) =>
        set((s) => ({
          fs: mutate(s.fs, path, (dir) => {
            const existing = dir.children.findIndex((c) => c.name === node.name);
            if (existing >= 0) dir.children[existing] = node;
            else dir.children.push(node);
          }),
        })),
      removePath: (path) =>
        set((s) => {
          if (path.length === 0) return s;
          const parent = path.slice(0, -1);
          const name = path[path.length - 1];
          return { fs: mutate(s.fs, parent, (dir) => { dir.children = dir.children.filter((c) => c.name !== name); }) };
        }),
      setFileContent: (path, content) =>
        set((s) => {
          const clone = structuredClone(s.fs);
          const target = nodeAt(clone, path);
          if (target && target.type === 'file') target.content = content;
          return { fs: clone };
        }),
      mkdir: (path, name) =>
        set((s) => ({
          fs: mutate(s.fs, path, (dir) => {
            if (!dir.children.some((c) => c.name === name)) {
              dir.children.push({ type: 'dir', name, children: [] });
            }
          }),
        })),

      notify: (n) =>
        set((s) => ({
          notifications: [{ ...n, id: uid(), at: Date.now(), read: false }, ...s.notifications].slice(0, 40),
        })),
      markAllRead: () => set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),
      clearNotifications: () => set({ notifications: [] }),
      toggleQuick: (k) => set((s) => ({ quick: { ...s.quick, [k]: !s.quick[k] } })),
    }),
    {
      name: 'novaos-v1',
      partialize: (s) => ({
        settings: s.settings,
        notes: s.notes,
        fs: s.fs,
        notifications: s.notifications,
        quick: s.quick,
      }),
    },
  ),
);

export function resolvePath(cwd: string[], input: string): string[] {
  const parts = input.trim().split('/');
  let out = input.startsWith('/') ? [] : [...cwd];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out = out.slice(0, -1);
    else if (part === '~') out = ['home', useOS.getState().settings.user];
    else out.push(part);
  }
  return out;
}

export const homeOf = (user: string) => ['home', user];
export { nodeAt, bootScript };
