import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/useGameStore';

export const EnemyEncounter = ({ position }: { position: [number, number, number] }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const { startCombat, mode } = useGameStore();
  const playerPos = new THREE.Vector3();

  useFrame((state) => {
    if (!meshRef.current || mode !== 'exploration') return;

    // Animation
    meshRef.current.rotation.y += 0.01;
    meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.2;

    // Proximity check
    const player = state.scene.getObjectByName('player_group');
    if (player) {
      player.getWorldPosition(playerPos);
      const distance = playerPos.distanceTo(meshRef.current.position);

      if (distance < 2) {
        startCombat([{
          id: 'demon_1',
          name: 'Shadow Demon',
          element: 'Water',
          stats: {
            hp: 50, maxHp: 50, qi: 20, maxQi: 20,
            speed: 8, attack: 12, defense: 3, level: 1, cultivationBase: 'Qi Condensation I'
          },
          skills: []
        }]);
      }
    }
  });

  return (
    <mesh ref={meshRef} position={position} castShadow>
      <octahedronGeometry args={[0.6]} />
      <meshStandardMaterial color="#ff4444" emissive="#440000" />
    </mesh>
  );
};
