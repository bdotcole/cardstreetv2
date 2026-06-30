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
        throw new Error(`Flash Express: ${errorMsg} (code: ${json.code})`);
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
        state: response.data.state,
        stateText: response.data.stateText || '',
        stateChangeAt: response.data.stateChangeAt,
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
 * combinations and rejects everything else with code 40004 / 40005. Callers
 * need to distinguish these (which warrant graceful degradation in training)
 * from hard failures like bad credentials or network outages.
 */
export function isRegionError(err: unknown): boolean {
    if (!err) return false;
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (/code:\s*4000[45]\b/.test(msg)) return true;
    return /\b(region|area|province|district)\b/.test(msg);
}

/**
 * Verifies the signature on an incoming Flash Express webhook payload.
 *
 * Flash's webhook callback signs every top-level non-empty primitive field
 * (notifyType, mchId, nonceStr, dataJson, etc.) using the same key=value&
 * sort + SHA256 algorithm as outbound requests. The verbatim `dataJson`
 * string is what gets signed (NOT the parsed `data` object), so we include
 * `dataJson` when present and skip the parsed `data` object.
 */
export function verifyWebhookSignature(payload: Record<string, any>): boolean {
    const config = getFlashConfig();
    const { sign, ...rest } = payload;

    if (!sign || typeof sign !== 'string') return false;

    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(rest)) {
        // Skip the parsed object — Flash signs `dataJson` (the raw string).
        if (k === 'data' && typeof v === 'object') continue;
        if (v === undefined || v === null) continue;
        const s = String(v);
        if (s.trim() === '') continue;
        params[k] = s;
    }

    const computed = generateSignature(params, config.apiKey);

    // Constant-time compare to avoid leaking the signature byte-by-byte.
    if (computed.length !== sign.length) return false;
    try {
        return crypto.timingSafeEqual(
            Buffer.from(computed, 'utf8'),
            Buffer.from(sign, 'utf8'),
        );
    } catch {
        return false;
    }
}
