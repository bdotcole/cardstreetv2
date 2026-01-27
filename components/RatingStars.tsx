import React from 'react';

interface RatingStarsProps {
    rating: number;
    max?: number;
    size?: 'sm' | 'md' | 'lg';
    color?: string;
}

const RatingStars: React.FC<RatingStarsProps> = ({
    rating,
    max = 5,
    size = 'sm',
    color = 'text-yellow-400'
}) => {
    const sizeClass = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-lg';

    return (
        <div className={`flex gap-0.5 ${sizeClass} ${color}`}>
            {[...Array(max)].map((_, i) => (
                <i
                    key={i}
                    className={`fa-solid fa-star ${i < Math.floor(rating) ? 'opacity-100' : 'opacity-20'}`}
                ></i>
            ))}
        </div>
    );
};

export default RatingStars;
