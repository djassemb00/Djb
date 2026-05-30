import { useGameStore } from './store/useGameStore';
import { ExplorationScene } from './components/exploration/ExplorationScene';
import { CombatScene } from './components/combat/CombatScene';

function App() {
  const mode = useGameStore((state) => state.mode);

  return (
    <div className="w-full h-screen bg-slate-900 overflow-hidden">
      {mode === 'exploration' ? (
        <ExplorationScene />
      ) : (
        <CombatScene />
      )}
    </div>
  );
}

export default App;
