#!/usr/bin/env node
// Weekly "Buy List" post graphic: renders wishlisted cards as a themed grid.
//
//   node scripts/buy-list-graphic.mjs --style street --theme type:Water
//   node scripts/buy-list-graphic.mjs --style clean  --theme set:เงามืด --title "Shadow Threat"
//   node scripts/buy-list-graphic.mjs --style wanted --theme value:top
//   node scripts/buy-list-graphic.mjs --theme pokemon:Suicune --cols 9 --count 81
//
// Themes (the point of the post — every graphic gets one):
//   type:<Water|Fire|...>   energy type        set:<name or id substring>
//   pokemon:<name>          name substring     game:<pokemon|onepiece|lorcana>
//   lang:<en|th|ja>         printing language  value:top | value:under:<baht>
//   rarity:<SR|SAR|...>     rarity code        all
//
// Cards come from the same wishlist aggregation as the admin Most Wishlisted
// board, so the post always reflects real demand.

import { readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// ---------------------------------------------------------------- env + args

// Values in .env.local are often quoted; the naive parser used across scripts/
// must strip them or the key reaches Supabase as a literal quoted string.
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
}

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}
const STYLE = arg('style', 'street')
const THEME = arg('theme', 'all')
const COUNT = Number(arg('count', 9))
const COLS = Number(arg('cols', 3))
const TITLE_OVERRIDE = arg('title', null)
const OUT = arg('out', null)
const DRY = argv.includes('--dry')

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// ------------------------------------------------------------------ data

const EXCHANGE_RATE = 1 / 0.028 // USD->THB, mirrors constants.ts EXCHANGE_RATES
const GRADED_RE = /\b(psa|bgs|cgc|sgc|tag|ace)\b/i

// Graded rows run many multiples of raw and must never set the display price.
function pickMarketValue(rows) {
    const ok = (Array.isArray(rows) ? rows : rows ? [rows] : []).filter(
        (r) => r && !GRADED_RE.test(String(r.condition || '').trim()),
    )
    const rank = (r) => (r.condition === 'Raw_NM' ? 0 : r.condition === 'Near Mint' ? 1 : 2)
    ok.sort((a, b) => rank(a) - rank(b) || (Date.parse(b.last_updated || '') || 0) - (Date.parse(a.last_updated || '') || 0))
    return ok[0] ?? null
}

function priceThb(row) {
    const mv = pickMarketValue(row.market_values)
    if (mv && mv.market_avg > 0) return Math.round(mv.currency === 'USD' ? mv.market_avg * EXCHANGE_RATE : mv.market_avg)
    const t = row.tcgplayer
    if (t && typeof t === 'object') {
        const p = t.prices ? (t.prices.holofoil || t.prices.normal || Object.values(t.prices)[0]) : null
        const usd = p?.market || p?.mid || p?.low
            || t.holofoil?.marketPrice || t.normal?.marketPrice || 0
        if (usd > 0) return Math.round(usd * EXCHANGE_RATE)
    }
    return 0
}

async function loadWishlistCards() {
    const PAGE = 1000, CHUNK = 100
    const agg = new Map()
    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
            .from('wishlists').select('card_id, added_at')
            .order('added_at', { ascending: false }).order('id').range(from, from + PAGE - 1)
        if (error) throw new Error(`wishlists: ${error.message}`)
        for (const r of data ?? []) {
            const hit = agg.get(r.card_id)
            if (hit) hit.wishers++
            else agg.set(r.card_id, { wishers: 1, lastAdded: r.added_at })
        }
        if (!data || data.length < PAGE) break
    }

    const ids = [...agg.keys()]
    const out = []
    for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK)
        const { data, error } = await supabase
            .from('pokemon_cards')
            .select('id, name, english_name, set_id, number, rarity, language, game, image_small, image_large, tcgplayer:raw_data->tcgplayer, types:raw_data->types, pokemon_sets(name), market_values(condition, market_avg, currency, last_updated)')
            .in('id', slice)
        if (error) throw new Error(`pokemon_cards: ${error.message}`)
        for (const r of data ?? []) {
            out.push({
                id: r.id,
                name: r.name,
                englishName: r.english_name,
                setId: r.set_id,
                setName: r.pokemon_sets?.name ?? '',
                number: r.number,
                rarity: r.rarity,
                language: r.language ?? 'en',
                game: r.game ?? 'pokemon',
                types: Array.isArray(r.types) ? r.types.filter((t) => typeof t === 'string') : [],
                image: r.image_large || r.image_small,
                imageFallback: r.image_small,
                price: priceThb(r),
                wishers: agg.get(r.id).wishers,
                listings: 0,
            })
        }
        for (let from = 0; ; from += PAGE) {
            const { data } = await supabase.from('listings').select('card_id')
                .eq('status', 'active').in('card_id', slice).order('id').range(from, from + PAGE - 1)
            for (const l of data ?? []) {
                const c = out.find((x) => x.id === l.card_id)
                if (c) c.listings++
            }
            if (!data || data.length < PAGE) break
        }
    }
    return out
}

