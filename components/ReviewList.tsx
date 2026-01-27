import React from 'react';
import { Review } from '@/types';
import RatingStars from './RatingStars';

interface ReviewListProps {
    reviews: Review[];
}

const ReviewList: React.FC<ReviewListProps> = ({ reviews }) => {
    return (
        <div className="space-y-4">
            {reviews.map((review) => (
                <div key={review.id} className="glass p-4 rounded-xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden">
                                <img src={review.reviewerAvatar} alt={review.reviewerName} className="w-full h-full object-cover" />
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-white">{review.reviewerName}</h4>
                                <p className="text-[9px] text-slate-500 font-bold uppercase">{review.date}</p>
                            </div>
                        </div>
                        {review.verifiedPurchase && (
                            <span className="bg-brand-green/10 text-brand-green text-[8px] font-black uppercase px-1.5 py-0.5 rounded border border-brand-green/20">
                                Verified
                            </span>
                        )}
                    </div>

                    <RatingStars rating={review.rating} />

                    <p className="text-xs text-slate-300 leading-relaxed">
                        {review.comment}
                    </p>

                    {review.itemName && (
                        <div className="flex items-center gap-1 mt-2 p-1.5 bg-black/20 rounded border border-white/5 w-fit">
                            <i className="fa-solid fa-tag text-[9px] text-brand-cyan"></i>
                            <span className="text-[9px] text-slate-400 font-bold truncate max-w-[150px]">{review.itemName}</span>
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

export default ReviewList;
