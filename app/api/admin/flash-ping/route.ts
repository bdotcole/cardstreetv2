/**
 * TEMPORARY diagnostic endpoint — remove after debugging Flash shipping rates.
 *
 * GET /api/admin/flash-ping?key=flashdiag_7Xq2
 *
 * Runs the REAL estimateRate() against the live Flash API from Vercel's own
 * runtime + env, and reports what the server actually resolves for the Flash
 * config. This lets us see — without log diving — whether the deployed app is
 * using production creds, and the exact Flash response/error it gets. Reports
 * only non-secret metadata (env name, merchant id, key LENGTH) plus the Flash
 * result.
 */

import { NextResponse } from 'next/server';
import { estimateRate } from '@/lib/flashExpress';

export const runtime = 'nodejs';

const DIAG_KEY = 'flashdiag_7Xq2';

export async function GET(req: Request) {
    if (new URL(req.url).searchParams.get('key') !== DIAG_KEY) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const envRaw = process.env.FLASH_EXPRESS_ENV ?? null;
    const out: Record<string, unknown> = {
        FLASH_EXPRESS_ENV_raw: JSON.stringify(envRaw),
        FLASH_EXPRESS_ENV_resolved: (envRaw || 'training').trim(),
        prod_mchId: process.env.FLASH_EXPRESS_MCH_ID_PRODUCTION?.trim() || null,
        prod_key_len: (process.env.FLASH_EXPRESS_KEY_PRODUCTION?.trim() || '').length,
        train_mchId_present: !!process.env.FLASH_EXPRESS_MCH_ID_TRAINING?.trim(),
        train_key_present: !!process.env.FLASH_EXPRESS_KEY_TRAINING?.trim(),
    };

    try {
        const quote = await estimateRate({
            srcProvinceName: 'กรุงเทพมหานคร',
            srcCityName: 'เขตบางรัก',
            srcPostalCode: '10500',
            dstProvinceName: 'กรุงเทพมหานคร',
            dstCityName: 'เขตบางรัก',
            dstPostalCode: '10110',
            weight: 500,
            width: 10,
            length: 15,
            height: 2,
        });
        out.flash = { ok: true, quote };
    } catch (e: any) {
        out.flash = { ok: false, error: e?.message || String(e) };
    }

    return NextResponse.json(out);
}
