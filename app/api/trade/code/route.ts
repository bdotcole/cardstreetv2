import { NextResponse } from 'next/server';
import { requireFeature } from '@/lib/premiumAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAppBaseUrl } from '@/lib/stripe';

// Trade Finder: get-or-create my shareable trade code. The code is rendered
// client-side as a QR of `${base}/trade?code=...` — scanning it with a phone
// camera deep-links straight into the matcher (cardstreet.app App Links open
// the native app on Android).

// No 0/O/1/I — codes get read aloud and typed by hand at card shops.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let code = 'TR-';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) code += ALPHABET[b % ALPHABET.length];
  return code;
}

export async function GET() {
  const gate = await requireFeature('trade_finder');
  if (gate instanceof NextResponse) return gate;
  const { user } = gate;

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('trade_code')
    .eq('id', user.id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let code: string | null = profile?.trade_code ?? null;

  if (!code) {
    // Retry a few times on the (astronomically unlikely) unique collision.
    for (let attempt = 0; attempt < 3 && !code; attempt++) {
      const candidate = generateCode();
      const { error: updErr } = await admin
        .from('profiles')
        .update({ trade_code: candidate })
        .eq('id', user.id);
      if (!updErr) code = candidate;
      else if (!updErr.message?.includes('duplicate')) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    }
    if (!code) return NextResponse.json({ error: 'Could not generate a trade code' }, { status: 500 });
  }

  return NextResponse.json({ code, url: `${getAppBaseUrl()}/trade?code=${code}` });
}
