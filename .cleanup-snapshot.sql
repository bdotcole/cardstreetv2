-- =============================================================================
-- .cleanup-snapshot.sql  —  DO NOT COMMIT TO GIT
-- =============================================================================
-- Generated: 2026-05-10  (pre-test snapshot taken at 2026-05-10 14:49:13.81009+00 UTC)
-- Purpose:   Restore prod Supabase state after the Stripe-webhook QC test.
--
-- USAGE
-- -----
-- 1. After the browser checkout test completes, locate the test order's
--    transfer_group with this query in the Supabase SQL Editor:
--
--      SELECT id, transfer_group, status, payment_id
--      FROM orders
--      WHERE buyer_id = 'e5a797f5-cb34-4143-925e-e787071f7acf'
--      ORDER BY id DESC
--      LIMIT 5;
--
--    Copy the `transfer_group` of the test order (looks like
--    "order_1747235413_5678").
--
-- 2. In this file, find/replace the literal text  order_1778459290949_2055  with the
--    actual transfer_group value. There are 4 occurrences below.
--
-- 3. Paste the entire file into the Supabase SQL Editor and Run.
--
-- 4. Inspect the verification SELECT at the end (the "expected" column shows
--    what each count should be). The script ends with COMMIT;
--    change it to ROLLBACK; if anything looks off.
--
-- TEST SCOPE
-- ----------
--   buyer_id   = e5a797f5-cb34-4143-925e-e787071f7acf
--   seller_id  = ea16a6bd-bda7-4a54-9d12-8373046705f3
--   listing_id = 250b76d3-5e0c-480c-acb0-8484fed36726
--   card_id    = me02.5-001
--
-- SELLER PRE-TEST SNAPSHOT (two rows; the test arbitrarily DELETEs one of them
-- because of the .limit(1) without ORDER BY in app/api/orders/checkout/route.ts)
-- ----------------------------------------------------------------------------
--   Row A: id=55ba0b15-4233-49ff-bca3-65d4959d9d26, purchase_price=7.86,  change7d=-4.4
--   Row B: id=6b6d5e88-b85b-4876-aac7-8cde9fa4861b, purchase_price=20.00, change7d=1.8
--
-- BUYER PRE-TEST SNAPSHOT
-- -----------------------
--   Zero collection_items rows for card_id='me02.5-001'. Any post-test row
--   for that buyer+card combo is necessarily from the test, so the cleanup
--   uses an unconditional DELETE WHERE card_id='me02.5-001' for that buyer.
-- =============================================================================

BEGIN;

-- ─── Step 1: Restore whichever seller row the test deleted ────────────────────
-- Detects which of the two seller rows is missing post-test and re-INSERTs it
-- with its original UUID, collection_id, card_data, and purchase_price.
DO $$
DECLARE
  a_exists BOOLEAN;
  b_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM collection_items WHERE id = '55ba0b15-4233-49ff-bca3-65d4959d9d26') INTO a_exists;
  SELECT EXISTS(SELECT 1 FROM collection_items WHERE id = '6b6d5e88-b85b-4876-aac7-8cde9fa4861b') INTO b_exists;

  RAISE NOTICE '[Cleanup] Row A (55ba...) exists: %; Row B (6b6d...) exists: %', a_exists, b_exists;

  IF NOT a_exists AND b_exists THEN
    INSERT INTO collection_items (id, collection_id, card_id, card_data, quantity, condition, purchase_price)
    VALUES (
      '55ba0b15-4233-49ff-bca3-65d4959d9d26',
      '041faad0-fe1f-413c-9bf2-c030de31d0ee',
      'me02.5-001',
      $cd$ {
        "id": "me02.5-001",
        "set": "Ascended Heroes",
        "name": "Erika's Oddish",
        "images": {
          "large": "https://assets.tcgdex.net/en/me/me02.5/001/high.png",
          "small": "https://assets.tcgdex.net/en/me/me02.5/001/low.png"
        },
        "number": "001/217",
        "prices": {
          "low": 7,
          "mid": 7.857142857142858,
          "high": 9,
          "market": 7.857142857142858,
          "lastUpdated": "2026-03-24T13:54:52.514"
        },
        "rarity": "Common",
        "change7d": -4.4,
        "imageUrl": "https://assets.tcgdex.net/en/me/me02.5/001/high.png",
        "language": "en",
        "thaiName": "Erika's Oddish",
        "marketPrice": 7.857142857142858,
        "priceHistory": [
          {"date": "1D", "price": 8},
          {"date": "7D", "price": 7},
          {"date": "1M", "price": 7},
          {"date": "3M", "price": 6},
          {"date": "6M", "price": 7.857142857142858}
        ],
        "tcgplayerUrl": null
      } $cd$::jsonb,
      1,
      'Near Mint',
      7.86
    );
    RAISE NOTICE '[Cleanup] Restored Row A (purchase_price 7.86).';

  ELSIF a_exists AND NOT b_exists THEN
    INSERT INTO collection_items (id, collection_id, card_id, card_data, quantity, condition, purchase_price)
    VALUES (
      '6b6d5e88-b85b-4876-aac7-8cde9fa4861b',
      '041faad0-fe1f-413c-9bf2-c030de31d0ee',
      'me02.5-001',
      $cd$ {
        "id": "me02.5-001",
        "set": "Ascended Heroes",
        "name": "Erika's Oddish",
        "images": {
          "large": "https://assets.tcgdex.net/en/me/me02.5/001/high.png",
          "small": "https://assets.tcgdex.net/en/me/me02.5/001/low.png"
        },
        "number": "001/217",
        "prices": {
          "low": 7,
          "mid": 7.857142857142858,
          "high": 9,
          "market": 7.857142857142858,
          "lastUpdated": "2026-03-24T13:54:52.514"
        },
        "rarity": "Common",
        "change7d": 1.8,
        "imageUrl": "https://assets.tcgdex.net/en/me/me02.5/001/high.png",
        "language": "en",
        "thaiName": "Erika's Oddish",
        "marketPrice": 7.857142857142858,
        "priceHistory": [
          {"date": "1D", "price": 8},
          {"date": "7D", "price": 8},
          {"date": "1M", "price": 7},
          {"date": "3M", "price": 6},
          {"date": "6M", "price": 7.857142857142858}
        ],
        "tcgplayerUrl": null
      } $cd$::jsonb,
      1,
      'Near Mint',
      20
    );
    RAISE NOTICE '[Cleanup] Restored Row B (purchase_price 20.00).';

  ELSIF a_exists AND b_exists THEN
    RAISE NOTICE '[Cleanup] Both seller rows still present. Test may not have reached the seller-delete step in app/api/orders/checkout/route.ts. No restore needed.';
  ELSE
    RAISE WARNING '[Cleanup] BOTH seller rows are MISSING! The test deleted both, or someone else modified the seller collection. Manual investigation required.';
  END IF;
