
import React from 'react';
import { Card } from '../types';

interface ScanCandidateModalProps {
  candidates: Card[];
  onSelect: (card: Card) => void;
  onCancel: () => void;
}

const ScanCandidateModal: React.FC<ScanCandidateModalProps> = ({ candidates, onSelect, onCancel }) => {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-[#121212]/95 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-[400px] glass rounded-[2.5rem] border-white/10 p-8 flex flex-col max-h-[80vh]">
        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-brand-cyan/10 flex items-center justify-center mx-auto mb-4">
            <i className="fa-solid fa-question text-brand-cyan"></i>
          </div>
          <h3 className="text-xl font-black text-white tracking-tight uppercase italic skew-x-[-10deg]">Multiple Matches</h3>
          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Select the exact version you scanned</p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-hide">
          {candidates.map((card) => (
            <button
              key={card.id}
              onClick={() => onSelect(card)}
              className="w-full glass p-4 rounded-3xl border-white/5 flex items-center gap-4 text-left active:scale-95 transition-all group"
            >
              <div className="w-14 h-20 rounded-xl overflow-hidden bg-white/5 flex-shrink-0">
                <img src={card.imageUrl} alt={card.name} className="w-full h-full object-contain" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-bold truncate group-hover:text-brand-cyan">{card.name}</p>
                <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mt-0.5">{card.set}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[8px] bg-white/10 text-slate-400 px-2 py-0.5 rounded-full">{card.rarity}</span>
                  <span className="text-[8px] text-slate-600">#{card.number}</span>
                </div>
              </div>
            </button>
          ))}
        </div>

        <button 
          onClick={onCancel}
          className="mt-6 w-full h-12 rounded-2xl glass border-white/10 text-slate-500 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all hover:text-white"
        >
          Cancel Scan
        </button>
      </div>
    </div>
  );
};

export default ScanCandidateModal;
