import { create } from 'zustand';

export type GameMode = 'exploration' | 'combat';

interface Stats {
  hp: number;
  maxHp: number;
  qi: number;
  maxQi: number;
  speed: number;
  attack: number;
  defense: number;
  level: number;
  cultivationBase: string;
}

interface Character {
  id: string;
  name: string;
  stats: Stats;
  element: 'Fire' | 'Water' | 'Earth' | 'Wood' | 'Gold';
  skills: Skill[];
}

interface Skill {
  id: string;
  name: string;
  cost: number;
  damage: number;
  effect?: string;
  element: 'Fire' | 'Water' | 'Earth' | 'Wood' | 'Gold' | 'Neutral';
}

interface GameState {
  mode: GameMode;
  player: Character;
  enemies: Character[];
  inventory: any[];

  // Actions
  setMode: (mode: GameMode) => void;
  updatePlayerStats: (stats: Partial<Stats>) => void;
  startCombat: (enemies: Character[]) => void;
  endCombat: () => void;
}

const initialPlayer: Character = {
  id: 'player',
  name: 'Cultivator',
  element: 'Fire',
  stats: {
    hp: 100,
    maxHp: 100,
    qi: 50,
    maxQi: 50,
    speed: 10,
    attack: 15,
    defense: 5,
    level: 1,
    cultivationBase: 'Qi Condensation I',
  },
  skills: [
    { id: 'basic_atk', name: 'Basic Strike', cost: 0, damage: 10, element: 'Neutral' },
    { id: 'fire_ball', name: 'Fire Ball', cost: 10, damage: 25, element: 'Fire' },
  ],
};

export const useGameStore = create<GameState>((set) => ({
  mode: 'exploration',
  player: initialPlayer,
  enemies: [],
  inventory: [],

  setMode: (mode) => set({ mode }),
  updatePlayerStats: (newStats) =>
    set((state) => ({
      player: {
        ...state.player,
        stats: { ...state.player.stats, ...newStats },
      },
    })),
  startCombat: (enemies) => set({ mode: 'combat', enemies }),
  endCombat: () => set({ mode: 'exploration', enemies: [] }),
}));
