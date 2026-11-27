import type { LucideIcon } from 'lucide-react';
import { AppWindow,
  Calculator,
  Files,
  Film,
  Image as ImageIcon,
  Info,
  MonitorPlay,
  NotebookPen,
  Settings,
  SquareTerminal,
  Cpu,
} from 'lucide-react';
import type { AppId } from '../store/useOS';

export interface AppMeta {
  id: AppId;
  name: string;
  desc: string;
  icon: LucideIcon;
  from: string;
  to: string;
  width: number;
  height: number;
  dock: boolean;
  desktop: boolean;
}

export const APPS: AppMeta[] = [
  {
    id: 'apps',
    name: 'تطبيقات الحاسوب',
    desc: 'حلّل ملف .exe واعرف إن كان يعمل، وبأي مسار',
    icon: AppWindow,
    from: '#f0a24b',
    to: '#b45309',
    width: 720,
    height: 540,
    dock: true,
    desktop: true,
  },
  {
    id: 'pcemu',
    name: 'محاكي الحاسوب',
    desc: 'شغّل برامج حقيقية داخل جهاز PC افتراضي',
    icon: Cpu,
    from: '#8b5cf6',
    to: '#4c1d95',
    width: 900,
    height: 620,
    dock: true,
    desktop: true,
  },
  {
    id: 'files',
    name: 'الملفات',
    desc: 'تصفّح نظام الملفات',
    icon: Files,
    from: '#3b82f6',
    to: '#1e40af',
    width: 760,
    height: 500,
    dock: true,
    desktop: true,
  },
  {
    id: 'notes',
    name: 'الملاحظات',
    desc: 'دوّن أفكارك',
    icon: NotebookPen,
    from: '#f59e0b',
    to: '#b45309',
    width: 720,
    height: 470,
    dock: true,
    desktop: true,
  },
  {
    id: 'terminal',
    name: 'الطرفية',
    desc: 'أوامر النظام',
    icon: SquareTerminal,
    from: '#10b981',
    to: '#065f46',
    width: 700,
    height: 430,
    dock: true,
    desktop: true,
  },
  {
    id: 'calc',
    name: 'الآلة الحاسبة',
    desc: 'حسابات سريعة',
    icon: Calculator,
    from: '#6366f1',
    to: '#3730a3',
    width: 320,
    height: 430,
    dock: true,
    desktop: false,
  },
  {
    id: 'gallery',
    name: 'الخلفيات',
    desc: 'استوديو الخلفيات',
    icon: ImageIcon,
    from: '#ec4899',
    to: '#9d174d',
    width: 700,
    height: 480,
    dock: true,
    desktop: true,
  },
  {
    id: 'monitor',
    name: 'مراقب النظام',
    desc: 'موارد حيّة',
    icon: MonitorPlay,
    from: '#22d3ee',
    to: '#0e7490',
    width: 620,
    height: 470,
    dock: false,
    desktop: true,
  },
  {
    id: 'settings',
    name: 'الإعدادات',
    desc: 'تخصيص النظام',
    icon: Settings,
    from: '#94a3b8',
    to: '#475569',
    width: 700,
    height: 500,
    dock: true,
    desktop: false,
  },
  {
    id: 'about',
    name: 'عن النظام',
    desc: 'معلومات NovaOS',
    icon: Info,
    from: '#a78bfa',
    to: '#6d28d9',
    width: 460,
    height: 520,
    dock: false,
    desktop: false,
  },
];

export const APP_BY_ID: Record<AppId, AppMeta> = APPS.reduce(
  (acc, a) => ({ ...acc, [a.id]: a }),
  {} as Record<AppId, AppMeta>,
);

export const NOT_FOUND_APP: AppMeta = {
  id: 'about',
  name: 'نافذة',
  desc: '',
  icon: Film,
  from: '#64748b',
  to: '#334155',
  width: 460,
  height: 400,
  dock: false,
  desktop: false,
};
