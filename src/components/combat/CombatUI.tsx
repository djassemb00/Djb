import { useState, useEffect } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { Sword, Shield, Zap, Sparkles } from 'lucide-react';

export const CombatUI = () => {
  const { player, enemies, endCombat } = useGameStore();
  const [turn, setTurn] = useState<'player' | 'enemy'>('player');
  const [log, setLog] = useState<string[]>(['Combat started!']);
  const [enemyHp, setEnemyHp] = useState(enemies[0]?.stats.hp || 50);

  const handleAction = (type: string) => {
    if (turn !== 'player') return;

    if (type === 'attack') {
      const damage = player.stats.attack;
      setEnemyHp(prev => Math.max(0, prev - damage));
      setLog(prev => [`You deal ${damage} damage!`, ...prev]);

      if (enemyHp - damage <= 0) {
        setLog(prev => ['Victory!', ...prev]);
        setTimeout(() => endCombat(), 2000);
        return;
      }
    }

    setTurn('enemy');
  };

  useEffect(() => {
    if (turn === 'enemy' && enemyHp > 0) {
      const timer = setTimeout(() => {
        const damage = 5;
        setLog(prev => [`Enemy deals ${damage} damage!`, ...prev]);
        setTurn('player');
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [turn, enemyHp]);

  return (
    <div className="absolute inset-0 flex flex-col justify-between p-6 pointer-events-none">
      {/* Enemy Info */}
      <div className="flex justify-end items-start pt-10">
        <div className="bg-red-900/80 border-2 border-red-400 p-4 rounded-lg w-64 pointer-events-auto shadow-lg">
          <div className="flex justify-between mb-2">
            <span className="font-bold text-white uppercase">{enemies[0]?.name || 'Demon'}</span>
            <span className="text-red-200">Lv. {enemies[0]?.stats.level || 1}</span>
          </div>
          <div className="h-4 bg-gray-800 rounded-full overflow-hidden border border-red-900">
            <div
              className="h-full bg-red-500 transition-all duration-500"
              style={{ width: `${(enemyHp / (enemies[0]?.stats.maxHp || 50)) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Combat Log */}
      <div className="flex justify-center flex-grow items-center">
         <div className="bg-black/60 p-2 rounded max-h-32 overflow-hidden w-64 text-xs text-white">
            {log.slice(0, 5).map((m, i) => <div key={i} className="mb-1">{m}</div>)}
         </div>
      </div>

      {/* Player UI */}
      <div className="flex flex-col gap-4">
        {/* Player Stats */}
        <div className="bg-blue-900/80 border-2 border-blue-400 p-4 rounded-lg w-72 pointer-events-auto shadow-lg">
          <div className="flex justify-between mb-1">
            <span className="font-bold text-white uppercase">{player.name}</span>
            <span className="text-blue-200">{player.stats.cultivationBase}</span>
          </div>
          <div className="space-y-2">
             <div>
                <div className="flex justify-between text-[10px] text-white uppercase"><span>HP</span><span>{player.stats.hp}/{player.stats.maxHp}</span></div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden border border-blue-900">
                    <div className="h-full bg-green-500 w-full" />
                </div>
             </div>
             <div>
                <div className="flex justify-between text-[10px] text-white uppercase"><span>QI</span><span>{player.stats.qi}/{player.stats.maxQi}</span></div>
                <div className="h-3 bg-gray-800 rounded-full overflow-hidden border border-blue-900">
                    <div className="h-full bg-blue-400 w-full" />
                </div>
             </div>
          </div>
        </div>

        {/* Action Menu */}
        <div className="flex gap-2 pointer-events-auto">
          <button
            onClick={() => handleAction('attack')}
            disabled={turn !== 'player'}
            className="flex-1 bg-gradient-to-b from-gray-700 to-gray-900 border-2 border-gray-400 p-4 rounded-xl active:scale-95 disabled:opacity-50 text-white flex flex-col items-center gap-1 shadow-xl"
          >
            <Sword size={24} />
            <span className="text-xs font-bold uppercase">Attack</span>
          </button>
          <button
            onClick={() => handleAction('skill')}
            disabled={turn !== 'player'}
            className="flex-1 bg-gradient-to-b from-purple-700 to-purple-900 border-2 border-purple-400 p-4 rounded-xl active:scale-95 disabled:opacity-50 text-white flex flex-col items-center gap-1 shadow-xl"
          >
            <Zap size={24} />
            <span className="text-xs font-bold uppercase">Skill</span>
          </button>
          <button
             onClick={() => handleAction('defend')}
             disabled={turn !== 'player'}
             className="flex-1 bg-gradient-to-b from-yellow-700 to-yellow-900 border-2 border-yellow-400 p-4 rounded-xl active:scale-95 disabled:opacity-50 text-white flex flex-col items-center gap-1 shadow-xl"
          >
            <Shield size={24} />
            <span className="text-xs font-bold uppercase">Guard</span>
          </button>
          <button
            className="flex-1 bg-gradient-to-b from-teal-700 to-teal-900 border-2 border-teal-400 p-4 rounded-xl active:scale-95 text-white flex flex-col items-center gap-1 shadow-xl"
          >
            <Sparkles size={24} />
            <span className="text-xs font-bold uppercase">Item</span>
          </button>
        </div>
      </div>
    </div>
  );
};
