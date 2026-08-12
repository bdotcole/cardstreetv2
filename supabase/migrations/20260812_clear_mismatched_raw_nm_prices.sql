-- Clear Raw_NM prices that were written from the WRONG JustTCG card.
--
-- Residue of the variant-blind matching fixed in c18cf7e + 92f800e. Those commits
-- stop NEW bad writes, but a row the matcher now refuses keeps whatever wrong value
-- it already held, forever. Re-running the fixed crons repaired most of it
-- (provably-wrong rows 649 -> 291); these 22 are what is left AND are
-- materially harmful.
--
-- Selection is deliberately narrow — each row satisfies BOTH:
--   1. market_values.source_links holds a JustTCG id whose card name shares no
--      significant word with ours (audited 2026-08-12; diacritics normalized, so
--      "Pokedex"/"Pokedex" and translation drift are not counted), and
--   2. the price sits >=5x BELOW the same card's own ungraded Near Mint row.
-- Rows failing (2) are left alone: a wrong-but-harmless match is not worth the risk
-- of deleting a good price on a heuristic.
--
-- Deleting (not correcting) is right: the fixed matcher REFUSES these rather than
-- guessing, so no correct value exists to write. The card shows as unpriced until a
-- source can identify it, which beats showing a $44 card at $0.30.
--
-- Root cause for most of them: our MTG catalog numbers cards by ALPHABETICAL
-- position rather than collector number, so the old matcher bound them to whatever
-- token or minigame card upstream held that number.
--
-- EXCLUDED after manual review: SV11W-075. The audit flagged it, but its price came
-- from the right card (bouffalant-ex-075-086) — our catalog simply stores the wrong
-- english_name ("Herdier") for it. That is a catalog bug, not a pricing one, and
-- deleting the row would have thrown away a correct price. Every remaining id was
-- eyeballed against its full source URL; all 22 point at token/minigame products.
--
-- Run in the Supabase SQL Editor. Safe to re-run: a second pass deletes nothing.

