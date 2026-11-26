import type { AppMeta } from '../system/apps';
import { cx } from '../system/cx';

export function AppIcon({
  app,
  size = 'md',
  className,
}: {
  app: AppMeta;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = app.icon;
  return (
    <div
      className={cx('app-tile', size !== 'md' && size, className)}
      style={{
        background: `linear-gradient(150deg, ${app.from}, ${app.to})`,
      }}
    >
      <Icon strokeWidth={1.9} />
    </div>
  );
}
