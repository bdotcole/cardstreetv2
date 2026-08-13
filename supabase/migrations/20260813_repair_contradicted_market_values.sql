-- Repair prices that contradict the live market, verified card-by-card.
--
-- Two stale-data problems, opposite directions, both residue of the variant-blind
-- matching fixed in c18cf7e + 92f800e:
--
--  A. 'Near Mint' rows are orphaned — 39,025 of them, none carrying source_links,
--     none touched since before August, and no current job maintains them. Most are
--     harmless (31,158 of the 32,838 cards holding both agree with Raw_NM within
--     2x) and they are INVISIBLE while a Raw_NM row exists, since cardMapper ranks
--     Raw_NM first. But where the two disagree, an old ingest had written a
--     PARALLEL's price onto the base card: every SV2a base card carries its Master
--     Ball price (plain Pikachu 'Near Mint' = $193.90 against a true $0.23).
--
--  B. A smaller set has the opposite fault — a wrong Raw_NM masking a correct Near
--     Mint. Those ARE user-visible, because Raw_NM wins display: ygo-mrl-e111
--     "Flame Swordsman" shows $3 for a card that trades at $69.98.
--
-- Every id below was checked individually against live JustTCG through the shipped
-- matcher (supabase/functions/_shared/cardMatch.ts): the row being deleted is the
-- one that does NOT match the live price, and the row left behind is the one that
-- does. Cards where neither side matched live, or that could not be resolved
-- upstream, are left alone — this file removes only values proven wrong.
--
-- Every affected card keeps at least one ungraded price, so nothing becomes
-- unpriced. Graded rows (PSA/BGS/CGC/SGC) are untouched.
--
-- Run in the Supabase SQL Editor. Safe to re-run: a second pass deletes nothing.

