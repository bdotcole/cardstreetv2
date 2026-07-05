
import React from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';
import { getGame, getGameLanguages, GameLanguageCode } from '@/lib/games';

interface MasterSetPickerProps {
  onBack: () => void;
  onSelectGame: (regionId: string) => void;
  /** Which game's regions to show (only multi-language games reach this step). */
  game?: string;
}

// Per-language card styling so each region reads at a glance.
const REGION_STYLE: Record<GameLanguageCode, { gradient: string; text: string; chipText: string }> = {
  en: { gradient: 'from-[#FFCB05] to-[#c79d00]', text: 'text-[#3c5aa6]', chipText: 'text-[#1e293b]' },
  jp: { gradient: 'from-[#e2e8f0] to-[#cbd5e1]', text: 'text-[#3c5aa6]', chipText: 'text-[#1e293b]' },
  th: { gradient: 'from-slate-800 to-slate-900', text: 'text-white', chipText: 'text-white' },
};

const MasterSetPicker: React.FC<MasterSetPickerProps> = ({ onBack, onSelectGame, game = 'pokemon' }) => {
  const { isThai } = useTranslation();
  const gameConfig = getGame(game);
  const languages = getGameLanguages(game);

  return (
    <div className="space-y-8 animate-fadeIn pb-20">
      <div className="flex items-center gap-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">{isThai ? 'มาสเตอร์เซ็ต' : 'Master Sets'}</h3>
      </div>

      <div className="space-y-2 px-2">
        <h2 className="text-3xl font-black text-white italic skew-x-[-10deg] uppercase tracking-tighter">{isThai ? 'เลือกภูมิภาค' : 'Select Region'}</h2>
        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">{isThai ? 'เลือกฐานข้อมูลของคุณ' : 'Choose your registry database'}</p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {languages.map((lang) => {
          const style = REGION_STYLE[lang.code];
          return (
            <button
              key={lang.code}
              onClick={() => onSelectGame(`${game}-${lang.code}`)}
              className="relative h-48 rounded-[2.5rem] overflow-hidden group active:scale-95 transition-all shadow-2xl"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${style.gradient}`}></div>
              <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-black via-transparent to-transparent"></div>

              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10">
                <div className="h-20 w-full flex items-center justify-center mb-4 drop-shadow-xl transform group-hover:scale-110 transition-transform duration-500">
                  {gameConfig.logoUrl ? (
                    <img src={gameConfig.logoUrl} alt={gameConfig.name} className="h-full w-auto object-contain" />
                  ) : (
                    <span className={`text-2xl font-black uppercase ${style.text}`}>{gameConfig.name}</span>
                  )}
                </div>

                <div className="flex items-center gap-3 px-4 py-1.5 rounded-full backdrop-blur-md bg-white/20 border border-white/20 shadow-lg">
                  <img src={lang.flagUrl} alt={lang.label} className="w-6 h-4 object-cover rounded shadow-sm" />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${style.chipText}`}>{lang.label}</span>
                </div>
              </div>

              <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out"></div>
            </button>
          );
        })}

        <div className="h-32 rounded-[2.5rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 opacity-30 bg-white/[0.02]">
          <i className="fa-solid fa-plus text-2xl text-slate-600"></i>
          <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">{isThai ? 'ภูมิภาคอื่นๆ เร็วๆ นี้' : 'More Regions Soon'}</span>
        </div>
      </div>
    </div>
  );
};

export default MasterSetPicker;
