import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { GAMES } from '@/lib/games';

interface GamePickerProps {
  onBack: () => void;
  onSelectGame: (gameId: string) => void;
}

// First step of the Master Set flow: choose the trading-card game. Mirrors the
// visual language of MasterSetPicker (the region step) so the two steps feel like
// one flow. Games without data yet (registry enabled=false) render dimmed and
// non-interactive instead of being hidden, so users can see what's coming.
const GamePicker: React.FC<GamePickerProps> = ({ onBack, onSelectGame }) => {
  const { isThai } = useTranslation();

  return (
    <div className="space-y-8 animate-fadeIn pb-20">
      <div className="flex items-center gap-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{isThai ? 'มาสเตอร์เซ็ต' : 'Master Sets'}</h3>
      </div>

      <div className="space-y-2 px-2">
        <h2 className="text-3xl font-black text-white italic skew-x-[-10deg] uppercase tracking-tighter">{isThai ? 'เลือกเกม' : 'Select Game'}</h2>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">{isThai ? 'เลือกเกมการ์ดของคุณ' : 'Choose your card game'}</p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {GAMES.map((game) => (
          <button
            key={game.id}
            disabled={!game.enabled}
            onClick={() => game.enabled && onSelectGame(game.id)}
            className={`relative h-48 rounded-[2.5rem] overflow-hidden group transition-all shadow-2xl ${game.enabled ? 'active:scale-95' : 'opacity-40 cursor-not-allowed'}`}
          >
            {/* Background */}
            <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`}></div>

            {/* Pattern Overlay */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-black via-transparent to-transparent"></div>

            {/* Content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10">
              <div className="h-20 w-full flex items-center justify-center mb-4 drop-shadow-xl transform group-hover:scale-110 transition-transform duration-500">
                {game.logoUrl ? (
                  <img
                    src={game.logoUrl}
                    alt={game.name}
                    className="h-full w-auto object-contain"
                    onError={(e) => {
                      // Fall back to the game name if the remote logo fails to load.
                      const img = e.currentTarget;
                      img.style.display = 'none';
                      const label = img.nextElementSibling as HTMLElement | null;
                      if (label) label.style.display = 'flex';
                    }}
                  />
                ) : null}
                <span
                  className={`h-full w-full items-center justify-center text-2xl font-black uppercase tracking-tight ${game.textColor}`}
                  style={{ display: game.logoUrl ? 'none' : 'flex' }}
                >
                  {game.name}
                </span>
              </div>

              <div className="flex items-center gap-3 px-4 py-1.5 rounded-full backdrop-blur-md bg-white/20 border border-white/20 shadow-lg">
                <span className={`text-[10px] font-black uppercase tracking-widest ${game.textColor}`}>
                  {game.enabled ? game.shortName : (isThai ? 'เร็วๆ นี้' : 'Coming Soon')}
                </span>
              </div>
            </div>

            {/* Hover Shine */}
            {game.enabled && (
              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out"></div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
};

export default GamePicker;