-- ===== A. 251 contaminated 'Near Mint' rows (a parallel's price on a base card) =====
DELETE FROM public.market_values
WHERE condition = 'Near Mint'
  AND card_id IN (
  'SV2a-025',  -- ピカチュウ | stored $193.9 vs live $0.23
  'SV2a-054',  -- コダック | stored $68.14 vs live $0.22
  'SV2a-161',  -- エリカの招待 | stored $29.83 vs live $0.12
  'SV2a-004',  -- ヒトカゲ | stored $29.17 vs live $0.15
  'SV2a-001',  -- フシギダネ | stored $34.97 vs live $0.18
  'SV2a-148',  -- ハクリュー | stored $25.49 vs live $0.15
  'SV2a-162',  -- サカキのカリスマ | stored $17.7 vs live $0.12
  'SV2a-007',  -- ゼニガメ | stored $29.63 vs live $0.22
  'SV2a-010',  -- キャタピー | stored $13.05 vs live $0.11
  'SV2a-163',  -- ナナミの手助け | stored $10.51 vs live $0.09
  'SV2a-067',  -- ゴーリキー | stored $15.07 vs live $0.13
  'SV2a-164',  -- マサキの転送 | stored $9.94 vs live $0.09
  'SV2a-005',  -- リザード | stored $10.75 vs live $0.11
  'SV2a-034',  -- ニドキング | stored $15.97 vs live $0.18
  'SV2a-138',  -- オムナイト | stored $10.19 vs live $0.12
  'SV2a-061',  -- ニョロゾ | stored $11.68 vs live $0.14
  'SV2a-181',  -- カビゴン | stored $16.5 vs live $0.23
  'SV2a-002',  -- フシギソウ | stored $12.1 vs live $0.17
  'SV2a-008',  -- カメール | stored $11.71 vs live $0.21
  'SV2a-122',  -- バリヤード | stored $10.5 vs live $0.22
  'SV2a-114',  -- モンジャラ | stored $5.81 vs live $0.16
  'SV2a-183',  -- ミュウツー | stored $20.87 vs live $0.63
  'mtg-33631d6c-c584-42ff-afe5-2647b5fb321f',  -- Captain America, Super-Sol | stored $45.53 vs live $0.26
  'mtg-2d5819ca-165d-4f4c-9500-3ac206994880',  -- Quicksilver, Brash Blur | stored $29.99 vs live $0.4
  'mtg-f498c1a4-54d2-4e87-952f-8cf7e408930c',  -- Thunderbolts Conspiracy | stored $25.98 vs live $0.39
  'mtg-c2aadc25-7755-4bc8-a8af-b01d27eec364',  -- Baron Helmut Zemo | stored $28.99 vs live $0.46
  'mtg-8c6a6d11-45cb-4def-a04b-51b91e1747db',  -- Moon Girl and Devil Dinosa | stored $22.94 vs live $0.34
  'mtg-9b99894b-c774-45c2-9ee9-4d6a8e7522f5',  -- Doom Reigns Supreme | stored $25.98 vs live $0.46
  'mtg-11fc8221-756a-4919-9272-38793e9c1ad9',  -- Super-Skrull | stored $21.43 vs live $0.37
  'mtg-c1c7aa22-51b0-45ee-9a8e-5493a1820d8c',  -- Wolverine, Fierce Fighter | stored $25 vs live $0.62
  'mtg-14e821bb-55cc-474e-9b63-0ceecc2666c1',  -- Daredevil, Man Without Fea | stored $14.95 vs live $0.51
  'mtg-9032f05b-5c21-4996-90c1-268dc6dffbaa',  -- World War Hulk | stored $36.97 vs live $1.67
  'mtg-2961cf20-33c8-4e66-9d0f-6daca8ea7880',  -- The Vision | stored $22.83 vs live $1.47
  'mtg-8ffaa5b3-00fa-46ea-918c-dfce0de9e898',  -- The Coming of Galactus | stored $100 vs live $5.58
  'mtg-51524f8a-030c-4522-bfc0-d55c2c7c9326',  -- World War Hulk | stored $59.33 vs live $3.79
  'mtg-d7922c5f-d6ee-4b62-a537-3be5aa280e10',  -- Hellcat, Undying Vigilante | stored $2.99 vs live $0.24
  'mtg-3f1933a8-046f-471a-afcf-cfb08ca0d239',  -- The Thing, Ben Grimm | stored $2.99 vs live $0.33
  'mtg-5cc2d948-ac8b-4466-b604-3fabc0ab6bb9',  -- Iron Fist, Living Weapon | stored $2.99 vs live $0.28
  'mtg-0d01bc37-ebf4-4f08-9beb-fef8787f8e7a',  -- HULK SMASH! | stored $2.99 vs live $0.31
  'mtg-aa8dbbb9-36a5-48e0-9e30-aeed0fb5d522',  -- Black Widow, Double Agent | stored $2.99 vs live $0.32
  'mtg-845b0be1-4f85-4a8c-8205-dc85c8cf9a61',  -- Super-Soldier Serum | stored $14.99 vs live $1.74
  'mtg-26faf2db-ad86-462f-b61f-c1893c9aebbf',  -- Ant-Man, Colony Commander | stored $2.99 vs live $0.34
  'mtg-8f8659f6-a793-4edc-8401-d9126840c1c2',  -- Human Torch, Johnny Storm | stored $2.99 vs live $0.31
  'mtg-fb96ee86-5139-472a-9c4b-8a8a4280fc7e',  -- Kang, Temporal Tyrant | stored $2.99 vs live $0.36
  'mtg-38e87542-50f7-4812-9338-84e4b9b7bb44',  -- M.O.D.O.K. | stored $59.84 vs live $6.3
  'mtg-2f80394b-2f7e-40a7-8203-720bcf39d71b',  -- Invisible Woman, Sue Storm | stored $2.99 vs live $0.34
  'mtg-339acb17-4b8e-4836-9cc5-8a0a946ebc73',  -- Arc Reactor | stored $14.78 vs live $1.87
  'mtg-dec3dd36-b8ca-432b-8973-d37c6efc4c1a',  -- Political Triumph | stored $2.99 vs live $0.32
  'mtg-8f84ab0a-bf6e-4f28-9da8-998512a224ed',  -- Iron Man, Master of Machin | stored $2.99 vs live $0.36
  'mtg-29e82e97-79b3-4495-9aa0-a90242d594b2',  -- Thanos, the Mad Titan | stored $125.99 vs live $17.03
  'mtg-9b1f213a-e1d4-4a0f-954b-c83915698d98',  -- Doctor Doom | stored $36.99 vs live $6.13
  'mtg-c3d5add1-0d0e-414b-a964-8da326472d35',  -- Attuma, Atlantean Warlord | stored $2.99 vs live $0.37
  'mtg-19dc5fcc-d05d-41a0-84c5-2dec996f3e4f',  -- Doc Samson, Super Psychiat | stored $2.99 vs live $0.36
  'mtg-17ef068b-61fc-443d-97b0-1e41f2622425',  -- Mister Fantastic, Reed Ric | stored $2.77 vs live $0.35
  'mtg-6516f292-469d-4092-b099-97c698f373cd',  -- Captain America, Living Le | stored $2.99 vs live $0.64
  'mtg-e0dbbdcf-84e1-494f-8b8c-0a094f603fa9',  -- Bruce Banner // The Incred | stored $54.63 vs live $9.55
  'mtg-e9b288fb-d122-4c9f-9dd9-d21856a6aac9',  -- Dark Fortress | stored $24 vs live $3.49
  'mtg-236c437f-ee9d-4145-a4db-b665908089cf',  -- Loki, God of Mischief | stored $14.8 vs live $3.58
  'mtg-98df64ca-39c3-47e6-8143-4106c8e9cf59',  -- Murdock's Crusade | stored $0.98 vs live $0.28
  'mtg-7aaefcf9-fbe1-4767-92a5-09825761d116',  -- Namor the Sub-Mariner | stored $35.31 vs live $8.48
  'SV5K-080',  -- ゴース | stored $37.67 vs live $0.19
  'SV5K-083',  -- チラチーノ | stored $14.21 vs live $0.13
  'SV5K-082',  -- チラーミィ | stored $8.91 vs live $0.19
  'SV5K-079',  -- アーボック | stored $5.71 vs live $0.15
  'SV5K-075',  -- ランクルス | stored $4.73 vs live $0.15
  'SV5K-074',  -- ドーミラー | stored $2.39 vs live $0.09
  'SV5K-081',  -- ペラップ | stored $3.03 vs live $0.14
  'SV5K-078',  -- バンバドロ | stored $2.37 vs live $0.13
  'SV5K-076',  -- ハバタクカミ | stored $2.09 vs live $0.17
  'SV5K-077',  -- ジーランス | stored $2.39 vs live $0.23
  'SV5K-088',  -- ゲンガーex | stored $31.33 vs live $4.53
  'SV5K-090',  -- 探検家の先導 | stored $0.92 vs live $0.14
  'SV5K-087',  -- ウミトリオex | stored $1.55 vs live $0.3
  'ygo-rp01-en094',  -- Cloning | stored $25.06 vs live $0.14
  'SV4a-354',  -- ボタン | stored $13.03 vs live $0.11
  'SV4a-317',  -- ワッカネズミ | stored $14.61 vs live $0.17
  'SV4a-318',  -- イッカネズミ | stored $15.48 vs live $0.2
  'SV4a-310',  -- カビゴン | stored $12.2 vs live $0.19
  'SV4a-309',  -- メタモン | stored $15.31 vs live $0.34
  'SV4a-303',  -- モトトカゲ | stored $1.15 vs live $0.03
  'SV4a-304',  -- ポッポ | stored $2.45 vs live $0.08
  'SV4a-306',  -- プリン | stored $3.41 vs live $0.14
  'SV4a-175',  -- ネルケ | stored $0.87 vs live $0.04
  'SV4a-055',  -- ピカチュウ | stored $4.18 vs live $0.26
  'SV4a-311',  -- キャモメ | stored $1.12 vs live $0.07
  'SV4a-315',  -- グルトン | stored $2.02 vs live $0.13
  'SV4a-298',  -- タギングル | stored $0.91 vs live $0.06
  'SV4a-297',  -- シルシュルー | stored $0.88 vs live $0.06
  'SV4a-179',  -- パルデアの学生 | stored $0.57 vs live $0.04
  'SV4a-319',  -- カラミンゴ | stored $0.98 vs live $0.07
  'SV4a-302',  -- オンバット | stored $1.24 vs live $0.09
  'SV4a-094',  -- カヌチャン | stored $1.78 vs live $0.13
  'SV4a-046',  -- ナミイルカ | stored $0.88 vs live $0.07
  'SV4a-062',  -- パチリス | stored $1.38 vs live $0.11
  'SV4a-307',  -- ドードー | stored $1.24 vs live $0.1
  'SV4a-066',  -- パモ | stored $0.97 vs live $0.08
  'SV4a-316',  -- パフュートン | stored $1.21 vs live $0.1
  'SV4a-025',  -- ヒトカゲ | stored $2 vs live $0.18
  'SV4a-073',  -- ケーシィ | stored $0.77 vs live $0.08
  'SV4a-174',  -- ナンジャモ | stored $1.43 vs live $0.15
  'SV4a-299',  -- ハッサム | stored $1.98 vs live $0.21
  'SV4a-305',  -- ピジョン | stored $1.22 vs live $0.13
  'SV4a-314',  -- ヨクバリス | stored $1.02 vs live $0.11
  'SV4a-036',  -- ヤドン | stored $1.1 vs live $0.12
  'SV4a-300',  -- ブロロン | stored $0.81 vs live $0.09
  'SV4a-020',  -- カプサイジ | stored $0.63 vs live $0.07
  'SV4a-308',  -- ドードリオ | stored $0.95 vs live $0.11
  'SV4a-026',  -- リザード | stored $1.35 vs live $0.16
  'SV4a-005',  -- ハネッコ | stored $0.8 vs live $0.1
  'SV4a-090',  -- バウッツェル | stored $0.99 vs live $0.13
  'SV4a-031',  -- アチゲータ | stored $0.6 vs live $0.08
  'SV4a-002',  -- クサイハナ | stored $0.5 vs live $0.07
  'SV4a-077',  -- ピィ | stored $2.06 vs live $0.31
  'SV4a-110',  -- キラーメ | stored $0.46 vs live $0.07
  'SV4a-050',  -- シャリタツ | stored $0.72 vs live $0.11
  'SV4a-089',  -- パピモッチ | stored $0.89 vs live $0.14
  'SV4a-095',  -- ナカヌチャン | stored $0.9 vs live $0.15
  'SV4a-069',  -- カイデン | stored $0.42 vs live $0.07
  'SV4a-105',  -- ルカリオ | stored $1.01 vs live $0.17
  'SV4a-060',  -- ルクシオ | stored $0.94 vs live $0.16
  'SV4a-107',  -- コジオ | stored $0.35 vs live $0.06
  'SV4a-012',  -- ニャオハ | stored $0.87 vs live $0.15
  'SV4a-041',  -- クワッス | stored $0.44 vs live $0.08
  'SV4a-030',  -- ホゲータ | stored $0.6 vs live $0.11
  'SV4a-084',  -- フワライド | stored $0.38 vs live $0.07
  'SV4a-093',  -- ヒラヒナ | stored $0.43 vs live $0.08
  'SV4a-004',  -- ストライク | stored $0.59 vs live $0.11
  'SV4a-033',  -- カルボウ | stored $0.48 vs live $0.09
  'SV4a-301',  -- ブロロローム | stored $0.73 vs live $0.14
  'SV4a-067',  -- パモット | stored $0.62 vs live $0.12
  'SV4a-122',  -- コマタナ | stored $0.41 vs live $0.08
  'SV4a-116',  -- パルデア ウパー | stored $0.75 vs live $0.15
  'SV11W-046',  -- ダゲキ | stored $5.17 vs live $0.09
  'SV11W-052',  -- チョロネコ | stored $4.92 vs live $0.09
  'SV11W-050',  -- コジョンド | stored $5.26 vs live $0.1
  'SV11W-054',  -- ズルッグ | stored $4.78 vs live $0.1
  'SV11W-031',  -- デンチュラ | stored $4.96 vs live $0.11
  'SV11W-066',  -- ギギアル | stored $4.82 vs live $0.11
  'SV11W-070',  -- ミネズミ | stored $3.06 vs live $0.07
  'SV11W-036',  -- デスマス | stored $3.92 vs live $0.09
  'SV11W-048',  -- アーケオス | stored $9.07 vs live $0.21
  'SV11W-047',  -- アーケン | stored $3.36 vs live $0.08
  'SV11W-001',  -- クルミル | stored $5.7 vs live $0.14
  'SV11W-055',  -- ズルズキン | stored $4.38 vs live $0.11
  'SV11W-053',  -- レパルダス | stored $3.95 vs live $0.1
  'SV11W-019',  -- フタチマル | stored $3.54 vs live $0.09
  'SV11W-078',  -- トルネロス | stored $3.75 vs live $0.1
  'SV11W-028',  -- シママ | stored $3.71 vs live $0.1
  'SV11W-060',  -- モノズ | stored $4.41 vs live $0.12
  'SV11W-009',  -- アギルダー | stored $3.3 vs live $0.09
  'SV11W-016',  -- クイタラン | stored $2.04 vs live $0.06
  'SV11W-011',  -- ポカブ | stored $3.03 vs live $0.09
  'SV11W-012',  -- チャオブー | stored $2.69 vs live $0.08
  'SV11W-058',  -- ゾロア | stored $3.35 vs live $0.1
  'SV11W-002',  -- クルマユ | stored $3.34 vs live $0.1
  'SV11W-023',  -- スワンナ | stored $2.27 vs live $0.07
  'SV11W-063',  -- テッシード | stored $2.91 vs live $0.09
  'SV11W-021',  -- バスラオ | stored $2.5 vs live $0.08
  'SV11W-022',  -- コアルヒー | stored $2.06 vs live $0.07
  'SV11W-030',  -- バチュル | stored $3.12 vs live $0.11
  'SV11W-071',  -- ミルホッグ | stored $2.54 vs live $0.09
  'SV11W-026',  -- バイバニラ | stored $1.94 vs live $0.07
  'SV11W-072',  -- ヨーテリー | stored $2.76 vs live $0.1
  'SV11W-039',  -- ゴチミル | stored $3 vs live $0.11
  'SV11W-013',  -- エンブオー | stored $4.34 vs live $0.16
  'SV11W-006',  -- シキジカ | stored $2.66 vs live $0.1
  'SV11W-077',  -- ウォーグル | stored $2 vs live $0.08
  'SV11W-040',  -- ゴチルゼル | stored $3.48 vs live $0.14
  'SV11W-025',  -- バニリッチ | stored $2.62 vs live $0.11
  'SV11W-008',  -- チョボマキ | stored $1.65 vs live $0.07
  'SV11W-064',  -- ナットレイ | stored $2.31 vs live $0.1
  'SV11W-051',  -- テラキオン | stored $2.25 vs live $0.1
  'SV11W-035',  -- シンボラー | stored $2.02 vs live $0.09
  'SV11W-056',  -- ヤブクロン | stored $3.48 vs live $0.16
  'SV11W-037',  -- デスカーン | stored $3.03 vs live $0.14
  'SV11W-004',  -- モンメン | stored $1.49 vs live $0.07
  'SV11W-068',  -- アイアント | stored $4.68 vs live $0.22
  'SV11W-061',  -- ジヘッド | stored $1.05 vs live $0.05
  'SV11W-069',  -- クリムガン | stored $1.78 vs live $0.09
  'SV11W-024',  -- バニプッチ | stored $2.5 vs live $0.13
  'SV11W-076',  -- ワシボン | stored $2.29 vs live $0.12
  'SV11W-007',  -- メブキジカ | stored $3.05 vs live $0.16
  'SV11W-020',  -- ダイケンキ | stored $3.38 vs live $0.18
  'SV11W-049',  -- コジョフー | stored $1.53 vs live $0.09
  'SV11W-043',  -- ダンゴロ | stored $1.5 vs live $0.09
  'SV11W-065',  -- ギアル | stored $1.5 vs live $0.09
  'SV11W-032',  -- マッギョ | stored $1.29 vs live $0.08
  'SV11W-029',  -- ゼブライカ | stored $2.25 vs live $0.14
  'SV11W-044',  -- ガントル | stored $2.17 vs live $0.14
  'SV11W-038',  -- ゴチム | stored $1.84 vs live $0.12
  'SV11W-041',  -- プルリル | stored $1.84 vs live $0.12
  'SV11W-014',  -- バオップ | stored $2.25 vs live $0.15
  'SV11W-067',  -- ギギギアル | stored $2.25 vs live $0.15
  'SV11W-074',  -- ムーランド | stored $2.22 vs live $0.19
  'SV11W-018',  -- ミジュマル | stored $3.13 vs live $0.27
  'SV11W-059',  -- ゾロアーク | stored $2.34 vs live $0.21
  'SV11W-034',  -- ココロモリ | stored $1.3 vs live $0.12
  'SV11W-010',  -- ビリジオン | stored $1.58 vs live $0.15
  'SV11W-015',  -- バオッキー | stored $3.35 vs live $0.32
  'SV11W-003',  -- ハハコモリ | stored $1.36 vs live $0.14
  'SV11W-033',  -- コロモリ | stored $1.71 vs live $0.18
  'SV11W-045',  -- ギガイアス | stored $0.7 vs live $0.1
  'SV11W-057',  -- ダストダス | stored $1.23 vs live $0.19
  'SV8a-231',  -- タロ | stored $6.68 vs live $0.12
  'SV8a-227',  -- アカマツ | stored $4.67 vs live $0.12
  'SV8a-230',  -- スグリ | stored $5.62 vs live $0.16
  'SV8a-228',  -- アンズの秘技 | stored $4.69 vs live $0.19
  'SV8a-195',  -- パルデアの仲間たち | stored $2.67 vs live $0.11
  'SV8a-198',  -- メロコ | stored $1.18 vs live $0.09
  'SV8a-188',  -- アオキの手際 | stored $1.56 vs live $0.14
  'ygo-bpro-en041',  -- Ecclesia and the Dark Drag | stored $60.07 vs live $1.52
  'op-prb-01-op05-119',  -- Monkey.D.Luffy (OP05-119)  | stored $12.02 vs live $0.33
  'S12a-151',  -- キバナ | stored $1.58 vs live $0.07
  'S12a-157',  -- ツツジ | stored $1.31 vs live $0.11
  'S12a-152',  -- ザクロ | stored $0.7 vs live $0.06
  'S12a-121',  -- ビッパ | stored $1.59 vs live $0.14
  'S12a-148',  -- アクロマの実験 | stored $1.28 vs live $0.12
  'S12a-023',  -- ラプラス | stored $1.21 vs live $0.13
  'S12a-076',  -- リオル | stored $1.39 vs live $0.15
  'S12a-081',  -- ポチエナ | stored $1.21 vs live $0.14
  'S12a-104',  -- チルタリス | stored $1.1 vs live $0.14
  'S12a-057',  -- ヨマワル | stored $0.89 vs live $0.12
  'S12a-118',  -- ノコッチ | stored $0.65 vs live $0.09
  'S12a-010',  -- コロトック | stored $0.77 vs live $0.11
  'S12a-160',  -- ヒスイの仲間たち | stored $0.75 vs live $0.11
  'S12a-022',  -- オドリドリ | stored $0.54 vs live $0.08
  'S12a-120',  -- チルット | stored $0.74 vs live $0.11
  'S12a-154',  -- シンオウの仲間たち | stored $0.8 vs live $0.12
  'S12a-074',  -- ソルロック | stored $0.52 vs live $0.08
  'S12a-093',  -- フォクスライ | stored $1.04 vs live $0.16
  'S12a-162',  -- メロン | stored $0.66 vs live $0.11
  'S12a-017',  -- ブーバーン | stored $0.97 vs live $0.17
  'S12a-150',  -- カミツレのきらめき | stored $0.86 vs live $0.16
  'S12a-105',  -- ラティアス | stored $0.95 vs live $0.19
  'S12a-158',  -- ナタネの活気 | stored $0.75 vs live $0.15
  'ygo-dr2-en026',  -- Drillago | stored $1.33 vs live $0.1
  'ygo-dr2-en052',  -- Chain Disappearance | stored $7.95 vs live $0.99
  'op-op-01-op01-062',  -- Crocodile (062) (Parallel) | stored $140.41 vs live $11.74
  'mtg-bd31953a-7259-44e3-a94f-013bda68006d',  -- Prowler, Clawed Thief | stored $2.11 vs live $0.3
  'mtg-211a9764-3c60-46ba-bb53-e6692640ec8f',  -- Tom, Bert, and William | stored $15.98 vs live $1.08
  'mtg-3aa29fe8-1687-486f-b4df-c04977869ab1',  -- An Unexpected Party // At  | stored $16.98 vs live $1.66
  'mtg-15ae4d50-be2f-412c-bb6b-b0a06b60474a',  -- My Precious // Allure of P | stored $36.97 vs live $5.07
  'ygo-blgg-en011',  -- Dragunity Quirinus | stored $1.73 vs live $0.23
  'mtg-590d1d95-ed13-4121-899f-f5a2d8a6617a',  -- Thunderdrum Soloist | stored $2.31 vs live $0.32
  'ygo-op29-en009',  -- Mistaken Arrest | stored $2.08 vs live $0.31
  'S9-071',  -- ギギギアル | stored $0.99 vs live $0.15
  'op-op-12-op12-061',  -- Donquixote Rosinante (061) | stored $50.98 vs live $7.9
  'mtg-e9a268ba-c442-4fe4-90b4-2810c8474f4e',  -- Caustic Bronco | stored $2.43 vs live $0.4
  'op-op-10-op10-004',  -- Vergo | stored $0.81 vs live $0.13
  'SV3a-055',  -- ゴージャスマント | stored $0.12 vs live $0.02
  'ygo-dood-en009'  -- DoomZ V Five - Amalthe | stored $5.94 vs live $1.04
);

-- ===== B. 22 wrong 'Raw_NM' rows masking a correct 'Near Mint' =====
DELETE FROM public.market_values
WHERE condition = 'Raw_NM'
  AND card_id IN (
  'mtg-65005522-555e-4479-939c-be16e0262f6f',  -- Shuri, Wakandan Inventor | stored $0.38 vs live $2.78
  'ygo-sdk-025',  -- Swordstalker | stored $0.71 vs live $34.99
  'ygo-sdk-034',  -- Two-Pronged Attack | stored $0.28 vs live $5.55
  'ygo-mrl-e111',  -- Flame Swordsman | stored $3 vs live $69.98
  'ygo-mrl-e124',  -- M-Warrior #2 | stored $0.18 vs live $1.22
  'ygo-sd8-en015',  -- Harpie Lady 3 | stored $0.26 vs live $5.25
  'ygo-dr04-en059',  -- Dimension Wall | stored $0.91 vs live $14.99
  'ygo-dr04-en122',  -- Hamon, Lord of Striking Th | stored $8.32 vs live $93.99
  'ygo-dr04-en090',  -- VW-Tiger Catapult | stored $0.15 vs live $0.89
  'ygo-dr04-en079',  -- Rapid-Fire Magician | stored $11.99 vs live $60
  'mtg-522aa72b-2b8c-484c-872b-f082101cee35',  -- Get Lost | stored $0.28 vs live $6
  'ygo-dr2-en136',  -- Atomic Firefly | stored $0.19 vs live $3.03
  'ygo-dr2-en181',  -- Desertapir | stored $0.05 vs live $0.7
  'mtg-4c617bcd-05f8-40c2-bb38-489bc863ce6b',  -- Prompto Argentum | stored $0.2 vs live $1
  'ygo-blc1-en030',  -- Destiny HERO - Malicious | stored $0.37 vs live $2.02
  'lorcana-1461',  -- Lady - Miss Park Avenue | stored $0.48 vs live $5.4
  'ygo-ch02-en041',  -- Charmers of the Grand Circ | stored $0.28 vs live $2.09
  'ygo-ch02-en028',  -- Spellbook of the Grand Cir | stored $0.3 vs live $1.25
  'ygo-cdip-en048',  -- Senet Switch | stored $0.05 vs live $0.37
  'mtg-00174be7-0dc8-43b9-81b6-f25a8c3fb4eb',  -- Archon of the Wild Rose | stored $0.05 vs live $0.38
  'ygo-bp02-en019',  -- Helping Robo for Combat | stored $0.16 vs live $0.98
  'ygo-ra05-en003'  -- Blue-Eyes Toon Dragon | stored $4.96 vs live $30.25
);

-- ============ Verify ============
-- Expect 0 rows.
SELECT card_id, condition, market_avg
FROM public.market_values
WHERE (condition = 'Near Mint' AND card_id IN (
  'SV2a-025',
  'SV2a-054',
  'SV2a-161',
  'SV2a-004',
  'SV2a-001',
  'SV2a-148',
  'SV2a-162',
  'SV2a-007',
  'SV2a-010',
  'SV2a-163',
  'SV2a-067',
  'SV2a-164',
  'SV2a-005',
  'SV2a-034',
  'SV2a-138',
  'SV2a-061',
  'SV2a-181',
  'SV2a-002',
  'SV2a-008',
  'SV2a-122',
  'SV2a-114',
  'SV2a-183',
  'mtg-33631d6c-c584-42ff-afe5-2647b5fb321f',
  'mtg-2d5819ca-165d-4f4c-9500-3ac206994880',
  'mtg-f498c1a4-54d2-4e87-952f-8cf7e408930c',
  'mtg-c2aadc25-7755-4bc8-a8af-b01d27eec364',
  'mtg-8c6a6d11-45cb-4def-a04b-51b91e1747db',
  'mtg-9b99894b-c774-45c2-9ee9-4d6a8e7522f5',
  'mtg-11fc8221-756a-4919-9272-38793e9c1ad9',
  'mtg-c1c7aa22-51b0-45ee-9a8e-5493a1820d8c',
  'mtg-14e821bb-55cc-474e-9b63-0ceecc2666c1',
  'mtg-9032f05b-5c21-4996-90c1-268dc6dffbaa',
  'mtg-2961cf20-33c8-4e66-9d0f-6daca8ea7880',
  'mtg-8ffaa5b3-00fa-46ea-918c-dfce0de9e898',
  'mtg-51524f8a-030c-4522-bfc0-d55c2c7c9326',
  'mtg-d7922c5f-d6ee-4b62-a537-3be5aa280e10',
  'mtg-3f1933a8-046f-471a-afcf-cfb08ca0d239',
  'mtg-5cc2d948-ac8b-4466-b604-3fabc0ab6bb9',
  'mtg-0d01bc37-ebf4-4f08-9beb-fef8787f8e7a',
  'mtg-aa8dbbb9-36a5-48e0-9e30-aeed0fb5d522',
  'mtg-845b0be1-4f85-4a8c-8205-dc85c8cf9a61',
  'mtg-26faf2db-ad86-462f-b61f-c1893c9aebbf',
  'mtg-8f8659f6-a793-4edc-8401-d9126840c1c2',
  'mtg-fb96ee86-5139-472a-9c4b-8a8a4280fc7e',
  'mtg-38e87542-50f7-4812-9338-84e4b9b7bb44',
  'mtg-2f80394b-2f7e-40a7-8203-720bcf39d71b',
  'mtg-339acb17-4b8e-4836-9cc5-8a0a946ebc73',
  'mtg-dec3dd36-b8ca-432b-8973-d37c6efc4c1a',
  'mtg-8f84ab0a-bf6e-4f28-9da8-998512a224ed',
  'mtg-29e82e97-79b3-4495-9aa0-a90242d594b2',
  'mtg-9b1f213a-e1d4-4a0f-954b-c83915698d98',
  'mtg-c3d5add1-0d0e-414b-a964-8da326472d35',
  'mtg-19dc5fcc-d05d-41a0-84c5-2dec996f3e4f',
  'mtg-17ef068b-61fc-443d-97b0-1e41f2622425',
  'mtg-6516f292-469d-4092-b099-97c698f373cd',
  'mtg-e0dbbdcf-84e1-494f-8b8c-0a094f603fa9',
  'mtg-e9b288fb-d122-4c9f-9dd9-d21856a6aac9',
  'mtg-236c437f-ee9d-4145-a4db-b665908089cf',
  'mtg-98df64ca-39c3-47e6-8143-4106c8e9cf59',
  'mtg-7aaefcf9-fbe1-4767-92a5-09825761d116',
  'SV5K-080',
  'SV5K-083',
  'SV5K-082',
  'SV5K-079',
  'SV5K-075',
  'SV5K-074',
  'SV5K-081',
  'SV5K-078',
  'SV5K-076',
  'SV5K-077',
  'SV5K-088',
  'SV5K-090',
  'SV5K-087',
  'ygo-rp01-en094',
  'SV4a-354',
  'SV4a-317',
  'SV4a-318',
  'SV4a-310',
  'SV4a-309',
  'SV4a-303',
  'SV4a-304',
  'SV4a-306',
  'SV4a-175',
  'SV4a-055',
  'SV4a-311',
  'SV4a-315',
  'SV4a-298',
  'SV4a-297',
  'SV4a-179',
  'SV4a-319',
  'SV4a-302',
  'SV4a-094',
  'SV4a-046',
  'SV4a-062',
  'SV4a-307',
  'SV4a-066',
  'SV4a-316',
  'SV4a-025',
  'SV4a-073',
  'SV4a-174',
  'SV4a-299',
  'SV4a-305',
  'SV4a-314',
  'SV4a-036',
  'SV4a-300',
  'SV4a-020',
  'SV4a-308',
  'SV4a-026',
  'SV4a-005',
  'SV4a-090',
  'SV4a-031',
  'SV4a-002',
  'SV4a-077',
  'SV4a-110',
  'SV4a-050',
  'SV4a-089',
  'SV4a-095',
  'SV4a-069',
  'SV4a-105',
  'SV4a-060',
  'SV4a-107',
  'SV4a-012',
  'SV4a-041',
  'SV4a-030',
  'SV4a-084',
  'SV4a-093',
  'SV4a-004',
  'SV4a-033',
  'SV4a-301',
  'SV4a-067',
  'SV4a-122',
  'SV4a-116',
  'SV11W-046',
  'SV11W-052',
  'SV11W-050',
  'SV11W-054',
  'SV11W-031',
  'SV11W-066',
  'SV11W-070',
  'SV11W-036',
  'SV11W-048',
  'SV11W-047',
  'SV11W-001',
  'SV11W-055',
  'SV11W-053',
  'SV11W-019',
  'SV11W-078',
  'SV11W-028',
  'SV11W-060',
  'SV11W-009',
  'SV11W-016',
  'SV11W-011',
  'SV11W-012',
  'SV11W-058',
  'SV11W-002',
  'SV11W-023',
  'SV11W-063',
  'SV11W-021',
  'SV11W-022',
  'SV11W-030',
  'SV11W-071',
  'SV11W-026',
  'SV11W-072',
  'SV11W-039',
  'SV11W-013',
  'SV11W-006',
  'SV11W-077',
  'SV11W-040',
  'SV11W-025',
  'SV11W-008',
  'SV11W-064',
  'SV11W-051',
  'SV11W-035',
  'SV11W-056',
  'SV11W-037',
  'SV11W-004',
  'SV11W-068',
  'SV11W-061',
  'SV11W-069',
  'SV11W-024',
  'SV11W-076',
  'SV11W-007',
  'SV11W-020',
  'SV11W-049',
  'SV11W-043',
  'SV11W-065',
  'SV11W-032',
  'SV11W-029',
  'SV11W-044',
  'SV11W-038',
  'SV11W-041',
  'SV11W-014',
  'SV11W-067',
  'SV11W-074',
  'SV11W-018',
  'SV11W-059',
  'SV11W-034',
  'SV11W-010',
  'SV11W-015',
  'SV11W-003',
  'SV11W-033',
  'SV11W-045',
  'SV11W-057',
  'SV8a-231',
  'SV8a-227',
  'SV8a-230',
  'SV8a-228',
  'SV8a-195',
  'SV8a-198',
  'SV8a-188',
  'ygo-bpro-en041',
  'op-prb-01-op05-119',
  'S12a-151',
  'S12a-157',
  'S12a-152',
  'S12a-121',
  'S12a-148',
  'S12a-023',
  'S12a-076',
  'S12a-081',
  'S12a-104',
  'S12a-057',
  'S12a-118',
  'S12a-010',
  'S12a-160',
  'S12a-022',
  'S12a-120',
  'S12a-154',
  'S12a-074',
  'S12a-093',
  'S12a-162',
  'S12a-017',
  'S12a-150',
  'S12a-105',
  'S12a-158',
  'ygo-dr2-en026',
  'ygo-dr2-en052',
  'op-op-01-op01-062',
  'mtg-bd31953a-7259-44e3-a94f-013bda68006d',
  'mtg-211a9764-3c60-46ba-bb53-e6692640ec8f',
  'mtg-3aa29fe8-1687-486f-b4df-c04977869ab1',
  'mtg-15ae4d50-be2f-412c-bb6b-b0a06b60474a',
  'ygo-blgg-en011',
  'mtg-590d1d95-ed13-4121-899f-f5a2d8a6617a',
  'ygo-op29-en009',
  'S9-071',
  'op-op-12-op12-061',
  'mtg-e9a268ba-c442-4fe4-90b4-2810c8474f4e',
  'op-op-10-op10-004',
  'SV3a-055',
  'ygo-dood-en009'
))
   OR (condition = 'Raw_NM' AND card_id IN (
  'mtg-65005522-555e-4479-939c-be16e0262f6f',
  'ygo-sdk-025',
  'ygo-sdk-034',
  'ygo-mrl-e111',
  'ygo-mrl-e124',
  'ygo-sd8-en015',
  'ygo-dr04-en059',
  'ygo-dr04-en122',
  'ygo-dr04-en090',
  'ygo-dr04-en079',
  'mtg-522aa72b-2b8c-484c-872b-f082101cee35',
  'ygo-dr2-en136',
  'ygo-dr2-en181',
  'mtg-4c617bcd-05f8-40c2-bb38-489bc863ce6b',
  'ygo-blc1-en030',
  'lorcana-1461',
  'ygo-ch02-en041',
  'ygo-ch02-en028',
  'ygo-cdip-en048',
  'mtg-00174be7-0dc8-43b9-81b6-f25a8c3fb4eb',
  'ygo-bp02-en019',
  'ygo-ra05-en003'
));
