/**
 * Flash Express Open API Service Layer
 * https://open-docs.flashexpress.com/
 *
 * Implements all 4 core endpoints:
 *   1. Create Order   — POST /open/v3/orders
 *   2. Print Label     — POST /open/v1/orders/{pno}/pre_print
 *   3. Notify Courier  — POST /open/v1/notify
 *   4. Track Shipment  — POST /open/v1/orders/{pno}/routes
 *
 * Plus: Cancel Order   — POST /open/v1/orders/{pno}/cancel
 */

import crypto from 'crypto';
import { resolveFlashLeg, canonicalCapitalForProvince } from '@/lib/thaiAdminAreas';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface FlashConfig {
    baseUrl: string;
    mchId: string;
    apiKey: string;
}

function getFlashConfig(): FlashConfig {
    // Trim all env values defensively. Vercel's env var UI sometimes captures
    // trailing whitespace / \r\n from pasted values; Flash signs the request
    // body byte-for-byte, so a stray newline turns "CBG5424" into something
    // Flash can't find ("Customer not found", code 1001) even though every-
    // thing else is correct.
    const env = (process.env.FLASH_EXPRESS_ENV || 'training').trim();

    if (env === 'production') {
        const mchId = process.env.FLASH_EXPRESS_MCH_ID_PRODUCTION?.trim();
        const apiKey = process.env.FLASH_EXPRESS_KEY_PRODUCTION?.trim();

        if (!mchId || !apiKey) {
            throw new Error('[FlashExpress] Missing Production Credentials (FLASH_EXPRESS_MCH_ID_PRODUCTION or FLASH_EXPRESS_KEY_PRODUCTION)');
        }

        return {
            baseUrl: 'https://open-api.flashexpress.com',
            mchId,
            apiKey,
        };
    }

    // Training environment — also requires explicit credentials
    const mchId = process.env.FLASH_EXPRESS_MCH_ID_TRAINING?.trim();
    const apiKey = process.env.FLASH_EXPRESS_KEY_TRAINING?.trim();

    if (!mchId || !apiKey) {
        throw new Error('[FlashExpress] Missing Training Credentials (FLASH_EXPRESS_MCH_ID_TRAINING or FLASH_EXPRESS_KEY_TRAINING). Set these environment variables or switch FLASH_EXPRESS_ENV to production.');
    }

    return {
        baseUrl: 'https://open-api-tra.flashexpress.com',
        mchId,
        apiKey,
    };
}

// ---------------------------------------------------------------------------
// Signature Algorithm (SHA256)
// https://open-docs.flashexpress.com/#signature-algorithm
// ---------------------------------------------------------------------------

function generateNonceStr(): string {
    return Date.now().toString() + crypto.randomBytes(4).toString('hex');
}

/**
 * Generates a SHA256 signature per Flash Express specification:
 * 1. Filter out empty/blank values and the 'sign' key itself
 * 2. Sort keys alphabetically (ASCII ascending)
 * 3. Join as key=value& pairs
 * 4. Append &key=API_KEY
 * 5. SHA256 hash → UPPERCASE hex
 */
function generateSignature(params: Record<string, string>, apiKey: string): string {
    // Filter empty/whitespace-only values and 'sign'
    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(params)) {
        if (k === 'sign') continue;
        if (v === undefined || v === null) continue;
        if (typeof v === 'string' && v.trim() === '') continue;
        filtered[k] = String(v);
    }

    // Sort by key name (ASCII / dictionary order)
    const sortedKeys = Object.keys(filtered).sort();

    // Build stringA
    const stringA = sortedKeys.map(k => `${k}=${filtered[k]}`).join('&');

    // Append API key
    const stringSignTemp = `${stringA}&key=${apiKey}`;

    // SHA256 → uppercase
    return crypto.createHash('sha256').update(stringSignTemp, 'utf8').digest('hex').toUpperCase();
}

// ---------------------------------------------------------------------------
// HTTP Client
// ---------------------------------------------------------------------------

interface FlashResponse {
    code: number;
    message: string;
    tid?: string;
    data: any;
}

/**
 * Makes a signed POST request to the Flash Express API.
 * Content-Type: application/x-www-form-urlencoded
 */
