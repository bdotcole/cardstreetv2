import React, { useState } from 'react';
import { Card, CardCondition } from '@/types';
import { createClient } from '@/lib/supabase/client';
import { calculateRecommendedPrice } from '@/lib/utils/priceCalculator';

interface ListingFormProps {
  card: Card;
  initialCondition?: CardCondition;
  onClose: () => void;
  onSuccess: (data?: any) => void;
}

const ListingForm: React.FC<ListingFormProps> = ({ card, initialCondition, onClose, onSuccess }) => {
  const [price, setPrice] = useState<string>('');
  const [condition, setCondition] = useState<CardCondition>(initialCondition || CardCondition.NM);
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState('PSA');
  const [grade, setGrade] = useState('10');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recommendedPrice, setRecommendedPrice] = useState<number>(0);

  // Recalculate recommendation when inputs change
  React.useEffect(() => {
    const rec = calculateRecommendedPrice({
      basePrice: card.marketPrice,
      condition,
      isGraded,
      gradingCompany: isGraded ? gradingCompany : undefined,
      grade: isGraded ? grade : undefined
    });
    setRecommendedPrice(rec);
  }, [card.marketPrice, condition, isGraded, gradingCompany, grade]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();

    const isGuest = localStorage.getItem('cardstreet-guest') === 'true';

    // Check auth
    if (!isGuest) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError("You must be logged in to sell cards.");
        setIsSubmitting(false);
        return;
      }
    }

    try {
      if (isGuest) {
        // Mock successful submission for guest
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate delay
      } else {
        const response = await fetch('/api/listings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            card_id: card.id,
            card_data: card,
            price: parseFloat(price),
            condition,
            is_graded: isGraded,
            grading_company: isGraded ? gradingCompany : null,
            grade: isGraded ? parseFloat(grade) : null,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create listing');
        }
      }

      const listingData = {
        card_id: card.id,
        price: parseFloat(price),
        condition,
        is_graded: isGraded,
        grading_company: isGraded ? gradingCompany : null,
        grade: isGraded ? parseFloat(grade) : null,
      };

      onSuccess(listingData);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose}></div>

      <div className="relative w-full max-w-md bg-[#0f172a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-slideUp">
        {/* Header */}
        <div className="bg-brand-darker/50 p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="text-white font-black italic skew-x-[-5deg] text-lg uppercase">List for Sale</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        <div className="p-6 overflow-y-auto max-h-[80vh]">
          {/* Card Preview */}
          <div className="flex gap-4 mb-6">
            <div className="w-20 h-28 bg-brand-darker rounded-lg border border-white/10 overflow-hidden flex-shrink-0">
              <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-white font-bold truncate">{card.name}</h4>
              <p className="text-xs text-slate-400">{card.set} #{card.number}</p>
              <div className="mt-2 text-xs text-brand-green font-bold bg-brand-green/10 inline-block px-2 py-1 rounded">
                Market: ฿{card.marketPrice?.toLocaleString() || '-'}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Price Input */}
            <div>
              <div className="flex justify-between items-end mb-1.5">
                <label className="text-xs font-bold text-slate-400 uppercase">Asking Price (THB)</label>
                {recommendedPrice > 0 && (
                  <button
                    type="button"
                    onClick={() => setPrice(recommendedPrice.toString())}
                    className="text-[10px] text-brand-cyan hover:text-white font-bold uppercase transition-colors"
                  >
                    Use Recommended: ฿{recommendedPrice.toLocaleString()}
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">฿</span>
                <input
                  type="number"
                  required
                  min="1"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-8 pr-4 text-white font-bold focus:border-brand-cyan outline-none transition-colors placeholder-slate-600"
                  placeholder={recommendedPrice > 0 ? `Recommended: ${recommendedPrice.toLocaleString()}` : "0.00"}
                />
              </div>
            </div>

            {/* Condition */}
            <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Condition</label>
              <div className="grid grid-cols-3 gap-2">
                {Object.values(CardCondition).map((cond) => (
                  <button
                    key={cond}
                    type="button"
                    onClick={() => setCondition(cond)}
                    className={`h-10 rounded-lg text-xs font-bold border transition-all ${condition === cond
                      ? 'bg-brand-cyan text-brand-darker border-brand-cyan'
                      : 'bg-white/5 text-slate-400 border-white/5 hover:border-white/20'
                      }`}
                  >
                    {cond === 'Near Mint' ? 'NM' : cond === 'Lightly Played' ? 'LP' : cond.replace(' ', '')}
                  </button>
                ))}
              </div>
            </div>

            {/* Grading Toggle */}
            <div className="flex items-center gap-3 py-2">
              <button
                type="button"
                onClick={() => setIsGraded(!isGraded)}
                className={`w-12 h-6 rounded-full p-1 transition-colors ${isGraded ? 'bg-brand-cyan' : 'bg-slate-700'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform ${isGraded ? 'translate-x-6' : 'translate-x-0'}`}></div>
              </button>
              <span className="text-sm font-bold text-white">This card is professionally graded</span>
            </div>

            {isGraded && (
              <div className="grid grid-cols-2 gap-4 bg-white/5 p-4 rounded-xl border border-white/5 animate-fadeIn">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Company</label>
                  <select
                    value={gradingCompany}
                    onChange={(e) => setGradingCompany(e.target.value)}
                    className="w-full h-10 bg-brand-darker border border-white/10 rounded-lg px-2 text-white text-sm"
                  >
                    <option value="PSA">PSA</option>
                    <option value="BGS">BGS</option>
                    <option value="CGC">CGC</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Grade</label>
                  <input
                    type="number"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full h-10 bg-brand-darker border border-white/10 rounded-lg px-3 text-white text-sm"
                    max="10"
                    min="1"
                    step="0.5"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-bold flex items-center gap-2">
                <i className="fa-solid fa-circle-exclamation"></i>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-14 bg-brand-green hover:bg-brand-green/90 active:scale-[0.98] rounded-xl text-brand-darker font-black uppercase tracking-wider shadow-lg shadow-brand-green/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-brand-darker border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <i className="fa-solid fa-tag"></i>
                  List for Sale
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ListingForm;