// ------------------------------------------------------------------ themes

const GAME_LABEL = { pokemon: 'Pokémon', onepiece: 'One Piece', lorcana: 'Lorcana', mtg: 'Magic', yugioh: 'Yu-Gi-Oh!' }

function applyTheme(cards, spec) {
    const [kindRaw, ...rest] = spec.split(':')
    const kind = kindRaw.toLowerCase()
    const value = rest.join(':')
    const has = (s, q) => String(s ?? '').toLowerCase().includes(q.toLowerCase())

    switch (kind) {
        case 'type':
        case 'color':
            return { label: `${value} Type`, cards: cards.filter((c) => c.types.some((t) => t.toLowerCase() === value.toLowerCase())) }
        case 'set': {
            const hits = cards.filter((c) => has(c.setName, value) || has(c.setId, value))
            // Label from the matched set's real catalog name, so `set:MA5` prints
            // the Thai set title rather than the code that was typed.
            const names = hits.map((c) => c.setName).filter(Boolean)
            const common = names.sort(
                (a, b) => names.filter((n) => n === b).length - names.filter((n) => n === a).length,
            )[0]
            return { label: common || value, cards: hits }
        }
        case 'pokemon':
        case 'name':
            return { label: value, cards: cards.filter((c) => has(c.name, value) || has(c.englishName, value)) }
        case 'game':
            return { label: GAME_LABEL[value] ?? value, cards: cards.filter((c) => c.game === value) }
        case 'lang':
            return {
                label: { en: 'English Prints', th: 'Thai Prints', ja: 'Japanese Prints' }[value] ?? value,
                cards: cards.filter((c) => c.language === value),
            }
        case 'rarity':
            return { label: value.toUpperCase(), cards: cards.filter((c) => String(c.rarity ?? '').toLowerCase() === value.toLowerCase()) }
        case 'value':
            if (value.startsWith('under')) {
                const cap = Number(value.split(':')[1] || 500)
                return { label: `Under ${cap} Baht`, cards: cards.filter((c) => c.price > 0 && c.price <= cap) }
            }
            return { label: 'Chase Cards', cards: cards.filter((c) => c.price > 0).sort((a, b) => b.price - a.price) }
        case 'all':
            return { label: 'Most Wanted', cards: [...cards] }
        default:
            throw new Error(`Unknown theme "${spec}"`)
    }
}

// Rank so the most-wanted, highest-value cards lead — except value themes,
// which are already ordered by the thing they are about.
function rankForTheme(list, spec) {
    if (spec.startsWith('value:') && !spec.includes('under')) return list
    // A buy list entry with no price reads as incomplete, so unpriced cards sink
    // to the bottom and only appear when the theme can't fill the grid without.
    return list.sort((a, b) =>
        (a.price > 0 ? 0 : 1) - (b.price > 0 ? 0 : 1) || b.wishers - a.wishers || b.price - a.price)
}

// ------------------------------------------------------------------ drawing

const W = 1080, H = 1350
const CARD_RATIO = 63 / 88 // real card proportions; keeps art undistorted

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s, n) => (String(s ?? '').length > n ? String(s).slice(0, n - 1).trimEnd() + '…' : String(s ?? ''))
const baht = (n) => (n > 0 ? `฿${n.toLocaleString('en-US')}` : '—')
// librsvg gives no text metrics, so budget characters from the font size. 0.56em
// per glyph is the measured worst case for bold Segoe UI at these sizes; a looser
// estimate lets long card names run past the card edge.
// `em` is the average glyph advance for the face in use — Segoe UI sits near
// 0.56, but the wide slab display faces need ~0.66 or centred captions collide
// with the next column.
const fitChars = (width, fontSize, pad = 24, em = 0.56) =>
    Math.max(6, Math.floor((width - pad) / (fontSize * em)))
// Segoe UI covers Latin; fontconfig falls back to Leelawadee/Yu Gothic per
// glyph for Thai and Japanese card names, verified in render.
const FONT = "'Segoe UI','Leelawadee UI',Tahoma,Arial,sans-serif"

