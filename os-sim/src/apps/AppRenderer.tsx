import type { AppId } from '../store/useOS';
import { FilesApp } from './FilesApp';
import { NotesApp } from './NotesApp';
import { TerminalApp } from './TerminalApp';
import { CalcApp } from './CalcApp';
import { GalleryApp } from './GalleryApp';
import { MonitorApp } from './MonitorApp';
import { SettingsApp } from './SettingsApp';
import { AboutApp } from './AboutApp';

export function AppRenderer({ appId }: { appId: AppId; winId: string }) {
  switch (appId) {
    case 'files':
      return <FilesApp />;
    case 'notes':
      return <NotesApp />;
    case 'terminal':
      return <TerminalApp />;
    case 'calc':
      return <CalcApp />;
    case 'gallery':
      return <GalleryApp />;
    case 'monitor':
      return <MonitorApp />;
    case 'settings':
      return <SettingsApp />;
    case 'about':
      return <AboutApp />;
    default:
      return null;
  }
}
