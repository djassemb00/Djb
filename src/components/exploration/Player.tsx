import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';

interface PlayerProps {
  joystickData: { x: number; y: number; distance: number } | null;
}

export const Player = ({ joystickData }: PlayerProps) => {
  const meshRef = useRef<THREE.Group>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const speed = 5;

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    const moveDirection = new THREE.Vector3();

    if (joystickData && joystickData.distance > 0.1) {
      // Invert Y because screen space vs 3D space
      moveDirection.set(joystickData.x, 0, -joystickData.y);
    }

    if (moveDirection.length() > 0) {
      moveDirection.normalize();

      // Calculate rotation to face movement direction
      const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(
        meshRef.current.rotation.y,
        targetRotation,
        0.1
      );

      // Move player
      meshRef.current.position.add(
        moveDirection.multiplyScalar(speed * delta * (joystickData?.distance || 1))
      );
    }

    // Camera follow logic
    if (cameraRef.current) {
        const targetPos = meshRef.current.position.clone();
        const cameraOffset = new THREE.Vector3(0, 10, 10);
        cameraRef.current.position.lerp(targetPos.add(cameraOffset), 0.1);
        cameraRef.current.lookAt(meshRef.current.position);
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault fov={50} />
      <group ref={meshRef} name="player_group">
        {/* Simple Xianxia placeholder: A cylinder for the body and a sphere for the head */}
        <mesh position={[0, 1, 0]} castShadow>
          <cylinderGeometry args={[0.4, 0.4, 1.6, 8]} />
          <meshStandardMaterial color="#3b82f6" />
        </mesh>
        <mesh position={[0, 2, 0]} castShadow>
          <sphereGeometry args={[0.3, 16, 16]} />
          <meshStandardMaterial color="#fcd34d" />
        </mesh>
        {/* Forward indicator */}
        <mesh position={[0, 1.8, 0.3]}>
            <boxGeometry args={[0.1, 0.1, 0.4]} />
            <meshStandardMaterial color="red" />
        </mesh>
      </group>
    </>
  );
};
