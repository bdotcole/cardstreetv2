-- Card requests: capture the game and (optional) printed card number the
-- requester specifies, and shift `language` from "app UI locale at request time"
-- to "the game-language the requester picked" (multi-language games like Pokémon
-- require it; single-language games default to their only language).
--
-- Both new columns are nullable so legacy rows (which have neither) keep working;
-- the client folds game/number into `notes` if this migration hasn't run yet.
ALTER TABLE public.card_requests
    ADD COLUMN IF NOT EXISTS game TEXT,
    ADD COLUMN IF NOT EXISTS card_number TEXT;

COMMENT ON COLUMN public.card_requests.game IS
    'Game id the requested card belongs to (pokemon, mtg, yugioh, onepiece, riftbound, lorcana). Null for legacy rows submitted before the game selector shipped.';

COMMENT ON COLUMN public.card_requests.card_number IS
    'Optional printed card number the requester provided (e.g. "199/165").';

COMMENT ON COLUMN public.card_requests.language IS
    'Game-language code the requester selected (en/jp/th). Legacy rows hold the app UI locale at request time.';
