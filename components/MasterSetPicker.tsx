
import React from 'react';

interface MasterSetPickerProps {
  onBack: () => void;
  onSelectGame: (gameId: string) => void;
}

const GAMES = [
  {
    id: 'pokemon-en',
    title: 'Pokémon TCG',
    region: 'English',
    gradient: 'from-[#FFCB05] to-[#c79d00]', // Pokemon Yellow
    textColor: 'text-[#3c5aa6]', // Pokemon Blue
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg',
    flagUrl: 'https://flagcdn.com/w80/us.png',
    accent: 'bg-[#3c5aa6]',
  },
  {
    id: 'pokemon-jp',
    title: 'Pokémon TCG',
    region: 'Japanese',
    gradient: 'from-[#e2e8f0] to-[#cbd5e1]', // Silver/White
    textColor: 'text-[#121212]',
    // Switched to International logo as the specific Japanese PNG was not loading reliably
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg',
    flagUrl: 'https://flagcdn.com/w80/jp.png',
    accent: 'bg-[#ef4444]',
  },
  {
    id: 'pokemon-th',
    title: 'Pokémon TCG',
    region: 'Thai',
    gradient: 'from-[#1e293b] to-[#0f172a]', // Dark Blue (CardStreet)
    textColor: 'text-white',
    logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/9/98/International_Pok%C3%A9mon_logo.svg',
    flagUrl: 'https://flagcdn.com/w80/th.png',
    accent: 'bg-[#06b6d4]', // Cyan
  }
];

const MasterSetPicker: React.FC<MasterSetPickerProps> = ({ onBack, onSelectGame }) => {
  return (
    <div className="space-y-8 animate-fadeIn pb-20">
       <div className="flex items-center gap-4 pt-4">
        <button onClick={onBack} className="w-10 h-10 rounded-xl glass border-white/10 flex items-center justify-center active:scale-90 transition-all">
          <i className="fa-solid fa-chevron-left text-slate-500 text-xs"></i>
        </button>
        <h3 className="text-white text-xl font-black uppercase tracking-tight italic skew-x-[-10deg]">Master Sets</h3>
      </div>

      <div className="space-y-2 px-2">
         <h2 className="text-3xl font-black text-white italic skew-x-[-10deg] uppercase tracking-tighter">Select Region</h2>
         <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Choose your registry database</p>
      </div>

      <div className="grid grid-cols-1 gap-5">
        {GAMES.map((game) => (
           <button
             key={game.id}
             onClick={() => onSelectGame(game.id)}
             className={`relative h-48 rounded-[2.5rem] overflow-hidden group active:scale-95 transition-all shadow-2xl`}
           >
             {/* Background */}
             <div className={`absolute inset-0 bg-gradient-to-br ${game.gradient}`}></div>
             
             {/* Pattern Overlay */}
             <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-black via-transparent to-transparent"></div>
             
             {/* Content */}
             <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10">
                <div className="h-20 w-full flex items-center justify-center mb-4 drop-shadow-xl transform group-hover:scale-110 transition-transform duration-500">
                   <img src={game.logoUrl} alt={game.title} className="h-full w-auto object-contain" />
                </div>
                
                <div className={`flex items-center gap-3 px-4 py-1.5 rounded-full backdrop-blur-md bg-white/20 border border-white/20 shadow-lg`}>
                   <img src={game.flagUrl} alt={game.region} className="w-6 h-4 object-cover rounded shadow-sm" />
                   <span className={`text-[10px] font-black uppercase tracking-widest ${game.id === 'pokemon-th' ? 'text-white' : 'text-slate-800'}`}>
                     {game.region}
                   </span>
                </div>
             </div>

             {/* Hover Shine */}
             <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/20 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700 ease-in-out"></div>
           </button>
        ))}
        
        {/* Coming Soon */}
        <div className="h-32 rounded-[2.5rem] border-2 border-dashed border-white/10 flex flex-col items-center justify-center gap-2 opacity-30 bg-white/[0.02]">
           <i className="fa-solid fa-plus text-2xl text-slate-600"></i>
           <span className="text-[9px] text-slate-600 font-black uppercase tracking-widest">More Regions Soon</span>
        </div>
      </div>
    </div>
  );
};

export default MasterSetPicker;
