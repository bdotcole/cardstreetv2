import React, { useState } from 'react';
import { Card } from '../types';
import { CURRENCY_SYMBOLS } from '@/constants';

interface BuylistRequestProps {
    card: Card;
    onClose: () => void;
    currency?: string;
    exchangeRate?: number;
}

const BuylistRequest: React.FC<BuylistRequestProps> = ({
    card,
    onClose,
    currency = 'THB',
    exchangeRate = 1
}) => {
    const [condition, setCondition] = useState('NM');
    const [maxPrice, setMaxPrice] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [notifyMe, setNotifyMe] = useState(true);
    const [submitted, setSubmitted] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const currencySymbol = CURRENCY_SYMBOLS[currency] || currency;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch('/api/buylist', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    card,
                    condition,
                    maxPrice,
                    quantity,
                    notifyMe,
                    currency
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 401) {
                    setError('Please sign in to add items to your buylist.');
                } else {
                    setError(data.error || 'สร้างรายการขอซื้อไม่สำเร็จ');
                }
                setIsLoading(false);
                return;
            }

            // Success!
            setSubmitted(true);

            // Close after showing success message
            setTimeout(() => {
                onClose();
            }, 2000);

        } catch (err) {
            console.error('Error submitting buylist request:', err);
            setError('Network error. Please check your connection and try again.');
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex flex-col bg-brand-darker animate-slideUp">
            {/* Header */}
            <div className="px-6 pb-6 flex justify-between items-center sticky top-0 z-10 bg-brand-darker/80 backdrop-blur-lg border-b border-white/5" style={{ paddingTop: 'calc(1.5rem + var(--sat))' }}>
                <button
                    onClick={onClose}
                    className="w-10 h-10 flex items-center justify-center rounded-xl bg-white/5 active:bg-brand-cyan active:text-brand-darker transition-all border border-white/5"
                >
                    <i className="fa-solid fa-chevron-left text-sm"></i>
                </button>
                <div className="text-center">
                    <span className="font-black italic skew-x-[-10deg] uppercase tracking-wider text-xs text-brand-cyan block">รายการขอซื้อ</span>
                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">ไม่มีรายการวางขาย</span>
                </div>
                <div className="w-10"></div>
            </div>

            <div className="flex-1 overflow-y-auto pb-40 scrollbar-hide bg-dots">
                <div className="p-6 space-y-6">
                    {!submitted ? (
                        <>
                            {/* Card Preview */}
                            <div className="flex items-center gap-4 bg-white/[0.03] p-4 rounded-xl border border-white/5">
                                <img
                                    src={card.imageUrl}
                                    alt={card.name}
                                    className="w-20 h-28 object-cover rounded-lg shadow-lg"
                                />
                                <div className="flex-1">
                                    <h3 className="text-white font-black text-lg leading-tight">{card.name}</h3>
                                    <p className="text-slate-400 text-xs font-bold mt-1">{card.thaiName}</p>
                                    <div className="flex items-center gap-2 mt-2">
                                        <span className="bg-brand-cyan text-brand-darker px-2 py-0.5 rounded text-[9px] font-black uppercase italic skew-x-[-10deg]">{card.rarity}</span>
                                        <span className="text-slate-500 text-[10px] font-bold">{card.set}</span>
                                    </div>
                                </div>
                            </div>

                            {/* No Listings Message */}
                            <div className="bg-gradient-to-br from-brand-red/10 to-brand-red/5 border border-brand-red/20 rounded-xl p-4">
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                        <i className="fa-solid fa-store-slash text-brand-red"></i>
                                    </div>
                                    <div>
                                        <h4 className="text-white font-black text-sm mb-1">ไม่มีรายการวางขายในขณะนี้</h4>
                                        <p className="text-slate-400 text-xs leading-relaxed">
                                            ขออภัย ขณะนี้ยังไม่มีสินค้านี้ในตลาด กรุณาเพิ่มสินค้าลงในรายการขอซื้อ แล้วเราจะแจ้งเตือนผู้ขายให้คุณ
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Request Form */}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* Condition */}
                                <div className="space-y-2">
                                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                                        สภาพที่ต้องการ
                                    </label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {['M', 'NM', 'LP', 'MP'].map((cond) => (
                                            <button
                                                key={cond}
                                                type="button"
                                                onClick={() => setCondition(cond)}
                                                className={`py-3 rounded-lg font-black text-xs uppercase tracking-wider transition-all ${condition === cond
                                                    ? 'bg-brand-cyan text-brand-darker shadow-lg shadow-brand-cyan/20'
                                                    : 'bg-white/5 text-slate-400 hover:bg-white/10 border border-white/5'
                                                    }`}
                                            >
                                                {cond}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Max Price */}
                                <div className="space-y-2">
                                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                                        ราคาสูงสุด ({currencySymbol})
                                    </label>
                                    <input
                                        type="number"
                                        value={maxPrice}
                                        onChange={(e) => setMaxPrice(e.target.value)}
                                        placeholder="Enter max price"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:border-brand-cyan focus:outline-none transition-colors"
                                        required
                                    />
                                </div>

                                {/* Quantity */}
                                <div className="space-y-2">
                                    <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                                        จำนวนที่ต้องการ
                                    </label>
                                    <input
                                        type="number"
                                        value={quantity}
                                        onChange={(e) => setQuantity(e.target.value)}
                                        min="1"
                                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:border-brand-cyan focus:outline-none transition-colors"
                                        required
                                    />
                                </div>

                                {/* Notification Toggle */}
                                <div className="flex items-center justify-between bg-white/[0.03] p-4 rounded-xl border border-white/5">
                                    <div>
                                        <p className="text-white font-bold text-sm">แจ้งเตือนเมื่อมีสินค้า</p>
                                        <p className="text-slate-500 text-xs mt-0.5">รับการแจ้งเตือนเมื่อการ์ดพร้อมวางขาย</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setNotifyMe(!notifyMe)}
                                        className={`w-12 h-7 rounded-full transition-all relative ${notifyMe ? 'bg-brand-green' : 'bg-slate-700'
                                            }`}
                                    >
                                        <div className={`w-5 h-5 bg-white rounded-full absolute top-1 transition-all shadow-lg ${notifyMe ? 'left-6' : 'left-1'
                                            }`}></div>
                                    </button>
                                </div>

                                {/* Error Alert */}
                                {error && (
                                    <div className="bg-gradient-to-br from-brand-red/10 to-brand-red/5 border border-brand-red/20 rounded-xl p-4">
                                        <div className="flex items-start gap-3">
                                            <div className="w-8 h-8 rounded-full bg-brand-red/20 flex items-center justify-center flex-shrink-0">
                                                <i className="fa-solid fa-exclamation text-brand-red text-sm"></i>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-white font-bold text-xs mb-0.5">ข้อผิดพลาด</p>
                                                <p className="text-slate-400 text-xs leading-relaxed">{error}</p>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Submit Button */}
                                <button
                                    type="submit"
                                    disabled={isLoading}
                                    className={`w-full h-14 bg-gradient-to-r from-brand-cyan to-brand-green text-brand-darker font-black text-sm tracking-wider rounded-xl shadow-lg shadow-brand-cyan/20 hover:shadow-brand-cyan/40 transition-all uppercase flex items-center justify-center gap-2 ${isLoading ? 'opacity-50 cursor-not-allowed' : 'active:scale-95'
                                        }`}
                                >
                                    {isLoading ? (
                                        <>
                                            <div className="animate-spin h-5 w-5 border-3 border-brand-darker/20 border-t-brand-darker rounded-full"></div>
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <i className="fa-solid fa-list-check"></i>
                                            เพิ่มลงรายการขอซื้อ
                                        </>
                                    )}
                                </button>
                            </form>
                        </>
                    ) : (
                        /* Success State */
                        <div className="py-16 text-center animate-fadeIn">
                            <div className="w-20 h-20 bg-brand-green/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-bounce">
                                <i className="fa-solid fa-check text-brand-green text-3xl"></i>
                            </div>
                            <h3 className="text-white font-black text-2xl mb-2">Request Added!</h3>
                            <p className="text-slate-400 text-sm">
                                We'll notify sellers and alert you when<br />this card becomes available.
                            </p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default BuylistRequest;
