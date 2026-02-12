/**
 * API endpoint to run database migration for market data tables
 * GET /api/migrate-market-tables
 */

import { createClient } from '@supabase/supabase-js';
import type { NextApiRequest, NextApiResponse } from 'next';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(
    req: NextApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Optional: Add authentication check
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
            }
        });

        console.log('Running market data table migrations...');

        // Create market_values table
        const { error: marketValuesError } = await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS market_values (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    card_id VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
                    language VARCHAR(2) NOT NULL CHECK (language IN ('en', 'jp', 'th')),
                    condition VARCHAR(20) NOT NULL,
                    market_avg DECIMAL(10,2) NOT NULL,
                    source_links JSONB,
                    source_prices JSONB,
                    weighted_calculation JSONB,
                    last_updated TIMESTAMP DEFAULT NOW(),
                    created_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(card_id, language, condition, DATE(last_updated))
                );

                CREATE INDEX IF NOT EXISTS idx_market_values_card ON market_values(card_id);
                CREATE INDEX IF NOT EXISTS idx_market_values_language ON market_values(language);
                CREATE INDEX IF NOT EXISTS idx_market_values_updated ON market_values(last_updated);
                CREATE INDEX IF NOT EXISTS idx_market_values_lookup ON market_values(card_id, language, condition);
            `
        });

        // Create card_mappings table
        const { error: mappingsError } = await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS card_mappings (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    card_id_th VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
                    card_id_en VARCHAR REFERENCES pokemon_cards(id) ON DELETE CASCADE,
                    card_id_jp VARCHAR REFERENCES pokemon_cards(id) ON DELETE CASCADE,
                    match_method VARCHAR(50) NOT NULL,
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
            `
        });

        // Create pending_matches table
        const { error: pendingError } = await supabase.rpc('exec_sql', {
            sql: `
                CREATE TABLE IF NOT EXISTS pending_matches (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    card_id_th VARCHAR NOT NULL REFERENCES pokemon_cards(id) ON DELETE CASCADE,
                    suggested_matches JSONB,
                    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'rejected')),
                    reviewer_notes TEXT,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_matches(status);
                CREATE INDEX IF NOT EXISTS idx_pending_th ON pending_matches(card_id_th);
            `
        });

        const errors = [marketValuesError, mappingsError, pendingError].filter(Boolean);

        if (errors.length > 0) {
            console.error('Migration errors:', errors);
            return res.status(500).json({
                success: false,
                errors: errors.map(e => e?.message)
            });
        }

        return res.status(200).json({
            success: true,
            message: 'Market data tables created successfully',
            tables: ['market_values', 'card_mappings', 'pending_matches']
        });

    } catch (error) {
        console.error('Migration error:', error);
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}
