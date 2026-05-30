import { Canvas } from '@react-three/fiber';
import { useState } from 'react';
import { Player } from './Player';
import { Environment } from './Environment';
import { Joystick } from '../ui/Joystick';

export const ExplorationScene = () => {
  const [joystickData, setJoystickData] = useState<{ x: number; y: number; distance: number } | null>(null);

  return (
    <div className="w-full h-full relative">
      <Canvas shadows>
        <Environment />
        <Player joystickData={joystickData} />
      </Canvas>

      <Joystick
        onMove={(data) => setJoystickData({ x: data.vector.x, y: data.vector.y, distance: data.distance })}
        onEnd={() => setJoystickData(null)}
      />

      {/* Exploration UI Overlay */}
      <div className="absolute top-4 left-4 p-4 bg-black/40 rounded-lg text-white pointer-events-none border border-white/20">
        <h2 className="text-xl font-bold">Cultivator World</h2>
        <p className="text-sm opacity-80">Use the joystick to move around</p>
      </div>
    </div>
  );
};
