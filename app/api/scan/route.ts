import { NextResponse } from 'next/server';
import { scannerService } from '@/services/scannerService';

// nodejs runtime is required: the pHash step uses `sharp` for image decoding,
// which is a native module unavailable in Edge.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
    try {
        const payload = await req.json();

        if (!payload.image && !payload.text) {
            return NextResponse.json({ error: 'No image or native text payload provided' }, { status: 400 });
        }

        const result = await scannerService.scanCard(payload);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('API /api/scan Error:', error);

        if (error.message?.includes('API key') || error.message?.includes('GEMINI_API_KEY')) {
            return NextResponse.json({
                error: 'API keys are not configured correctly. Please set GEMINI_API_KEY.'
            }, { status: 403 });
        }

        return NextResponse.json({ error: error.message || 'Scan failed' }, { status: 500 });
    }
}