function layout({ cols, count, headerH, footerH, captionH = 0, gutter = 24, margin = 56 }) {
    const rows = Math.ceil(count / cols)
    const availW = W - margin * 2
    const availH = H - headerH - footerH
    let cw = (availW - gutter * (cols - 1)) / cols
    let ch = cw / CARD_RATIO
    // Height is usually the binding constraint for 3+ rows of tall cards.
    if (rows * (ch + captionH) + gutter * (rows - 1) > availH) {
        ch = (availH - gutter * (rows - 1) - captionH * rows) / rows
        cw = ch * CARD_RATIO
    }
    const gridW = cols * cw + gutter * (cols - 1)
    const gridH = rows * (ch + captionH) + gutter * (rows - 1)
    return {
        rows, cw: Math.floor(cw), ch: Math.floor(ch), gutter, captionH,
        left: Math.round((W - gridW) / 2),
        top: Math.round(headerH + (availH - gridH) / 2),
    }
}

const cellXY = (L, i) => ({
    x: Math.round(L.left + (i % (L.cols ?? 3)) * (L.cw + L.gutter)),
    y: Math.round(L.top + Math.floor(i / (L.cols ?? 3)) * (L.ch + L.captionH + L.gutter)),
})

async function tile(buf, w, h, radius, tint) {
    const layers = []
    if (tint) layers.push({ input: { create: { width: w, height: h, channels: 4, background: tint } }, blend: 'over' })
    if (radius > 0) {
        layers.push({
            input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`),
            blend: 'dest-in',
        })
    }
    const base = sharp(buf).resize(w, h, { fit: 'cover', position: 'centre' })
    return (layers.length ? base.composite(layers) : base).png().toBuffer()
}

// ------------------------------------------------------------------ styles

// Dark, brand-forward, high energy — mirrors the app's cyan/skewed-italic look.
function streetChrome(cards, L, meta) {
    const cells = cards.map((c, i) => {
        const { x, y } = cellXY(L, i)
        const fs = Math.max(13, Math.round(L.cw * 0.075))
        return `
      <rect x="${x - 2}" y="${y - 2}" width="${L.cw + 4}" height="${L.ch + 4}" rx="14" fill="none" stroke="#22d3ee" stroke-opacity="0.35" stroke-width="2"/>
      <rect x="${x}" y="${y + L.ch - Math.round(L.ch * 0.28)}" width="${L.cw}" height="${Math.round(L.ch * 0.28)}" rx="12" fill="url(#fade)"/>
      <text x="${x + 12}" y="${y + L.ch - 34}" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="#ffffff">${esc(clip(c.display, fitChars(L.cw, fs)))}</text>
      <text x="${x + 12}" y="${y + L.ch - 13}" font-family="${FONT}" font-size="${fs + 3}" font-weight="800" fill="#22d3ee">${esc(baht(c.price))}</text>
      ${c.listings === 0 ? `<rect x="${x + L.cw - 74}" y="${y + 10}" width="64" height="22" rx="11" fill="#ef4444" fill-opacity="0.92"/>
      <text x="${x + L.cw - 42}" y="${y + 25}" text-anchor="middle" font-family="${FONT}" font-size="11" font-weight="800" fill="#ffffff">0 LISTED</text>` : ''}`
    }).join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="55%" stop-color="#000000" stop-opacity="0.82"/><stop offset="100%" stop-color="#000000" stop-opacity="0.95"/>
      </linearGradient>
    </defs>
    <text x="56" y="70" font-family="${FONT}" font-size="19" font-weight="800" letter-spacing="6" fill="#22d3ee">CARDSTREET · WEEKLY</text>
    <g transform="skewX(-8)">
      <text x="70" y="136" font-family="${FONT}" font-size="76" font-weight="800" fill="#ffffff">BUY LIST</text>
    </g>
    <rect x="56" y="158" width="${18 + meta.label.length * 17}" height="40" rx="20" fill="#22d3ee" fill-opacity="0.16" stroke="#22d3ee" stroke-opacity="0.5"/>
    <text x="${56 + (18 + meta.label.length * 17) / 2}" y="185" text-anchor="middle" font-family="${FONT}" font-size="21" font-weight="800" fill="#22d3ee">${esc(meta.label.toUpperCase())}</text>
    <text x="${W - 56}" y="128" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="700" fill="#64748b">${esc(meta.dateLabel)}</text>
    <text x="${W - 56}" y="185" text-anchor="end" font-family="${FONT}" font-size="17" font-weight="700" fill="#94a3b8">${meta.unlisted} of ${meta.total} have no seller</text>
    ${cells}
    <rect x="0" y="${H - 92}" width="${W}" height="92" fill="#22d3ee"/>
    <text x="56" y="${H - 50}" font-family="${FONT}" font-size="27" font-weight="800" fill="#04121a">มีการ์ดพวกนี้ไหม? ลงขายได้เลย</text>
    <text x="56" y="${H - 22}" font-family="${FONT}" font-size="19" font-weight="700" fill="#04121a" fill-opacity="0.75">Got these? List them free — cardstreet.app</text>
  </svg>`
}

// Light, editorial, generous whitespace — reads as premium rather than promo.
function cleanChrome(cards, L, meta) {
    const cells = cards.map((c, i) => {
        const { x, y } = cellXY(L, i)
        const fs = Math.max(12, Math.round(L.cw * 0.072))
        return `
      <text x="${x + L.cw / 2}" y="${y + L.ch + 24}" text-anchor="middle" font-family="${FONT}" font-size="${fs}" font-weight="600" fill="#1f2937">${esc(clip(c.display, fitChars(L.cw, fs, 4)))}</text>
      <text x="${x + L.cw / 2}" y="${y + L.ch + 44}" text-anchor="middle" font-family="${FONT}" font-size="${fs}" font-weight="700" fill="#9ca3af">${esc(baht(c.price))}</text>`
    }).join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <text x="${W / 2}" y="78" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" letter-spacing="7" fill="#9ca3af">WEEKLY BUY LIST</text>
    <text x="${W / 2}" y="140" text-anchor="middle" font-family="${FONT}" font-size="54" font-weight="700" fill="#111827">${esc(meta.label)}</text>
    <text x="${W / 2}" y="176" text-anchor="middle" font-family="${FONT}" font-size="19" font-weight="500" fill="#6b7280">Cards our collectors are looking for</text>
    <line x1="${W / 2 - 40}" y1="200" x2="${W / 2 + 40}" y2="200" stroke="#d1d5db" stroke-width="2"/>
    ${cells}
    <line x1="56" y1="${H - 78}" x2="${W - 56}" y2="${H - 78}" stroke="#e5e7eb" stroke-width="1"/>
    <text x="${W / 2}" y="${H - 42}" text-anchor="middle" font-family="${FONT}" font-size="21" font-weight="700" letter-spacing="2" fill="#111827">cardstreet.app</text>
  </svg>`
}

// Demand board — foregrounds the real insight: almost nobody is selling these.
function wantedChrome(cards, L, meta) {
    const cells = cards.map((c, i) => {
        const { x, y } = cellXY(L, i)
        const fs = Math.max(13, Math.round(L.cw * 0.078))
        return `
      <rect x="${x}" y="${y + L.ch - Math.round(L.ch * 0.24)}" width="${L.cw}" height="${Math.round(L.ch * 0.24)}" fill="url(#dim)"/>
      <text x="${x + 10}" y="${y + L.ch - 32}" font-family="${FONT}" font-size="${fs}" font-weight="800" fill="#ffffff">${esc(clip(c.display, fitChars(L.cw, fs, 20)))}</text>
      <text x="${x + 10}" y="${y + L.ch - 11}" font-family="${FONT}" font-size="${fs + 4}" font-weight="800" fill="#fbbf24">${esc(baht(c.price))}</text>
      ${c.listings === 0
                // Stamped over the art, so it needs its own dark plate to stay
                // legible; the rotated box is inset far enough to never clip.
                ? `<g transform="rotate(-8 ${x + L.cw - 62} ${y + 30})">
      <rect x="${x + L.cw - 116}" y="${y + 14}" width="108" height="32" rx="3" fill="#0c0a09" fill-opacity="0.72" stroke="#ef4444" stroke-width="3"/>
      <text x="${x + L.cw - 62}" y="${y + 36}" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" letter-spacing="1" fill="#ef4444">WANTED</text></g>`
                : `<rect x="${x + L.cw - 104}" y="${y + 14}" width="96" height="30" rx="4" fill="#16a34a"/>
      <text x="${x + L.cw - 56}" y="${y + 35}" text-anchor="middle" font-family="${FONT}" font-size="15" font-weight="800" fill="#ffffff">${c.listings} LISTED</text>`}`
    }).join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="dim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0c0a09" stop-opacity="0"/><stop offset="45%" stop-color="#0c0a09" stop-opacity="0.85"/><stop offset="100%" stop-color="#0c0a09" stop-opacity="0.96"/>
    </linearGradient></defs>
    <rect x="0" y="0" width="${W}" height="196" fill="#dc2626"/>
    <text x="56" y="86" font-family="${FONT}" font-size="72" font-weight="800" letter-spacing="4" fill="#ffffff">WANTED</text>
    <text x="56" y="130" font-family="${FONT}" font-size="26" font-weight="800" fill="#fee2e2">${esc(meta.label.toUpperCase())}</text>
    <text x="56" y="168" font-family="${FONT}" font-size="19" font-weight="600" fill="#fecaca">${meta.unlisted} of ${meta.total} wanted cards have no seller on CardStreet</text>
    ${cells}
    <rect x="0" y="${H - 96}" width="${W}" height="96" fill="#0c0a09"/>
    <text x="56" y="${H - 52}" font-family="${FONT}" font-size="28" font-weight="800" fill="#fbbf24">มีใบไหนอยู่ในกล่อง? ลงขายวันนี้</text>
    <text x="56" y="${H - 24}" font-family="${FONT}" font-size="19" font-weight="600" fill="#a8a29e">Sitting in your binder? List it free — cardstreet.app</text>
  </svg>`
}

// Anything drawn *behind* the card art (photo borders, drop shadows) must be an
// underlay — the chrome layer composites on top of the tiles and would hide it.
const wantedUnderlay = (cards, L) => cards.map((_, i) => {
    const { x, y } = cellXY(L, i)
    return `<rect x="${x - 6}" y="${y - 6}" width="${L.cw + 12}" height="${L.ch + 12}" rx="3" fill="#f5f0e4"/>`
}).join('')

const cleanUnderlay = (cards, L) => cards.map((_, i) => {
    const { x, y } = cellXY(L, i)
    return `<rect x="${x + 3}" y="${y + 9}" width="${L.cw}" height="${L.ch}" rx="10" fill="#000000" fill-opacity="0.05"/>
    <rect x="${x + 1}" y="${y + 4}" width="${L.cw}" height="${L.ch}" rx="10" fill="#000000" fill-opacity="0.06"/>`
}).join('')

// --- wanted poster -------------------------------------------------------
// Period display faces, verified to rasterize through librsvg on this box.
// Thai has no glyphs in any of them, so Thai copy is set in Leelawadee and the
// display faces are reserved for Latin — which is how real bilingual Thai
// print work is set anyway.
const POSTER_DISPLAY = "Playbill,'Bernard MT Condensed',Rockwell,serif"
const POSTER_SLAB = "'Rockwell Extra Bold',Rockwell,'Bookman Old Style',serif"
const POSTER_CAPS = "'Copperplate Gothic Bold','Engravers MT',Georgia,serif"
const POSTER_BODY = "'Century Schoolbook','Baskerville Old Face',Georgia,serif"
const POSTER_THAI = "'Leelawadee UI',Tahoma,sans-serif"
const INK = '#2b1d0e'
const INK_SOFT = '#6b5230'

// A hairline pair of rules — the cheapest, most period-correct divider there is.
const doubleRule = (x1, x2, y, w = 3) =>
    `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${w}" fill="${INK}"/>
     <rect x="${x1}" y="${y + w + 4}" width="${x2 - x1}" height="1.5" fill="${INK}" fill-opacity="0.8"/>`

const diamond = (cx, cy, r, fill = INK) =>
    `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fill}"/>`

// Photos pasted on paper: soft shadow, then an ink plate the art sits on top of.
const posterUnderlay = (cards, L) => cards.map((_, i) => {
    const { x, y } = cellXY(L, i)
    return `<rect x="${x + 3}" y="${y + 6}" width="${L.cw}" height="${L.ch}" fill="#2b1d0e" fill-opacity="0.22"/>
    <rect x="${x - 5}" y="${y - 5}" width="${L.cw + 10}" height="${L.ch + 10}" fill="${INK}"/>`
}).join('')

function posterChrome(cards, L, meta) {
    const M = 46          // printed border inset
    const bounty = cards.reduce((s, c) => s + c.price, 0)

    const cells = cards.map((c, i) => {
        const { x, y } = cellXY(L, i)
        const nameSize = Math.max(12, Math.round(L.cw * 0.088))
        const rewardSize = Math.max(13, Math.round(L.cw * 0.10))
        // Latin card names get the slab face; Thai names fall back to Leelawadee
        // so they stay legible instead of dropping to tofu.
        const isThai = /[฀-๿]/.test(c.display)
        return `
      <text x="${x + L.cw / 2}" y="${y + L.ch + 26}" text-anchor="middle" font-family="${isThai ? POSTER_THAI : POSTER_SLAB}" font-size="${nameSize}" ${isThai ? 'font-weight="700"' : ''} fill="${INK}">${esc(clip(c.display, fitChars(L.cw, nameSize, 0, isThai ? 0.58 : 0.66)))}</text>
      <text x="${x + L.cw / 2}" y="${y + L.ch + 26 + rewardSize + 8}" text-anchor="middle" font-family="${POSTER_DISPLAY}" font-size="${rewardSize}" letter-spacing="1" fill="${INK_SOFT}">REWARD ${esc(baht(c.price))}</text>`
    }).join('')

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" fill="none" stroke="${INK}" stroke-width="5"/>
    <rect x="${M + 10}" y="${M + 10}" width="${W - (M + 10) * 2}" height="${H - (M + 10) * 2}" fill="none" stroke="${INK}" stroke-width="1.5"/>

    <text x="${W / 2}" y="${M + 58}" text-anchor="middle" font-family="${POSTER_CAPS}" font-size="21" letter-spacing="7" fill="${INK_SOFT}">BY ORDER OF CARDSTREET</text>
    ${doubleRule(M + 34, W - M - 34, M + 74)}

    <text x="${W / 2}" y="${M + 172}" text-anchor="middle" font-family="${POSTER_DISPLAY}" font-size="104" letter-spacing="14" fill="${INK}">WANTED</text>

    ${diamond(W / 2 - 190, M + 205, 6)}
    <text x="${W / 2}" y="${M + 213}" text-anchor="middle" font-family="${POSTER_CAPS}" font-size="26" letter-spacing="4" fill="${INK}">${esc(meta.label.toUpperCase())}</text>
    ${diamond(W / 2 + 190, M + 205, 6)}

    ${cells}

    ${doubleRule(M + 34, W - M - 34, Math.min(L.top + L.rows * (L.ch + L.captionH) + L.gutter * (L.rows - 1) + 16, H - M - 122))}
    <text x="${W / 2}" y="${H - M - 78}" text-anchor="middle" font-family="${POSTER_DISPLAY}" font-size="40" letter-spacing="3" fill="${INK}">TOTAL REWARD ${esc(baht(bounty))}</text>
    <text x="${W / 2}" y="${H - M - 48}" text-anchor="middle" font-family="${POSTER_BODY}" font-size="17" fill="${INK_SOFT}">Reward = current market value. ${meta.unlisted} of ${meta.total} wanted cards have no seller.</text>
    <text x="${W / 2}" y="${H - M - 22}" text-anchor="middle" font-family="${POSTER_THAI}" font-size="18" font-weight="700" fill="${INK}">มีการ์ดพวกนี้ไหม? ลงขายฟรีที่ cardstreet.app</text>
  </svg>`
}

// Aged stock: warm gradient, foxing stains, fold creases, vignette, then grain.
async function paperBackground() {
    const stains = [
        [140, 260, 190, 0.05], [900, 190, 150, 0.04], [520, 700, 260, 0.035],
        [180, 1120, 210, 0.05], [940, 1010, 180, 0.045], [660, 420, 130, 0.03],
        [330, 880, 160, 0.03],
    ].map(([cx, cy, r, o], i) => `
    <radialGradient id="st${i}" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7a5a2a" stop-opacity="${o}"/>
      <stop offset="100%" stop-color="#7a5a2a" stop-opacity="0"/>
    </radialGradient>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.8}" fill="url(#st${i})"/>`).join('')

    const base = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="paper" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#f4e8ce"/><stop offset="45%" stop-color="#ecdcbb"/><stop offset="100%" stop-color="#dfcaa2"/>
      </linearGradient>
      <radialGradient id="vig" cx="50%" cy="45%" r="72%">
        <stop offset="0%" stop-color="#3a2a14" stop-opacity="0"/><stop offset="68%" stop-color="#3a2a14" stop-opacity="0.06"/><stop offset="100%" stop-color="#3a2a14" stop-opacity="0.30"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#paper)"/>
    <defs>${''}</defs>${stains}
    <rect x="${Math.round(W / 3)}" y="0" width="2" height="${H}" fill="#8a6a38" fill-opacity="0.05"/>
    <rect x="${Math.round((W / 3) * 2)}" y="0" width="2" height="${H}" fill="#8a6a38" fill-opacity="0.05"/>
    <rect x="0" y="${Math.round(H / 2)}" width="${W}" height="2" fill="#8a6a38" fill-opacity="0.05"/>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>
  </svg>`)

    const grain = await sharp({
        create: { width: W, height: H, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 7 } },
    }).png().toBuffer()

    return sharp(base).composite([{ input: grain, blend: 'soft-light' }]).png().toBuffer()
}

// The classic single-outlaw form: one card, one bounty. Best for a genuinely
// scarce chase card where the price alone carries the post.
function posterHeroChrome(cards, L, meta) {
    const c = cards[0]
    const M = 46
    const isThai = /[฀-๿]/.test(c.display)
    const nameSize = isThai ? 40 : 44

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect x="${M}" y="${M}" width="${W - M * 2}" height="${H - M * 2}" fill="none" stroke="${INK}" stroke-width="5"/>
    <rect x="${M + 10}" y="${M + 10}" width="${W - (M + 10) * 2}" height="${H - (M + 10) * 2}" fill="none" stroke="${INK}" stroke-width="1.5"/>

    <text x="${W / 2}" y="${M + 56}" text-anchor="middle" font-family="${POSTER_CAPS}" font-size="21" letter-spacing="7" fill="${INK_SOFT}">BY ORDER OF CARDSTREET</text>
    ${doubleRule(M + 34, W - M - 34, M + 72)}

    <text x="${W / 2}" y="${M + 186}" text-anchor="middle" font-family="${POSTER_DISPLAY}" font-size="118" letter-spacing="16" fill="${INK}">WANTED</text>
    ${diamond(W / 2 - 205, M + 222, 6)}
    <text x="${W / 2}" y="${M + 230}" text-anchor="middle" font-family="${POSTER_CAPS}" font-size="24" letter-spacing="5" fill="${INK}">IN ANY CONDITION</text>
    ${diamond(W / 2 + 205, M + 222, 6)}

    <text x="${W / 2}" y="978" text-anchor="middle" font-family="${isThai ? POSTER_THAI : POSTER_SLAB}" font-size="${nameSize}" ${isThai ? 'font-weight="700"' : ''} fill="${INK}">${esc(clip(c.display, fitChars(W - M * 2 - 80, nameSize, 0, isThai ? 0.58 : 0.66)))}</text>
    <text x="${W / 2}" y="1008" text-anchor="middle" font-family="${POSTER_BODY}" font-size="18" fill="${INK_SOFT}">${esc(clip(c.setName, 46))}${c.number ? ` &#183; No. ${esc(c.number)}` : ''}</text>
    ${doubleRule(M + 150, W - M - 150, 1032)}

    <text x="${W / 2}" y="1080" text-anchor="middle" font-family="${POSTER_CAPS}" font-size="20" letter-spacing="8" fill="${INK_SOFT}">REWARD</text>
    <text x="${W / 2}" y="1146" text-anchor="middle" font-family="${POSTER_DISPLAY}" font-size="70" letter-spacing="3" fill="${INK}">${esc(baht(c.price))}</text>
    ${doubleRule(M + 150, W - M - 150, 1168)}

    <text x="${W / 2}" y="1208" text-anchor="middle" font-family="${POSTER_BODY}" font-size="17" fill="${INK_SOFT}">Reward = current market value. ${meta.unlisted} of ${meta.total} wanted cards have no seller.</text>
    <text x="${W / 2}" y="1240" text-anchor="middle" font-family="${POSTER_THAI}" font-size="19" font-weight="700" fill="${INK}">มีใบนี้ไหม? ลงขายฟรีที่ cardstreet.app</text>
  </svg>`
}

const STYLES = {
    'poster-hero': {
        chrome: posterHeroChrome, underlay: posterUnderlay, background: paperBackground,
        radius: 0, captionH: 0, tint: { r: 255, g: 236, b: 200, alpha: 0.10 },
        forceCount: 1,
        fixedLayout: () => ({ cw: 452, ch: 631, left: Math.round((W - 452) / 2), top: 300, rows: 1, captionH: 0, gutter: 0 }),
    },
    poster: {
        chrome: posterChrome, underlay: posterUnderlay, background: paperBackground,
        headerH: 276, footerH: 208, radius: 0, captionH: 46, gutter: 30,
        // Vivid modern art on aged stock reads as pasted-on; a light warm wash
        // marries the two without dulling the cards.
        tint: { r: 255, g: 236, b: 200, alpha: 0.10 },
    },
    street: { bg: '#080c11', chrome: streetChrome, headerH: 220, footerH: 120, radius: 12, captionH: 0 },
    clean: { bg: '#f7f6f3', chrome: cleanChrome, underlay: cleanUnderlay, headerH: 220, footerH: 110, radius: 10, captionH: 56 },
    wanted: { bg: '#1c1917', chrome: wantedChrome, underlay: wantedUnderlay, headerH: 226, footerH: 122, radius: 4, captionH: 0 },
}

async function background(style) {
    if (STYLES[style].background) return STYLES[style].background()
    if (style === 'street') {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <defs>
        <radialGradient id="g1" cx="85%" cy="8%" r="55%"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.20"/><stop offset="100%" stop-color="#22d3ee" stop-opacity="0"/></radialGradient>
        <radialGradient id="g2" cx="10%" cy="95%" r="55%"><stop offset="0%" stop-color="#a855f7" stop-opacity="0.18"/><stop offset="100%" stop-color="#a855f7" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="#080c11"/><rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
    </svg>`)
    }
    if (style === 'wanted') {
        return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#1c1917"/>
      ${Array.from({ length: 46 }, (_, i) => `<line x1="0" y1="${i * 30}" x2="${W}" y2="${i * 30}" stroke="#000000" stroke-opacity="0.16" stroke-width="1"/>`).join('')}
    </svg>`)
    }
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${STYLES[style].bg}"/></svg>`)
}

// ------------------------------------------------------------------- render

async function fetchImage(card) {
    for (const url of [card.image, card.imageFallback].filter(Boolean)) {
        try {
            const res = await fetch(url)
            if (!res.ok) continue
            const buf = Buffer.from(await res.arrayBuffer())
            await sharp(buf).metadata()
            return buf
        } catch { /* try the next source */ }
    }
    return null
}

async function main() {
    const style = STYLES[STYLE]
    if (!style) throw new Error(`Unknown style "${STYLE}". Use: ${Object.keys(STYLES).join(', ')}`)

    const all = await loadWishlistCards()
    const { label, cards: themed } = applyTheme(all, THEME)

    // One Piece art carries a burned-in SAMPLE watermark on ~85% of the catalog, but
    // that comes from Bandai's own official card gallery -- optcgapi is byte-identical
    // to it, and Limitless and TCGplayer redistribute the same art. There is no clean
    // bulk source to re-source from, and every competing site shows the same thing, so
    // One Piece ships by default. --exclude-onepiece drops it from a specific post.
    const withArt = themed.filter((c) => c.image)
    const blocked = argv.includes('--exclude-onepiece') ? withArt.filter((c) => c.game === 'onepiece') : []
    const pool = rankForTheme(withArt.filter((c) => !blocked.includes(c)), THEME)
    if (blocked.length) console.log(`  excluded ${blocked.length} One Piece cards (--exclude-onepiece)`)

    const meta = {
        label: TITLE_OVERRIDE ?? label,
        total: all.length,
        unlisted: all.filter((c) => c.listings === 0).length,
        dateLabel: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    }

    // Single-card styles pin their own count; the grid styles take --count.
    const count = style.forceCount ?? COUNT
    const cols = style.forceCount ? 1 : COLS

    console.log(`theme "${THEME}" -> ${themed.length} cards (${pool.length} usable); using ${Math.min(count, pool.length)}`)
    if (pool.length < count) console.log(`  NOTE: theme is short of ${count}; grid will be partial`)
    if (DRY) {
        for (const c of pool.slice(0, count)) {
            console.log(`  ${String(c.wishers)}x ${baht(c.price).padStart(9)} [${c.rarity ?? '?'}|${c.types.join('/') || '-'}|${c.game}/${c.language}] ${c.englishName || c.name} — ${c.setName}`)
        }
        return
    }

    const L = style.fixedLayout
        ? { ...style.fixedLayout(), cols }
        : {
            ...layout({
                cols, count, headerH: style.headerH, footerH: style.footerH,
                captionH: style.captionH, ...(style.gutter ? { gutter: style.gutter } : {}),
            }),
            cols,
        }

    const chosen = []
    for (const card of pool) {
        if (chosen.length >= count) break
        const buf = await fetchImage(card)
        if (!buf) { console.log(`  skipped (no art): ${card.id}`); continue }
        // Prefer the English name where the catalog has one: the post is read by
        // both audiences and Latin text stays legible at grid scale.
        chosen.push({ ...card, buffer: buf, display: card.englishName || card.name })
    }
    if (!chosen.length) throw new Error('No cards with usable art for this theme')

    const tiles = await Promise.all(chosen.map((c) => tile(c.buffer, L.cw, L.ch, style.radius, style.tint)))
    const composites = tiles.map((input, i) => {
        const { x, y } = cellXY(L, i)
        return { input, left: x, top: y }
    })

    const layers = []
    if (style.underlay) {
        layers.push({
            input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${style.underlay(chosen, L)}</svg>`),
            left: 0, top: 0,
        })
    }
    layers.push(...composites, { input: Buffer.from(style.chrome(chosen, L, meta)), left: 0, top: 0 })

    const png = await sharp(await background(STYLE)).composite(layers).png().toBuffer()

    const outPath = OUT ?? path.join('scripts', 'out', 'buy-list', `${STYLE}-${THEME.replace(/[^a-z0-9]+/gi, '-')}.png`)
    mkdirSync(path.dirname(outPath), { recursive: true })
    await sharp(png).toFile(outPath)
    console.log(`wrote ${outPath} (${chosen.length} cards, ${COLS} cols)`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
