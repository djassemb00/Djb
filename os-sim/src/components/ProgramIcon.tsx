import { cx } from '../system/cx';
import type { InstalledProgram } from '../store/usePrograms';

/**
 * The tile for an installed computer program.
 *
 * Android launchers show a rounded square with the app's own artwork. A real .exe
 * almost never has artwork we can decode cheaply, so we draw one from the program's
 * name: its colour comes from a hash of the name (stable across launches), the
 * letter is the first character, and the badge shows the real format so a .com
 * program is never mistaken for a Windows one.
 */
export function ProgramIcon({
  program,
  size = 'md',
  className,
}: {
  program: InstalledProgram;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const ext = (program.fileName.split('.').pop() ?? 'exe').toUpperCase();
  const letter = (program.name.replace(/[^A-Z0-9]/gi, '')[0] ?? 'P').toUpperCase();
  const from = `hsl(${program.hue} 72% 46%)`;
  const to = `hsl(${(program.hue + 28) % 360} 68% 30%)`;

  return (
    <div
      className={cx('app-tile', 'prog-tile', size !== 'md' && size, className)}
      style={{ background: `linear-gradient(150deg, ${from}, ${to})` }}
      title={`${program.name} · ${ext}`}
    >
      <span className="prog-letter">{letter}</span>
      <span className={cx('prog-badge', ext === 'COM' && 'dos')}>{ext}</span>
      {!program.healthy && <span className="prog-broken">!</span>}
    </div>
  );
}