DELETE FROM public.market_values
WHERE condition = 'Raw_NM'
  AND card_id IN (
  'mtg-64a5d494-efa1-446b-bebe-2ad36e154376',  -- Ugin, Eye of the Storms | $0.3 from magic-the-gathering-tarkir-dragonstorm-copy-monk-dou
  'mtg-8d8432a7-1c8a-4cfb-947c-ecf9791063eb',  -- Sire of Seven Deaths | $0.25 from magic-the-gathering-foundations-spirit-cat-0001-doub
  'mtg-35ed6263-bdd7-4013-ac8c-9b652d71a0db',  -- Archangel Elspeth | $0.13 from magic-the-gathering-march-of-the-machine-first-mate-
  'ygo-lc05-en005',  -- Shooting Quasar Dragon | $0.1 from yugioh-legendary-collection-5d-s-march-towards-ragna
  'mtg-08f79439-b8f8-418f-9772-26d81844749e',  -- Enduring Innocence | $0.22 from magic-the-gathering-duskmourn-house-of-horror-spirit
  'mtg-d3ca43a4-d194-440f-8099-f1fa103a108d',  -- Aven Interrupter | $0.19 from magic-the-gathering-outlaws-of-thunder-junction-shee
  'mtg-9fc6f0e9-eb5f-4bc0-b3d7-756644b66d12',  -- Hare Apparent | $0.22 from magic-the-gathering-foundations-zombie-insect-double
  'mtg-c5ee6651-9946-4bae-b21e-6cf28fa77b13',  -- Dollmaker's Shop // Porcelain Gallery | $0.23 from magic-the-gathering-duskmourn-house-of-horror-glimme
  'mtg-47f82d84-03ad-42dd-80ce-f0ac5e353e46',  -- Acrobatic Leap | $0.01 from magic-the-gathering-the-lost-caverns-of-ixalan-magic
  'ygo-rota-en014',  -- Lacrima the Crimson Tears | $0.73 from yugioh-rage-of-the-abyss-token-yuma-super-rare
  'ygo-suda-en021',  -- Tenyi Spirit - Suruya | $0.44 from yugioh-supreme-darkness-token-vizor-t-g-blade-blaste
  'mtg-d8999135-ddb1-4e4c-b885-e25f23dac3d3',  -- Elesh Norn // The Argent Etchings | $0.44 from magic-the-gathering-march-of-the-machine-phyrexian-h
  'mtg-c853d04c-864b-491c-8c6f-72d2d4874d2f',  -- Archangel of Tithes | $0.33 from magic-the-gathering-outlaws-of-thunder-junction-ange
  'mtg-a7113c93-6c6d-410f-aeec-abc5ee121cdf',  -- Heliod, the Radiant Dawn // Heliod, th | $0.23 from magic-the-gathering-march-of-the-machine-incubator-0
  'ygo-alin-en023',  -- Maliss <P> March Hare | $1.54 from yugioh-alliance-insight-token-luna-ancient-fairy-dra
  'ygo-stp6-en005',  -- Unending Nightmare | $0.29 from yugioh-speed-duel-tournament-pack-6-power-bond-commo
  'mtg-358968f9-45bd-4022-b6bc-f1f7e0adf0e7',  -- Final Showdown | $0.48 from magic-the-gathering-outlaws-of-thunder-junction-scor
  'mtg-9995e0e6-7c9c-4fef-8fd2-8fb1622e6ec8',  -- High Noon | $0.54 from magic-the-gathering-outlaws-of-thunder-junction-zomb
  'mtg-905d3e02-ea06-45e7-9adb-c8e7583323a2',  -- Crystal Barricade | $0.17 from magic-the-gathering-foundations-goblins-theme-card-t
  'mtg-0e1f1ff2-fa8f-4d38-b631-2d6e08e614c8',  -- Valkyrie's Call | $0.17 from magic-the-gathering-foundations-cat-0027-phyrexian-g
  'mtg-7305a8d3-5403-4483-92af-863dc91c6084',  -- Dusk Legion Duelist | $0.4 from magic-the-gathering-march-of-the-machine-phyrexian-h
  'mtg-09fb5876-5b47-4a05-be57-7ad3890c8953'  -- Angelic Intervention | $0.05 from magic-the-gathering-march-of-the-machine-buff-theme-
);

-- ============ Verify ============
-- Expect 0 rows.
SELECT card_id, market_avg, source_links
FROM public.market_values
WHERE condition = 'Raw_NM'
  AND card_id IN (
  'mtg-64a5d494-efa1-446b-bebe-2ad36e154376',
  'mtg-8d8432a7-1c8a-4cfb-947c-ecf9791063eb',
  'mtg-35ed6263-bdd7-4013-ac8c-9b652d71a0db',
  'ygo-lc05-en005',
  'mtg-08f79439-b8f8-418f-9772-26d81844749e',
  'mtg-d3ca43a4-d194-440f-8099-f1fa103a108d',
  'mtg-9fc6f0e9-eb5f-4bc0-b3d7-756644b66d12',
  'mtg-c5ee6651-9946-4bae-b21e-6cf28fa77b13',
  'mtg-47f82d84-03ad-42dd-80ce-f0ac5e353e46',
  'ygo-rota-en014',
  'ygo-suda-en021',
  'mtg-d8999135-ddb1-4e4c-b885-e25f23dac3d3',
  'mtg-c853d04c-864b-491c-8c6f-72d2d4874d2f',
  'mtg-a7113c93-6c6d-410f-aeec-abc5ee121cdf',
  'ygo-alin-en023',
  'ygo-stp6-en005',
  'mtg-358968f9-45bd-4022-b6bc-f1f7e0adf0e7',
  'mtg-9995e0e6-7c9c-4fef-8fd2-8fb1622e6ec8',
  'mtg-905d3e02-ea06-45e7-9adb-c8e7583323a2',
  'mtg-0e1f1ff2-fa8f-4d38-b631-2d6e08e614c8',
  'mtg-7305a8d3-5403-4483-92af-863dc91c6084',
  'mtg-09fb5876-5b47-4a05-be57-7ad3890c8953'
);
