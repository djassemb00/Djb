export const Pagoda = ({ position, rotation }: { position: [number, number, number], rotation?: [number, number, number] }) => {
  // Using a simple placeholder for now as downloading actual assets requires internet/specific URLs
  // but structuring it so it's easy to swap.
  return (
    <group position={position} rotation={rotation}>
      {/* Base */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[4, 1, 4]} />
        <meshStandardMaterial color="#5c4033" />
      </mesh>
      {/* Middle */}
      <mesh position={[0, 1.5, 0]}>
        <boxGeometry args={[3, 1, 3]} />
        <meshStandardMaterial color="#8b4513" />
      </mesh>
      {/* Top */}
      <mesh position={[0, 2.5, 0]}>
        <boxGeometry args={[2, 1, 2]} />
        <meshStandardMaterial color="#a0522d" />
      </mesh>
      {/* Roof */}
      <mesh position={[0, 3.5, 0]} rotation={[0, Math.PI / 4, 0]}>
        <coneGeometry args={[2.5, 1, 4]} />
        <meshStandardMaterial color="#2f4f4f" />
      </mesh>
    </group>
  );
};