async function makeFlashRequest(
    endpoint: string,
    extraParams: Record<string, string> = {}
): Promise<FlashResponse> {
    const config = getFlashConfig();

    const params: Record<string, string> = {
        mchId: config.mchId,
        nonceStr: generateNonceStr(),
        ...extraParams,
    };

    params.sign = generateSignature(params, config.apiKey);

    const body = new URLSearchParams(params).toString();
    const url = `${config.baseUrl}${endpoint}`;

    console.log(`[FlashExpress] POST ${url}`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'Accept-Language': 'en',
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[FlashExpress] HTTP ${response.status}: ${text}`);
        throw new Error(`Flash Express API error: HTTP ${response.status}`);
    }

    const json: FlashResponse = await response.json();

    if (json.code !== 1) {
        console.error(`[FlashExpress] API Error:`, json);
        let errorMsg = json.message || 'Unknown error';
        if (json.code === 1001) {
            errorMsg = `Customer not found (code: 1001). This usually means your Merchant ID (${config.mchId}) is invalid for the ${process.env.FLASH_EXPRESS_ENV || 'training'} environment. Please verify your Merchant ID in settings.`;
        }
        // Flash puts the useful validation detail in `data`, keyed by field
        // (e.g. { base: ['Consignee region does not match'] }) while `message`
        // is a generic "Failed to submit". Fold the detail into the thrown
        // message so callers (and isRegionError) can act on it.
        const detail =
            json.data && typeof json.data === 'object'
                ? Object.values(json.data as Record<string, unknown>)
                    .flatMap(v => (Array.isArray(v) ? v : [v]))
                    .filter((v): v is string => typeof v === 'string')
                    .join('; ')
                : '';
        throw new Error(`Flash Express: ${errorMsg}${detail ? ` — ${detail}` : ''} (code: ${json.code})`);
    }

    return json;
}

/**
 * Makes a signed POST request that returns a binary stream (PDF label).
 */
async function makeFlashBinaryRequest(
    endpoint: string,
    extraParams: Record<string, string> = {}
): Promise<Buffer> {
    const config = getFlashConfig();

    const params: Record<string, string> = {
        mchId: config.mchId,
        nonceStr: generateNonceStr(),
        ...extraParams,
    };

    params.sign = generateSignature(params, config.apiKey);

    const body = new URLSearchParams(params).toString();
    const url = `${config.baseUrl}${endpoint}`;

    console.log(`[FlashExpress] POST ${url} (binary/label)`);

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/pdf, */*',
        },
        body,
    });

    if (!response.ok) {
        const text = await response.text();
        console.error(`[FlashExpress] Label HTTP ${response.status}: ${text}`);
        throw new Error(`Flash Express label error: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // If the response is JSON, it's an error
    if (contentType.includes('application/json')) {
        const json = await response.json();
        console.error(`[FlashExpress] Label API Error Payload:`, JSON.stringify(json, null, 2));
        throw new Error(`Flash Express label error: ${json.message || 'Unknown error'} (code: ${json.code})`);
    }

    if (!contentType.includes('application/pdf')) {
        console.warn(`[FlashExpress] Expected PDF but got ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface FlashOrderParams {
    outTradeNo: string;       // CardStreet order ID
    // Source (seller)
    srcName: string;
    srcPhone: string;
    srcProvinceName: string;
    srcCityName: string;       // อำเภอ/เขต
    srcDistrictName: string;   // ตำบล/แขวง
    srcPostalCode: string;
    srcDetailAddress: string;
    // Destination (buyer)
    dstName: string;
    dstPhone: string;
    dstProvinceName: string;
    dstCityName: string;
    dstDistrictName: string;
    dstPostalCode: string;
    dstDetailAddress: string;
    // Package details
    weight?: number;           // grams, default 500
    width?: number;            // cm
    length?: number;           // cm
    height?: number;           // cm
    expressCategory?: number;  // 1=standard, 2=next day
    articleCategory?: number;  // 1=documents, 2=parcels, 3=valuables
    remark?: string;
}

export interface FlashOrderResult {
    pno: string;              // Flash tracking number (e.g. "TH0112XXXXXX")
    mchId: string;
    outTradeNo: string;
    sortCode: string;
    dstStoreName: string;
}

export interface FlashRateParams {
    srcProvinceName: string;
    srcCityName: string;
    srcPostalCode: string;
    dstProvinceName: string;
    dstCityName: string;
    dstPostalCode: string;
    weight: number;            // grams
    width?: number;            // cm
    length?: number;           // cm
    height?: number;           // cm
    expressCategory?: number;  // 1=standard, 2=flash speed
}

export interface FlashRateResult {
    estimatePrice: number;     // in cents
    upCountryAmount: number;   // in cents
    pricePolicy: number;       // 1: weight-based, 2: dimension-based
}

/**
 * 1. Create Order — POST /open/v3/orders
 */
export async function createShipment(params: FlashOrderParams): Promise<FlashOrderResult> {
    const requestParams: Record<string, string> = {
        outTradeNo: params.outTradeNo,
        srcName: params.srcName,
        srcPhone: params.srcPhone,
        srcProvinceName: params.srcProvinceName,
        srcCityName: params.srcCityName,
        srcDistrictName: params.srcDistrictName,
        srcPostalCode: params.srcPostalCode,
        srcDetailAddress: params.srcDetailAddress,
        dstName: params.dstName,
        dstPhone: params.dstPhone,
        dstProvinceName: params.dstProvinceName,
        dstCityName: params.dstCityName,
        dstDistrictName: params.dstDistrictName,
        dstPostalCode: params.dstPostalCode,
        dstDetailAddress: params.dstDetailAddress,
        weight: String(Math.round(params.weight || 500)),
        width: String(Math.round(params.width || 1)),
        length: String(Math.round(params.length || 1)),
        height: String(Math.round(params.height || 1)),
        expressCategory: String(params.expressCategory || 1),
        articleCategory: String(params.articleCategory || 3), // 3 = valuables (trading cards)
        codEnabled: '0',   // No COD — CardStreet uses Stripe prepayment
        insured: '0',
    };

    if (params.remark) {
        requestParams.remark = params.remark;
    }

    const response = await makeFlashRequest('/open/v3/orders', requestParams);

    return {
        pno: response.data.pno,
        mchId: response.data.mchId,
        outTradeNo: response.data.outTradeNo,
        sortCode: response.data.sortCode || '',
        dstStoreName: response.data.dstStoreName || '',
    };
}

/**
 * createShipment with the same region-mismatch retry as
 * estimateRateWithCityFallback: if Flash rejects the waybill because a
 * profile's city field isn't a real อำเภอ/เขต (a blocked SALE, not just a bad
 * quote), retry once with the canonical provincial-capital districts. The
 * postcode and full detail address are unchanged — they're what routing and
 * the courier actually deliver by — so the parcel still reaches the buyer.
 * Safe to retry: the first call failed, so no waybill was minted (no duplicate
 * pno risk). Non-region errors propagate untouched.
 */
export async function createShipmentWithCityFallback(
    params: FlashOrderParams,
): Promise<FlashOrderResult & { usedCanonicalCity: boolean }> {
    try {
        return { ...(await createShipment(params)), usedCanonicalCity: false };
    } catch (err) {
        if (!isRegionError(err)) throw err;

        // Rung 2: repair each leg against the canonical dataset — spelling,
        // khet/khwaeng swap, postcode-guided recovery. Unlike the old
        // city-only substitution, this also fixes districtName: createShipment
        // validates the full trio, so swapping the city alone could never
        // rescue a bad-district address (order d307f84c, 2026-07-30).
        const src = resolveFlashLeg({
            provinceName: params.srcProvinceName,
            cityName: params.srcCityName,
            districtName: params.srcDistrictName,
            postalCode: params.srcPostalCode,
        });
        const dst = resolveFlashLeg({
            provinceName: params.dstProvinceName,
            cityName: params.dstCityName,
            districtName: params.dstDistrictName,
            postalCode: params.dstPostalCode,
        });
        if (src?.changed || dst?.changed) {
            console.warn(
                `[FlashExpress] Region mismatch creating waybill for ${params.outTradeNo} — retrying with dataset-resolved names`,
            );
            try {
                const retried = await createShipment({
                    ...params,
                    ...(src ? { srcProvinceName: src.provinceName, srcCityName: src.cityName, srcDistrictName: src.districtName } : {}),
                    ...(dst ? { dstProvinceName: dst.provinceName, dstCityName: dst.cityName, dstDistrictName: dst.districtName } : {}),
                });
                return { ...retried, usedCanonicalCity: true };
            } catch (err2) {
                if (!isRegionError(err2)) throw err2;
            }
        }

        // Rung 3: last resort — provincial-capital trio per leg (always
        // dataset-valid). The postcode and full detail address are unchanged —
        // they're what routing and the courier actually deliver by. If even
        // the province can't be resolved, let the region error propagate (the
        // manual-label path alerts support) rather than mint a waybill into
        // the wrong province.
        const srcCap = canonicalCapitalForProvince(src?.provinceName || params.srcProvinceName);
        const dstCap = canonicalCapitalForProvince(dst?.provinceName || params.dstProvinceName);
        if (!srcCap || !dstCap) throw err;
        console.warn(
            `[FlashExpress] Region mismatch persists for ${params.outTradeNo} — retrying with provincial-capital districts`,
        );
        const retried = await createShipment({
            ...params,
            srcProvinceName: srcCap.provinceName,
            srcCityName: srcCap.cityName,
            srcDistrictName: srcCap.districtName,
            dstProvinceName: dstCap.provinceName,
            dstCityName: dstCap.cityName,
            dstDistrictName: dstCap.districtName,
        });
        return { ...retried, usedCanonicalCity: true };
    }
}

/**
 * 2. Print Label (Big 100x180mm) — POST /open/v1/orders/{pno}/pre_print
 * Returns the raw PDF buffer.
 */
export async function generateLabel(pno: string): Promise<Buffer> {
    return makeFlashBinaryRequest(`/open/v1/orders/${encodeURIComponent(pno)}/pre_print`);
}

/**
 * 2.1 Freight Inquiry (Estimate Rate) — POST /open/v1/orders/estimate_rate
 */
export async function estimateRate(params: FlashRateParams): Promise<FlashRateResult> {
    const requestParams: Record<string, string> = {
        srcProvinceName: params.srcProvinceName,
        srcCityName: params.srcCityName,
        srcPostalCode: params.srcPostalCode,
        dstProvinceName: params.dstProvinceName,
        dstCityName: params.dstCityName,
        dstPostalCode: params.dstPostalCode,
        weight: String(Math.round(params.weight)),
        expressCategory: String(params.expressCategory || 1),
    };

    if (params.width) requestParams.width = String(Math.round(params.width));
    if (params.length) requestParams.length = String(Math.round(params.length));
    if (params.height) requestParams.height = String(Math.round(params.height));

    const response = await makeFlashRequest('/open/v1/orders/estimate_rate', requestParams);

    // Flash returns these as STRINGS ("2800"), even though the fields look
    // numeric. Coerce to Number — otherwise callers doing
    // `estimatePrice + upCountryAmount` get string concatenation
    // ("2800" + "0" = "28000" → ฿280 instead of ฿28).
    return {
        estimatePrice: Number(response.data.estimatePrice) || 0,
        upCountryAmount: Number(response.data.upCountryAmount) || 0,
        pricePolicy: Number(response.data.pricePolicy) || 0,
    };
}

/**
 * estimateRate with a region-mismatch retry. Profiles saved through the old
 * Google Places parsing often carry a ตำบล (sub-district) in the field used as
 * Flash's city name; Flash then rejects the quote ("Consignee region does not
 * match") and callers previously dropped straight to the flat ฿90 fallback —
 * ~2.5x the real freight on measured routes. Retrying once with the canonical
 * provincial-capital district (postcodes unchanged — Flash tolerates a
 * postcode from a sibling district and prices off it) recovers a live,
 * route-accurate quote. Non-region failures (auth, network) are NOT retried;
 * they propagate to the caller's flat fallback as before.
 */
export async function estimateRateWithCityFallback(
    params: FlashRateParams,
): Promise<FlashRateResult & { usedCanonicalCity: boolean }> {
    try {
        return { ...(await estimateRate(params)), usedCanonicalCity: false };
    } catch (err) {
        if (!isRegionError(err)) throw err;

        // Rung 2: dataset-resolved province+city (rates have no district
        // param). Keeps the quote on the real route — e.g. a misspelled city
        // with a valid postcode resolves to its actual district instead of
        // being priced from the provincial capital.
        const src = resolveFlashLeg({
            provinceName: params.srcProvinceName,
            cityName: params.srcCityName,
            districtName: null,
            postalCode: params.srcPostalCode,
        });
        const dst = resolveFlashLeg({
            provinceName: params.dstProvinceName,
            cityName: params.dstCityName,
            districtName: null,
            postalCode: params.dstPostalCode,
        });
        const srcChanged = src && (src.provinceName !== params.srcProvinceName || src.cityName !== params.srcCityName);
        const dstChanged = dst && (dst.provinceName !== params.dstProvinceName || dst.cityName !== params.dstCityName);
        if (srcChanged || dstChanged) {
            try {
                const retried = await estimateRate({
                    ...params,
                    ...(src ? { srcProvinceName: src.provinceName, srcCityName: src.cityName } : {}),
                    ...(dst ? { dstProvinceName: dst.provinceName, dstCityName: dst.cityName } : {}),
                });
                return { ...retried, usedCanonicalCity: true };
            } catch (err2) {
                if (!isRegionError(err2)) throw err2;
            }
        }

        // Rung 3: provincial capital, as before. Unresolvable province —
        // propagate; callers already fall back to the flat rate.
        const srcCap = canonicalCapitalForProvince(src?.provinceName || params.srcProvinceName);
        const dstCap = canonicalCapitalForProvince(dst?.provinceName || params.dstProvinceName);
        if (!srcCap || !dstCap) throw err;
        const retried = await estimateRate({
            ...params,
            srcProvinceName: srcCap.provinceName,
            srcCityName: srcCap.cityName,
            dstProvinceName: dstCap.provinceName,
            dstCityName: dstCap.cityName,
        });
        return { ...retried, usedCanonicalCity: true };
    }
}

// ---------------------------------------------------------------------------
// Fallback shipping cost
// ---------------------------------------------------------------------------

const BANGKOK_FALLBACK_SATANG = 40 * 100;     // ฿40
const UPCOUNTRY_FALLBACK_SATANG = 90 * 100;   // ฿90

/**
 * True when a province string refers to Bangkok, tolerant of the spellings we
 * actually store (Thai กรุงเทพมหานคร / กทม from Google Places, or "Bangkok").
 */
export function isBangkokProvince(province?: string | null): boolean {
    if (!province) return false;
    const p = province.trim().toLowerCase();
    return p.includes('กรุงเทพ') || p.includes('กทม') || p.includes('bangkok');
}

/**
 * The official Thai province name Flash's region table accepts. Only Bangkok
 * has aliases in our data ("กทม.", "Bangkok"); other provinces pass through
 * unchanged. English province names from legacy manual entry can't be mapped
 * here and keep falling to the flat-rate path.
 */
export function canonicalProvinceForFlash(province?: string | null): string {
    const p = (province || '').trim();
    return isBangkokProvince(p) ? 'กรุงเทพมหานคร' : p;
}

/**
 * A city (อำเภอ/เขต) name Flash is guaranteed to accept for the province: the
 * provincial-capital district "เมือง<province>", or a central เขต for Bangkok
 * (which has no อำเภอเมือง). Used to retry rate quotes when a profile's city
 * field holds something Flash can't match — typically a ตำบล saved by the old
 * Google Places parsing. Freight pricing is province/postcode-driven, so
 * substituting the capital district keeps the quote accurate for the route.
 */
export function canonicalCityForProvince(province?: string | null): string {
    const p = canonicalProvinceForFlash(province);
    if (!p || isBangkokProvince(p)) return 'เขตบางรัก';
    return `เมือง${p}`;
}

/**
 * Fallback shipping cost in satang, used ONLY when a live estimateRate() call
 * fails (region mismatch, timeout, Flash outage). Real quotes always come from
 * Flash first; this is the safety net.
 *
 * ฿40 only when the whole shipment is within Bangkok (intra-Bangkok runs ~฿28
 * live, so ฿40 covers it). Anything touching an upcountry province runs ฿68–฿138
 * live, so we fall back to ฿90 — the platform is billed by Flash for every
 * label, so a low guess is a direct platform loss, not just a buyer discount.
 */
export function fallbackShippingSatang(
    srcProvince?: string | null,
    dstProvince?: string | null,
): number {
    return isBangkokProvince(srcProvince) && isBangkokProvince(dstProvince)
        ? BANGKOK_FALLBACK_SATANG
        : UPCOUNTRY_FALLBACK_SATANG;
}

/**
 * Estimated parcel weight in grams for a single-seller shipment of N cards.
 *
 * Flash bills by actual weight (and reconciles via the weight webhook), but the
 * buyer is charged the up-front estimate — so a low estimate is a platform loss
 * on the shipping it now recoups through the application fee. 500g (Flash's base
 * tier) comfortably covers a 1–4 card toploader/bubble-mailer parcel, so small
 * orders are unchanged; larger lots scale at ~110g/card (a graded slab plus its
 * share of packaging) and never below the 500g floor, so we never newly
 * under-quote. Deliberately platform-safe — a graded-aware model would be more
 * precise but needs per-card weight data we don't track yet.
 */
export function estimateParcelWeightGrams(cardCount: number): number {
    const n = Math.max(1, Math.floor(cardCount || 1));
    return Math.max(500, n * 110);
}

// ---------------------------------------------------------------------------
// Sealed-aware estimates
// ---------------------------------------------------------------------------

/**
 * The card_data fields the estimators need — matches the Card snapshot stored
 * on listings/collection items (isSealed + productType, absent for cards).
 */
export interface ParcelItemInfo {
    isSealed?: boolean;
    productType?: string | null;
}

/**
 * Per-unit weights for sealed products (grams, incl. packing share). Slightly
 * above typical retail weights on purpose: Flash bills actual weight at pickup,
 * so an over-quote is a small buyer premium while an under-quote is a platform
 * loss (buyer pays the estimate, seller pays Flash the actual).
 */
const SEALED_WEIGHT_GRAMS: Record<string, number> = {
    booster_box: 900,
    etb: 1100,
    booster_pack: 60,
    bundle: 500,
    collection: 900,
};
const SEALED_WEIGHT_DEFAULT_GRAMS = 700;

/**
 * Item-aware version of estimateParcelWeightGrams: cards at ~110g each, sealed
 * products at their per-type weight, never below Flash's 500g base tier.
 * Callers with card_data in hand (checkout, estimate, fulfillment) use this;
 * the card-count version stays for callers without item detail.
 */
export function estimateParcelWeightGramsForItems(items: ParcelItemInfo[]): number {
    const sealed = items.filter(i => i?.isSealed);
    if (sealed.length === 0) return estimateParcelWeightGrams(items.length);
    const sealedGrams = sealed.reduce(
        (sum, i) => sum + (SEALED_WEIGHT_GRAMS[i.productType || ''] ?? SEALED_WEIGHT_DEFAULT_GRAMS),
        0,
    );
    const cardCount = items.length - sealed.length;
    return Math.max(500, cardCount * 110 + sealedGrams);
}

/**
 * Item-aware version of estimateParcelDimsCm. A parcel with any sealed product
 * is a real box, not a bubble mailer: 25x20 footprint, 15 cm for the first
 * sealed unit (covers an ETB on its side), +8 cm per additional unit, plus the
 * card stack. Honest dims keep Flash from re-rating at the depot.
 */
export function estimateParcelDimsCmForItems(items: ParcelItemInfo[]): { width: number; length: number; height: number } {
    const sealedCount = items.filter(i => i?.isSealed).length;
    if (sealedCount === 0) return estimateParcelDimsCm(items.length);
    const cardCount = items.length - sealedCount;
    const height = 15 + (sealedCount - 1) * 8 + Math.ceil(cardCount / 4) * 2;
    return { width: 20, length: 25, height };
}

// ---------------------------------------------------------------------------
// Parcel dimensions
// ---------------------------------------------------------------------------

/**
 * Declared parcel dimensions (cm) for a single-seller shipment of N cards.
 *
 * Used for BOTH the rate estimate and the actual createShipment call so the
 * quote and the printed label describe the same box. Previously createShipment
 * passed no dims and defaulted to a 1x1x1 cm cube, which understates the parcel
 * and invites a re-rate at the depot. A toploader/bubble-mailer footprint
 * (10x15 cm) with height growing ~2 cm per 4-card stack — small enough to stay
 * in Flash's weight-based pricing tier (pricePolicy 1) for a properly packed
 * card mailer, so the quote matches the actual freight. A seller who ships in an
 * oversized box trips Flash's dimension-based pricing (pricePolicy 2) and pays
 * the difference at pickup; the orders.actual_shipping_fee / shipping_fee_delta
 * columns record it (see app/api/webhooks/flash).
 */
export function estimateParcelDimsCm(cardCount: number): { width: number; length: number; height: number } {
    const n = Math.max(1, Math.floor(cardCount || 1));
    return { width: 10, length: 15, height: Math.max(2, Math.ceil(n / 4) * 2) };
}

/**
 * 3. Notify Courier (Request Pickup) — POST /open/v1/notify
 */
export interface FlashPickupParams {
    srcName: string;
    srcPhone: string;
    srcProvinceName: string;
    srcCityName: string;
    srcDistrictName: string;
    srcPostalCode: string;
    srcDetailAddress: string;
    estimateParcelNumber?: number;
    remark?: string;
}

export interface FlashPickupResult {
    ticketPickupId: number;
    staffInfoName: string;
    staffInfoPhone: string;
    timeoutAtText: string;
}

export async function requestPickup(params: FlashPickupParams): Promise<FlashPickupResult> {
    const requestParams: Record<string, string> = {
        srcName: params.srcName,
        srcPhone: params.srcPhone,
        srcProvinceName: params.srcProvinceName,
        srcCityName: params.srcCityName,
        srcDistrictName: params.srcDistrictName,
        srcPostalCode: params.srcPostalCode,
        srcDetailAddress: params.srcDetailAddress,
        estimateParcelNumber: String(params.estimateParcelNumber || 1),
    };

    if (params.remark) {
        requestParams.remark = params.remark;
    }

    const response = await makeFlashRequest('/open/v1/notify', requestParams);

    return {
        ticketPickupId: response.data.ticketPickupId,
        staffInfoName: response.data.staffInfoName || '',
        staffInfoPhone: response.data.staffInfoPhone || '',
        timeoutAtText: response.data.timeoutAtText || '',
    };
}

/**
 * 4. Track Shipment — POST /open/v1/orders/{pno}/routes
 */
export interface FlashTrackingRoute {
    routedAt: number;
    routeAction: string;
    message: string;
    state: number;
}

export interface FlashTrackingResult {
    pno: string;
    state: number;
    stateText: string;
    stateChangeAt: number;
    routes: FlashTrackingRoute[];
}

export async function trackShipment(pno: string): Promise<FlashTrackingResult> {
    const response = await makeFlashRequest(`/open/v1/orders/${encodeURIComponent(pno)}/routes`);

    return {
        pno: response.data.pno,
        // Coerce: Flash returns numeric fields as strings on some endpoints,
        // and a string state slips past callers' !state / Number.isNaN guards
        // straight into mapFlashStateToStatus's default branch ('shipped').
        state: Number(response.data.state),
        stateText: response.data.stateText || '',
        stateChangeAt: response.data.stateChangeAt != null ? Number(response.data.stateChangeAt) : response.data.stateChangeAt,
        routes: (response.data.routes || []).map((r: any) => ({
            routedAt: r.routedAt,
            routeAction: r.routeAction,
            message: r.message,
            state: r.state,
        })),
    };
}

/**
 * Cancel Order — POST /open/v1/orders/{pno}/cancel
 */
export async function cancelOrder(pno: string): Promise<void> {
    await makeFlashRequest(`/open/v1/orders/${encodeURIComponent(pno)}/cancel`);
}

// ---------------------------------------------------------------------------
// Flash State Mapping
// ---------------------------------------------------------------------------

/**
 * Maps Flash Express state codes to CardStreet order/shipping statuses.
 * Flash states from webhook/routes:
 *   1 = Picked Up
 *   2 = In Transit / Warehouse Scan
 *   3 = Out for Delivery
 *   4 = Failed Delivery Attempt
 *   5 = Delivered (signed)
 *   6 = Returned
 *   7 = Cancelled
 */
export function mapFlashStateToStatus(flashState: number): {
    shippingStatus: string;
    orderStatus: string;
} {
    switch (flashState) {
        case 1:
            return { shippingStatus: 'picked_up', orderStatus: 'shipped' };
        case 2:
            return { shippingStatus: 'in_transit', orderStatus: 'in_transit' };
        case 3:
            return { shippingStatus: 'out_for_delivery', orderStatus: 'out_for_delivery' };
        case 4:
            return { shippingStatus: 'failed', orderStatus: 'shipped' }; // Retry
        case 5:
            return { shippingStatus: 'delivered', orderStatus: 'delivered' };
        case 6:
            return { shippingStatus: 'failed', orderStatus: 'cancelled' };
        case 7:
            return { shippingStatus: 'failed', orderStatus: 'cancelled' };
        default:
            return { shippingStatus: 'in_transit', orderStatus: 'shipped' };
    }
}

/**
 * Set Webhook Service — POST /open/v1/setting/web_hook_service
 *
 * Registers (or disables) the callback URL for one webhook event type on
 * the merchant's account. Flash requires this to be called separately for
 * each event type — there's no "register all" call.
 *
 * webhookApiCode values per Flash Open API docs:
 *   0 = status (state changes: picked up, in transit, delivered, etc.)
 *   1 = weight (actual weight after Flash measures the parcel)
 *   2 = price (price adjustment after weighing)
 *   3 = courier (driver assignment info)
 *   4 = routes (scan/route events)
 */
export type FlashWebhookApiCode = 0 | 1 | 2 | 3 | 4;

export async function setWebhookService(params: {
    webhookApiCode: FlashWebhookApiCode;
    url: string;
    enabled?: boolean; // default true
}): Promise<void> {
    await makeFlashRequest('/open/v1/setting/web_hook_service', {
        serviceCategory: params.enabled === false ? '0' : '1',
        url: params.url,
        webhookApiCode: String(params.webhookApiCode),
    });
}

/**
 * Identifies Flash Express region/area mismatch errors.
 *
 * Why: the training sandbox accepts only a narrow set of Thai province/district
 * combinations and rejects everything else with code 40004 / 40005, and the
 * production API rejects addresses whose city field isn't a real อำเภอ/เขต of
 * the province with code 1000 + "Consignee region does not match" (the detail
 * is folded into the message by makeFlashRequest). Callers need to distinguish
 * these (which warrant a canonical-city retry / graceful degradation) from
 * hard failures like bad credentials or network outages.
 */
export function isRegionError(err: unknown): boolean {
    if (!err) return false;
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (/code:\s*4000[45]\b/.test(msg)) return true;
    return /\b(region|area|province|district|city)\b/.test(msg);
}

/**
 * Verifies the signature on an incoming Flash Express webhook payload.
 *
 * Per the Flash Open API docs, webhook pushes sign ONLY (mchId, nonceStr) —
 * "Only (mchId, nonceStr) is involved in signing" — not the event data. We
 * check that form first, then fall back to the outbound-request convention
 * (every top-level non-empty primitive field) in case a payload variant
 * signs the full set. Both computations require knowledge of the API key,
 * and status transitions downstream are forward-only, so accepting either
 * does not weaken the check.
 */
export function verifyWebhookSignature(payload: Record<string, any>): boolean {
    const config = getFlashConfig();
    const { sign, ...rest } = payload;

    if (!sign || typeof sign !== 'string') return false;

    const minimal = generateSignature(
        { mchId: String(rest.mchId ?? ''), nonceStr: String(rest.nonceStr ?? '') },
        config.apiKey,
    );
    if (timingSafeEqualStr(minimal, sign)) return true;

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
        // Skip the parsed object — a full-set signature covers the raw
        // `dataJson` string, never the parsed `data` object.
        if (k === 'data' && typeof v === 'object') continue;
        if (v === undefined || v === null) continue;
        const s = String(v);
        if (s.trim() === '') continue;
        params[k] = s;
    }

    return timingSafeEqualStr(generateSignature(params, config.apiKey), sign);
}

/** Constant-time compare to avoid leaking the signature byte-by-byte. */
function timingSafeEqualStr(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
    } catch {
        return false;
    }
}
