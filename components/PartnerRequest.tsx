import React from 'react';

interface PartnerRequestProps {
    onApply: () => void;
}

const PartnerRequest: React.FC<PartnerRequestProps> = ({ onApply }) => {
    return (
        <div className="flex flex-col items-center justify-center min-h-[80vh] px-6 text-center animate-fadeIn relative overflow-hidden">
            {/* Background Ambience */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-brand-cyan/10 rounded-full blur-[100px]"></div>
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-brand-purple/10 rounded-full blur-[100px]"></div>

            <div className="relative z-10 space-y-8">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-cyan to-brand-purple shadow-lg shadow-brand-cyan/20 mb-4 animate-bounce-slow">
                    <i className="fa-solid fa-crown text-4xl text-brand-darker"></i>
                </div>

                <div className="space-y-2">
                    <h1 className="text-4xl font-black text-white italic skew-x-[-5deg] tracking-tighter">
                        Your Empire <br /><span className="text-transparent bg-clip-text bg-gradient-to-r from-brand-cyan to-brand-green">Starts Here.</span>
                    </h1>
                    <p className="text-slate-400 font-medium text-sm max-w-xs mx-auto leading-relaxed">
                        Bring the community together. Lower your fees. Become a Legend in the CardStreet ecosystem.
                    </p>
                </div>

                <div className="grid grid-cols-1 gap-4 w-full max-w-sm">
                    <div className="glass p-4 rounded-xl border border-white/5 flex items-center gap-4 text-left">
                        <div className="w-10 h-10 rounded-full bg-brand-green/20 flex items-center justify-center text-brand-green">
                            <i className="fa-solid fa-percent"></i>
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-sm">Lower Fees</h3>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Earn up to 2% fee rate</p>
                        </div>
                    </div>
                    <div className="glass p-4 rounded-xl border border-white/5 flex items-center gap-4 text-left">
                        <div className="w-10 h-10 rounded-full bg-brand-cyan/20 flex items-center justify-center text-brand-cyan">
                            <i className="fa-solid fa-users"></i>
                        </div>
                        <div>
                            <h3 className="font-bold text-white text-sm">Community Leader</h3>
                            <p className="text-[10px] text-slate-500 uppercase font-bold">Exclusive badge & tools</p>
                        </div>
                    </div>
                </div>

                <button
                    onClick={onApply}
                    className="w-full h-14 bg-white text-brand-darker font-black text-xs uppercase tracking-[0.2em] rounded-xl shadow-xl shadow-white/10 hover:scale-[1.02] active:scale-95 transition-all flex items-center justify-center gap-2 group"
                >
                    Recruit Collectors
                    <i className="fa-solid fa-arrow-right group-hover:translate-x-1 transition-transform"></i>
                </button>
            </div>
        </div>
    );
};

export default PartnerRequest;
