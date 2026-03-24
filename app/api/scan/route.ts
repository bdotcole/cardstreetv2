import { NextResponse } from 'next/server';
import { scannerService } from '@/services/scannerService';

export const runtime = 'edge';
export const maxDuration = 60; // Allow sufficient time for AI processing

export async function POST(req: Request) {
    try {
        const payload = await req.json();
        
        if (!payload.image && !payload.text) {
            return NextResponse.json({ error: 'No image or native text payload provided' }, { status: 400 });
        }

        // Delegate to our new unified secure scanner service
        const result = await scannerService.scanCard(payload);
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('API /api/scan Error:', error);
        
        // Return a clean error if it's the known missing key issue
        if (error.message.includes('API key was reported as leaked') || error.message.includes('No scanning API keys configured')) {
             return NextResponse.json({ 
                 error: 'API Keys are not configured correctly. Please update GEMINI_API_KEY and SERPAPI_API_KEY in the environment.' 
             }, { status: 403 });
        }

        return NextResponse.json({ error: error.message || 'Scan failed' }, { status: 500 });
    }
}
