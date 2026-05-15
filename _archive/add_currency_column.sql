
ALTER TABLE market_values 
ADD COLUMN IF NOT EXISTS currency VARCHAR(3) DEFAULT 'THB';

COMMENT ON COLUMN market_values.currency IS 'Currency code (e.g., THB, USD, JPY)';
