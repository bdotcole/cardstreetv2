/**
 * Flash Express Order Creation — Vercel Serverless Function
 *
 * POST /api/shipping/flash-create-order
 *
 * Receives a structured Thai address object and:
 *   1. Checks for remote area surcharges via Flash Express `/open/v1/base/area/get`
 *   2. Creates a shipment order via Flash Express `/open/v3/orders`
 *
 * The caller is responsible for authentication — this function trusts
 * the Next.js middleware / auth check in the calling route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
    createShipment,
    type FlashOrderParams,
    type FlashOrderResult,
} from '@/lib/flashExpress';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The structured Thai address expected from the frontend / Google Places parser */
interface StructuredThaiAddress {
    name: string;
    phone: string;
    province: string;        // จังหวัด
    district: string;        // อำเภอ/เขต
    sub_district: string;    // ตำบล/แขวง
    postal_code: string;     // รหัสไปรษณีย์
    detail_address: string;  // บ้านเลขที่ + ถนน
}

interface CreateOrderRequestBody {
    orderId: string;
    sender: StructuredThaiAddress;
    receiver: StructuredThaiAddress;
    weight?: number;         // grams, default 500
    remark?: string;
}

// ---------------------------------------------------------------------------
// Flash Express Remote Area Check
// ---------------------------------------------------------------------------

interface FlashAreaCheckResult {
    isRemote: boolean;
    surcharge: number;       // THB
    message: string;
}

/**
 * Checks whether the destination is a Flash Express remote area.
 * Remote areas may incur an additional surcharge.
 *
 * Endpoint: POST /open/v1/base/area/get
 */
async function checkRemoteArea(
    postalCode: string,
    provinceName: string,
    cityName: string
): Promise<FlashAreaCheckResult> {
    const env = process.env.FLASH_EXPRESS_ENV || 'training';
    const baseUrl =
        env === 'production'
            ? 'https://open-api.flashexpress.com'
            : 'https://open-api-tra.flashexpress.com';
    const mchId =
        env === 'production'
            ? process.env.FLASH_EXPRESS_MCH_ID_PRODUCTION || ''
            : process.env.FLASH_EXPRESS_MCH_ID_TRAINING || '';
    const apiKey =
        env === 'production'
            ? process.env.FLASH_EXPRESS_KEY_PRODUCTION || ''
            : process.env.FLASH_EXPRESS_KEY_TRAINING || '';

    if (!mchId || !apiKey) {
        console.warn('[FlashAreaCheck] Missing credentials, skipping remote area check');
        return { isRemote: false, surcharge: 0, message: 'Credentials missing — skipped check' };
    }

    // Build params
    const nonceStr = Date.now().toString() + crypto.randomBytes(4).toString('hex');
    const params: Record<string, string> = {
        mchId,
        nonceStr,
        dstPostalCode: postalCode,
        dstProvinceName: provinceName,
        dstCityName: cityName,
    };

    // Generate signature (same algo as lib/flashExpress.ts)
    const sortedKeys = Object.keys(params)
        .filter((k) => k !== 'sign' && params[k]?.trim())
        .sort();
    const stringA = sortedKeys.map((k) => `${k}=${params[k]}`).join('&');
    const sign = crypto
        .createHash('sha256')
        .update(`${stringA}&key=${apiKey}`, 'utf8')
        .digest('hex')
        .toUpperCase();

    const body = new URLSearchParams({ ...params, sign }).toString();

    try {
        const response = await fetch(`${baseUrl}/open/v1/base/area/get`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
            body,
        });

        if (!response.ok) {
            console.warn(`[FlashAreaCheck] HTTP ${response.status}`);
            return { isRemote: false, surcharge: 0, message: `HTTP ${response.status}` };
        }

        const json = await response.json();
        console.log('[FlashAreaCheck] Response:', JSON.stringify(json));

        // Flash returns code=1 on success
        if (json.code === 1 && json.data) {
            const isRemote = json.data.isRemote === 1 || json.data.isRemoteArea === true;
            const surcharge = json.data.surcharge ?? json.data.upCountryAmount ?? 0;
            return {
                isRemote,
                surcharge: surcharge / 100, // cents to THB
                message: isRemote ? 'Remote area — surcharge applies' : 'Standard delivery area',
            };
        }

        return { isRemote: false, surcharge: 0, message: json.message || 'Unknown' };
    } catch (err: any) {
        console.error('[FlashAreaCheck] Error:', err);
        return { isRemote: false, surcharge: 0, message: err.message };
    }
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
    // Auth check
    const supabase = await createClient();
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body: CreateOrderRequestBody = await request.json();
        const { orderId, sender, receiver, weight = 500, remark } = body;

        // Validation
        if (!orderId) {
            return NextResponse.json({ error: 'orderId is required' }, { status: 400 });
        }
        if (!sender || !receiver) {
            return NextResponse.json({ error: 'sender and receiver are required' }, { status: 400 });
        }

        // ─── Step 1: Remote Area Check ───
        const areaCheck = await checkRemoteArea(
            receiver.postal_code,
            receiver.province,
            receiver.district
        );

        console.log('[FlashCreateOrder] Area check:', areaCheck);

        // ─── Step 2: Map to Flash Express payload ───
        const flashParams: FlashOrderParams = {
            outTradeNo: orderId,
            // Source (sender)
            srcName: sender.name,
            srcPhone: sender.phone,
            srcProvinceName: sender.province,
            srcCityName: sender.district,           // Flash: cityName = อำเภอ/เขต
            srcDistrictName: sender.sub_district,    // Flash: districtName = ตำบล/แขวง
            srcPostalCode: sender.postal_code,
            srcDetailAddress: sender.detail_address,
            // Destination (receiver)
            dstName: receiver.name,
            dstPhone: receiver.phone,
            dstProvinceName: receiver.province,
            dstCityName: receiver.district,
            dstDistrictName: receiver.sub_district,
            dstPostalCode: receiver.postal_code,
            dstDetailAddress: receiver.detail_address,
            // Package
            weight,
            expressCategory: 1,  // Standard
            articleCategory: 3,  // Valuables (trading cards)
            remark: remark || 'CardStreet TCG Order',
        };

        // ─── Step 3: Create the order ───
        const result: FlashOrderResult = await createShipment(flashParams);

        console.log('[FlashCreateOrder] Order created:', result.pno);

        return NextResponse.json({
            success: true,
            pno: result.pno,
            outTradeNo: result.outTradeNo,
            sortCode: result.sortCode,
            dstStoreName: result.dstStoreName,
            areaCheck: {
                isRemote: areaCheck.isRemote,
                surcharge: areaCheck.surcharge,
                message: areaCheck.message,
            },
        });
    } catch (error: any) {
        console.error('[FlashCreateOrder] Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
