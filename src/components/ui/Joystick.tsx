import React, { useEffect, useRef } from 'react';
import nipplejs from 'nipplejs';

interface JoystickProps {
  onMove: (data: { vector: { x: number; y: number }; distance: number }) => void;
  onEnd: () => void;
}

export const Joystick: React.FC<JoystickProps> = ({ onMove, onEnd }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const manager = nipplejs.create({
      zone: containerRef.current,
      mode: 'static',
      position: { left: '80px', bottom: '80px' },
      color: 'white',
      size: 100,
    });

    (manager as any).on('move', (_: any, data: any) => {
      onMove({
        vector: { x: data.vector.x, y: data.vector.y },
        distance: data.distance / 50, // Normalize to 0-1
      });
    });

    manager.on('end', () => {
      onEnd();
    });

    return () => manager.destroy();
  }, [onMove, onEnd]);

  return (
    <div
      ref={containerRef}
      className="fixed bottom-0 left-0 w-48 h-48 pointer-events-auto touch-none"
      style={{ zIndex: 1000 }}
    />
  );
};
