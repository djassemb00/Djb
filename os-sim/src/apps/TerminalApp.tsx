import { useEffect, useRef, useState } from 'react';
import { nodeAt, resolvePath, useOS, type FSNode } from '../store/useOS';
import { BOOT_DURATION } from '../store/useOS';
import { cx } from '../system/cx';
import { BUILTIN_IMAGES, useVM } from '../store/useVM';

type Line = { text: string; cls?: 'err' | 'ok' | 'dim' | 'hi' };

const COMMANDS = [
  'help',
  'ls',
  'cd',
  'pwd',
  'cat',
  'echo',
  'mkdir',
  'touch',
  'rm',
  'df',
  'free',
  'uname',
  'neofetch',
  'date',
  'whoami',
  'clear',
  'notify',
  'wallpaper',
  'theme',
  'lock',
  'reboot',
  'poweroff',
  'apps',
  'open',
];

function listDir(dir: FSNode) {
  if (dir.type !== 'dir') return [];
  return [...dir.children].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
}

export function TerminalApp() {
  const fs = useOS((s) => s.fs);
  const user = useOS((s) => s.settings.user);
  const settings = useOS((s) => s.settings);
  const patch = useOS((s) => s.patchSettings);
  const mkdir = useOS((s) => s.mkdir);
  const writeFile = useOS((s) => s.writeFile);
  const removePath = useOS((s) => s.removePath);
  const notify = useOS((s) => s.notify);
  // the guest's real memory, so `free` reports the machine we actually emulate
  const activeImageId = useVM((s) => s.activeImageId);
  const userImages = useVM((s) => s.userImages);
  const open = useOS((s) => s.open);
  const lock = useOS((s) => s.lock);
  const restart = useOS((s) => s.restart);
  const shutdown = useOS((s) => s.shutdown);
  const notes = useOS((s) => s.notes);

  const [cwd, setCwd] = useState<string[]>(['home', user]);
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<Line[]>([
    { text: 'NovaOS Terminal v1.0 — nova-shell', cls: 'ok' },
    { text: 'اكتب help لعرض الأوامر المتاحة.', cls: 'dim' },
    { text: '' },
  ]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const push = (text: string, cls?: Line['cls']) => setLines((l) => [...l, { text, cls }]);

  const homePath = `home/${user}`;
  const inHome = cwd.slice(0, 2).join('/') === homePath;
  const rest = inHome ? cwd.slice(2) : [];
  const prompt = inHome ? `~${rest.length > 0 ? '/' : ''}${rest.join('/')}` : `/${cwd.join('/')}`;

  const run = (raw: string) => {
    const cmdline = raw.trim();
    push(`${prompt} $ ${raw}`, 'dim');
    if (!cmdline) return;
    const [cmd, ...args] = cmdline.split(/\s+/);
    const arg = args.join(' ');
    const out: Line[] = [];

    const needPath = (p: string) => resolvePath(cwd, p);

    switch (cmd) {
      case 'help':
        out.push({ text: 'الأوامر المتاحة:', cls: 'hi' });
        out.push({ text: '  ls [path]        عرض محتويات مجلد' });
        out.push({ text: '  cd <path>        تغيير المجلد الحالي (~ و .. مدعومة)' });
        out.push({ text: '  pwd              مسار المجلد الحالي' });
        out.push({ text: '  cat <file>       طباعة محتوى ملف' });
        out.push({ text: '  echo <text>      طباعة نص (يُنشئ ملفًا عند echo نص > ملف)' });
        out.push({ text: '  mkdir <name>     إنشاء مجلد' });
        out.push({ text: '  touch <name>     إنشاء ملف فارغ' });
        out.push({ text: '  rm <name>        حذف ملف أو مجلد' });
        out.push({ text: '  df / free        مساحة القرص والذاكرة' });
        out.push({ text: '  uname -a         معلومات النواة' });
        out.push({ text: '  neofetch         بطاقة النظام' });
        out.push({ text: '  date / whoami    الوقت والمستخدم' });
        out.push({ text: '  notify <نص>      إرسال إشعار' });
        out.push({ text: '  wallpaper <id>   تغيير الخلفية (nebula, aurora, dune, ocean, ember, paper)' });
        out.push({ text: '  theme <dark|light>' });
        out.push({ text: '  open <app>       فتح تطبيق (files, notes, terminal, calc, gallery, monitor, settings, about)' });
        out.push({ text: '  apps             قائمة التطبيقات' });
        out.push({ text: '  lock / reboot / poweroff / clear' });
        break;
      case 'ls': {
        const target = arg ? nodeAt(fs, needPath(arg)) : nodeAt(fs, cwd);
        if (!target) out.push({ text: `ls: لا يوجد مسار: ${arg}`, cls: 'err' });
        else if (target.type === 'file') out.push({ text: target.name });
        else if (target.children.length === 0) out.push({ text: '(فارغ)', cls: 'dim' });
        else {
          out.push({ text: listDir(target).map((c) => (c.type === 'dir' ? `${c.name}/` : c.name)).join('   ') });
          out.push({ text: `${target.children.length} عنصر · ${sumSize(target)} بايت تقريبًا`, cls: 'dim' });
        }
        break;
      }
      case 'cd': {
        if (!arg || arg === '~') {
          setCwd(['home', user]);
          break;
        }
        const next = needPath(arg);
        const node = nodeAt(fs, next);
        if (!node) out.push({ text: `cd: مسار غير موجود: ${arg}`, cls: 'err' });
        else if (node.type !== 'dir') out.push({ text: `cd: ليس مجلدًا: ${arg}`, cls: 'err' });
        else setCwd(next);
        break;
      }
      case 'pwd':
        out.push({ text: `/${cwd.join('/')}` });
        break;
      case 'cat': {
        if (!arg) {
          out.push({ text: 'cat: يجب تحديد ملف', cls: 'err' });
          break;
        }
        const node = nodeAt(fs, needPath(arg));
        if (!node) out.push({ text: `cat: لا يوجد ملف: ${arg}`, cls: 'err' });
        else if (node.type === 'dir') out.push({ text: `cat: ${arg} مجلد`, cls: 'err' });
        else out.push({ text: node.content || '(ملف فارغ)' });
        break;
      }
      case 'echo': {
        const redirect = cmdline.match(/echo\s+(.*?)\s*>\s*(\S+)\s*$/);
        if (redirect) {
          const [, text, file] = redirect;
          const clean = text.replace(/^["']|["']$/g, '');
          const parent = needPath(file).slice(0, -1);
          const name = needPath(file).slice(-1)[0];
          writeFile(parent, { type: 'file', name, content: clean });
          out.push({ text: `كُتب ${clean.length} حرف في ${file}`, cls: 'ok' });
        } else out.push({ text: arg.replace(/^["']|["']$/g, '') });
        break;
      }
      case 'mkdir':
        if (!arg) out.push({ text: 'mkdir: يجب تحديد اسم', cls: 'err' });
        else {
          mkdir(cwd, arg);
          out.push({ text: `أُنشئ المجلد ${arg}`, cls: 'ok' });
        }
        break;
      case 'touch':
        if (!arg) out.push({ text: 'touch: يجب تحديد اسم', cls: 'err' });
        else {
          writeFile(cwd, { type: 'file', name: arg, content: '' });
          out.push({ text: `أُنشئ الملف ${arg}`, cls: 'ok' });
        }
        break;
      case 'rm':
        if (!arg) out.push({ text: 'rm: يجب تحديد مسار', cls: 'err' });
        else {
          removePath(needPath(arg));
          out.push({ text: `حُذف ${arg}`, cls: 'ok' });
        }
        break;
      case 'df': {
        /*
         * The virtual FS is in localStorage, whose real ceiling is the device quota --
         * not the 8.0G the old output claimed, which was a number borrowed from a
         * different machine entirely (the phone's RAM size, as "disk"). Report the size
         * we can actually measure: bytes held by our own tree.
         */
        const nodes = countNodes(fs);
        out.push({ text: 'Filesystem      Size  Used  Avail  Use%' });
        out.push({ text: `nova-vfs        ${nodes} nodes   (localStorage)`, cls: 'ok' });
        out.push({ text: 'tmpfs           0   -- not emulated', cls: 'dim' });
        break;
      }
      case 'free': {
        /*
         * `free` used to print "Mem: 8192M 2416M ..." -- the phone's RAM, as reported by
         * a constant. The guest is a virtual machine with a memory size of its own, and
         * that number IS known: it is in the machine's own descriptor.
         */
        const img =
          BUILTIN_IMAGES.find((i) => i.id === activeImageId) ??
          userImages.find((i) => i.id === activeImageId);
        const mb = img?.memoryMB ?? 32;
        out.push({ text: '              total   used   free', cls: 'dim' });
        out.push({ text: `Mem:          ${mb}M   (الضيف لا يفصح)   --` });
        out.push({ text: `${img?.name ?? 'NovaDesk'} · الضيف المُحاكى`, cls: 'dim' });
        out.push({ text: 'ذاكرة الهاتف نفسها لا تُقاس من تطبيق ويب', cls: 'dim' });
        break;
      }
      case 'uname':
        out.push({
          text:
            args.includes('-a')
              ? `NovaOS nova.local 1.0.0-nova-core #1 SMP PREEMPT ${new Date().toUTCString()} aarch64 GNU/Nova`
              : 'NovaOS',
        });
        break;
      case 'neofetch':
        out.push({ text: '        /\\        ' + `${user}@nova`, cls: 'hi' });
        out.push({ text: '       /  \\       ' + '------------------', cls: 'hi' });
        out.push({ text: '      / /\\ \\      ' + 'OS: NovaOS 1.0.0' });
        out.push({ text: '     / ____ \\     ' + 'Kernel: nova-core 1.0.0' });
        out.push({ text: '    /_/    \\_\\    ' + 'Shell: nova-sh' });
        out.push({ text: '                  ' + `WM: nova-wm · windows ${useOS.getState().windows.length}` });
        out.push({ text: '                  ' + `Notes: ${notes.length} · Uptime: ${uptime()}` });
        out.push({ text: '                  ' + `Theme: ${settings.theme} · Accent: ${settings.accent}` });
        break;
      case 'date':
        out.push({ text: new Date().toString() });
        break;
      case 'whoami':
        out.push({ text: user });
        break;
      case 'notify':
        if (!arg) out.push({ text: 'notify: نص فارغ', cls: 'err' });
        else {
          notify({ app: 'terminal', title: 'الطرفية', body: arg });
          out.push({ text: 'أُرسل الإشعار', cls: 'ok' });
        }
        break;
      case 'wallpaper':
        if (!arg) out.push({ text: 'wallpaper: استخدم معرفًا مثل nebula أو aurora أو dune', cls: 'err' });
        else {
          patch({ wallpaper: arg });
          out.push({ text: `الخلفية الآن: ${arg}`, cls: 'ok' });
        }
        break;
      case 'theme':
        if (arg !== 'dark' && arg !== 'light') out.push({ text: 'theme: dark أو light', cls: 'err' });
        else {
          patch({ theme: arg });
          out.push({ text: `السمة: ${arg}`, cls: 'ok' });
        }
        break;
      case 'open': {
        const valid = ['files', 'notes', 'terminal', 'calc', 'gallery', 'monitor', 'settings', 'about'];
        if (!valid.includes(arg)) out.push({ text: `open: تطبيق غير معروف: ${arg}`, cls: 'err' });
        else {
          open({ appId: arg as never });
          out.push({ text: `يُفتح ${arg}…`, cls: 'ok' });
        }
        break;
      }
      case 'apps':
        out.push({ text: ['files', 'notes', 'terminal', 'calc', 'gallery', 'monitor', 'settings', 'about'].join('   ') });
        break;
      case 'clear':
        setLines([]);
        return;
      case 'lock':
        lock();
        return;
      case 'reboot':
        restart();
        return;
      case 'poweroff':
      case 'shutdown':
        shutdown();
        return;
      default:
        out.push({ text: `${cmd}: أمر غير معروف. اكتب help.`, cls: 'err' });
    }
    setLines((l) => [...l, ...out, { text: '' }]);
  };

  const submit = () => {
    const value = input;
    setInput('');
    if (value.trim()) {
      setHistory((h) => [value, ...h].slice(0, 60));
      setHistIdx(-1);
    }
    run(value);
  };

  return (
    <div className="term" onClick={() => inputRef.current?.focus()}>
      <div className="term-scroll" ref={scrollRef}>
        {lines.map((l, i) => (
          <div key={i} className={cx('term-line', l.cls)}>
            {l.text || '\u00A0'}
          </div>
        ))}
      </div>
      <div className="term-input-row">
        <span className="term-prompt">{prompt} $</span>
        <input
          ref={inputRef}
          className="term-input"
          value={input}
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              const next = Math.min(histIdx + 1, history.length - 1);
              if (next >= 0) {
                setHistIdx(next);
                setInput(history[next]);
              }
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              const next = histIdx - 1;
              setHistIdx(next);
              setInput(next >= 0 ? history[next] : '');
            } else if (e.key === 'Tab') {
              e.preventDefault();
              const node = nodeAt(fs, cwd);
              const partial = input.split(/\s+/).pop() ?? '';
              const match =
                node && node.type === 'dir'
                  ? node.children.find((c) => c.name.startsWith(partial) && partial.length > 0)
                  : undefined;
              if (match) {
                const tokens = input.split(/\s+/);
                tokens[tokens.length - 1] = match.name;
                setInput(tokens.join(' '));
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function sumSize(dir: FSNode): number {
  if (dir.type === 'file') return dir.content.length;
  return dir.children.reduce((acc, c) => acc + sumSize(c), 0);
}

function countNodes(dir: FSNode): number {
  if (dir.type === 'file') return 1;
  return 1 + dir.children.reduce((a, c) => a + countNodes(c), 0);
}

function uptime() {
  const ms = Date.now() - (useOS.getState().bootAt || Date.now()) + BOOT_DURATION;
  const m = Math.floor(ms / 60000);
  return m < 1 ? 'أقل من دقيقة' : `${m} دقيقة`;
}

export { COMMANDS };