END $$;

-- ─── Step 2: Delete shipping_labels created by the test ──────────────────────
DELETE FROM shipping_labels
WHERE order_id IN (
  SELECT id FROM orders WHERE transfer_group = 'order_1778459290949_2055'
);

-- ─── Step 3: Delete the test orders ─────────────────────────────────────────
DELETE FROM orders
WHERE transfer_group = 'order_1778459290949_2055';

-- ─── Step 4: Restore the listing to active ──────────────────────────────────
UPDATE listings
SET status = 'active', updated_at = NOW()
WHERE id = '250b76d3-5e0c-480c-acb0-8484fed36726';

-- ─── Step 5: Delete buyer's collection_items added by the test ──────────────
-- Buyer had ZERO rows for me02.5-001 pre-test (verified via Block 3c), so a
-- blanket delete on the (buyer, card_id) pair is safe and removes only test rows.
DELETE FROM collection_items ci
USING collections c
WHERE ci.collection_id = c.id
  AND c.user_id = 'e5a797f5-cb34-4143-925e-e787071f7acf'
  AND ci.card_id = 'me02.5-001';

-- ─── Step 6: Verification — actual vs expected ──────────────────────────────
-- All counts should match the "expected" column. Inspect before COMMIT.
SELECT 'orders_remaining'         AS check_name,
       COUNT(*)::int               AS actual,
       0                           AS expected
FROM orders WHERE transfer_group = 'order_1778459290949_2055'
UNION ALL
SELECT 'labels_remaining',
       COUNT(*)::int,
       0
FROM shipping_labels sl
WHERE sl.order_id IN (SELECT id FROM orders WHERE transfer_group = 'order_1778459290949_2055')
UNION ALL
SELECT 'listing_not_active',
       COUNT(*)::int,
       0
FROM listings
WHERE id = '250b76d3-5e0c-480c-acb0-8484fed36726' AND status != 'active'
UNION ALL
SELECT 'buyer_test_card_rows',
       COUNT(*)::int,
       0
FROM collection_items ci
JOIN collections c ON c.id = ci.collection_id
WHERE c.user_id = 'e5a797f5-cb34-4143-925e-e787071f7acf'
  AND ci.card_id = 'me02.5-001'
UNION ALL
SELECT 'seller_test_card_rows',
       COUNT(*)::int,
       2
FROM collection_items ci
JOIN collections c ON c.id = ci.collection_id
WHERE c.user_id = 'ea16a6bd-bda7-4a54-9d12-8373046705f3'
  AND ci.card_id = 'me02.5-001';

-- Expected:
--   orders_remaining       : 0
--   labels_remaining       : 0
--   listing_not_active     : 0
--   buyer_test_card_rows   : 0
--   seller_test_card_rows  : 2  (back to original count)
--
-- If actual matches expected for all 5 → COMMIT (already at end).
-- If anything is off → change COMMIT to ROLLBACK and investigate.

COMMIT;
-- ROLLBACK;
