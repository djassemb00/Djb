import { Canvas } from '@react-three/fiber';
import { Stage, OrbitControls } from '@react-three/drei';
import { CombatUI } from './CombatUI';

export const CombatScene = () => {
  return (
    <div className="w-full h-full relative bg-black">
      <Canvas shadows camera={{ position: [0, 5, 10], fov: 40 }}>
        <color attach="background" args={['#1a1a2e']} />
        <fog attach="fog" args={['#1a1a2e', 5, 20]} />

        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} intensity={1.5} />

        <Stage intensity={0.5} environment="city" adjustCamera={false}>
          {/* Player in combat */}
          <mesh position={[-2, 0, 0]} castShadow>
             <boxGeometry args={[1, 2, 1]} />
             <meshStandardMaterial color="#3b82f6" />
          </mesh>

          {/* Enemy in combat */}
          <mesh position={[2, 0, 0]} castShadow>
             <octahedronGeometry args={[1.2]} />
             <meshStandardMaterial color="#ef4444" />
          </mesh>
        </Stage>

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.1, 0]} receiveShadow>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#16213e" />
        </mesh>

        <OrbitControls enableZoom={false} enablePan={false} minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2} />
      </Canvas>

      <CombatUI />
    </div>
  );
};
