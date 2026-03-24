CREATE TABLE IF NOT EXISTS marketplace_configs (
    set_id TEXT PRIMARY KEY REFERENCES pokemon_sets(id) ON DELETE CASCADE,
    justtcg_slug TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed existing config from Edge Function
INSERT INTO marketplace_configs (set_id, justtcg_slug) VALUES
('sv8pt5', 'sv-prismatic-evolutions-pokemon'),
('sv08pt5', 'sv08-surging-sparks-pokemon'),
('sv08', 'sv08-surging-sparks-pokemon'),
('sv09', 'sv09-journey-together-pokemon'),
('sv10', 'sv10-destined-rivals-pokemon'),
('sv10.5b', 'sv-black-bolt-pokemon'),
('sv10.5w', 'sv-white-flare-pokemon'),
('sv07', 'sv07-stellar-crown-pokemon'),
('sv06.5', 'sv-shrouded-fable-pokemon'),
('sv06', 'sv06-twilight-masquerade-pokemon'),
('sv05', 'sv05-temporal-forces-pokemon'),
('me03', 'me-glory-of-team-rocket-pokemon'),
('me02.5', 'me-ascended-heroes-pokemon'),
('me02', 'me-pokemon-trading-card-game-classic-pokemon'),
('me01', 'me-genetic-apex-pokemon')
ON CONFLICT (set_id) DO UPDATE SET justtcg_slug = EXCLUDED.justtcg_slug;
