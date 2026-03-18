-- Market Values Table
-- Stores daily price snapshots for all cards across languages and conditions
CREATE TABLE IF NOT EXISTS market_values (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
    language VARCHAR(2) NOT NULL CHECK (language IN ('en', 'jp', 'th')),
    condition VARCHAR(20) NOT NULL, -- 'Raw_NM', 'PSA_10', 'PSA_9', 'BGS_10', etc.
    market_avg DECIMAL(10,2) NOT NULL,
    source_links JSONB, -- Array of URLs used for calculation
    source_prices JSONB, -- Individual prices from each source with weights
    weighted_calculation JSONB, -- Breakdown of calculation methodology
    last_updated TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS idx_market_values_card ON market_values(card_id);
CREATE INDEX IF NOT EXISTS idx_market_values_language ON market_values(language);
CREATE INDEX IF NOT EXISTS idx_market_values_updated ON market_values(last_updated);
CREATE INDEX IF NOT EXISTS idx_market_values_lookup ON market_values(card_id, language, condition);

-- Unique index to prevent duplicate snapshots for same card/language/condition on same day
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_values_unique_daily 
ON market_values(card_id, language, condition, DATE(last_updated));

-- Card Mappings Table
-- Maps Thai cards to their English/Japanese counterparts
CREATE TABLE IF NOT EXISTS card_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id_th VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
    card_id_en VARCHAR REFERENCES pokemon_cards(id) ON DELETE CASCADE,
    card_id_jp VARCHAR REFERENCES pokemon_cards(id) ON DELETE CASCADE,
    match_method VARCHAR(50) NOT NULL, -- 'name_fuzzy', 'artwork_hash', 'manual', 'number_match'
    confidence_score DECIMAL(3,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(card_id_th)
);

CREATE INDEX IF NOT EXISTS idx_mappings_th ON card_mappings(card_id_th);
CREATE INDEX IF NOT EXISTS idx_mappings_en ON card_mappings(card_id_en);
CREATE INDEX IF NOT EXISTS idx_mappings_jp ON card_mappings(card_id_jp);
CREATE INDEX IF NOT EXISTS idx_mappings_confidence ON card_mappings(confidence_score DESC);

-- Pending Matches Table
-- For Thai cards that couldn't be automatically matched
CREATE TABLE IF NOT EXISTS pending_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id_th VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
    suggested_matches JSONB, -- Array of {card_id, language, confidence, method}
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected')),
    reviewer_notes TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_matches(status);
CREATE INDEX IF NOT EXISTS idx_pending_th ON pending_matches(card_id_th);

-- Comments for documentation
COMMENT ON TABLE market_values IS 'Daily price snapshots for cards from multiple market data sources';
COMMENT ON TABLE card_mappings IS 'Multi-language card relationships for Thai price calculations';
COMMENT ON TABLE pending_matches IS 'Thai cards awaiting manual matching review';
