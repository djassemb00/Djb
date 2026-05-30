import { Sky, Stars } from '@react-three/drei';
import { EnemyEncounter } from './EnemyEncounter';
import { Pagoda } from './Pagoda';

export const Environment = () => {
  return (
    <>
      <Sky sunPosition={[100, 20, 100]} />
      <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, 20, 10]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#2d3a1d" />
      </mesh>

      {/* Decorative elements (mountains/rocks) */}
      {[...Array(20)].map((_, i) => (
        <mesh
          key={i}
          position={[
            Math.random() * 80 - 40,
            0,
            Math.random() * 80 - 40
          ]}
          rotation={[0, Math.random() * Math.PI, 0]}
        >
          <coneGeometry args={[1 + Math.random() * 3, 2 + Math.random() * 5, 4]} />
          <meshStandardMaterial color="#4a4a4a" />
        </mesh>
      ))}

      {/* Grid helper for spatial reference */}
      <gridHelper args={[100, 50, '#555', '#333']} position={[0, 0.01, 0]} />

      {/* Buildings */}
      <Pagoda position={[-15, 0, -10]} />
      <Pagoda position={[15, 0, -20]} rotation={[0, Math.PI / 6, 0]} />

      {/* Enemies */}
      <EnemyEncounter position={[5, 1, 5]} />
      <EnemyEncounter position={[-10, 1, -5]} />
      <EnemyEncounter position={[0, 1, -15]} />
    </>
  );
};
