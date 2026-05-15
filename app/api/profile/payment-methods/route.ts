import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const PaymentMethodSchema = z.object({
    card_type: z.enum(['Visa', 'Mastercard', 'JCB', 'AmericanExpress', 'UnionPay', 'Other']),
    last_four: z.string().regex(/^\d{4}$/, 'last_four must be exactly 4 digits'),
    expiry_month: z.number().int().min(1).max(12),
    expiry_year: z.number().int().min(2024).max(2099),
    cardholder_name: z.string().trim().min(1).max(120).optional(),
    is_default: z.boolean().optional(),
})

// GET - List user's saved payment methods
export async function GET() {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { data: methods, error } = await supabase
            .from('payment_methods')
            .select('id, card_type, last_four, expiry_month, expiry_year, cardholder_name, is_default, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })

        if (error) throw error

        return NextResponse.json(methods || [])
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// POST - Add new payment method
export async function POST(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const parsed = PaymentMethodSchema.safeParse(await request.json())
        if (!parsed.success) {
            return NextResponse.json(
                { error: 'Invalid payment method', details: parsed.error.flatten() },
                { status: 400 },
            )
        }
        const { card_type, last_four, expiry_month, expiry_year, cardholder_name, is_default } = parsed.data

        // If setting as default, unset other defaults first
        if (is_default) {
            await supabase
                .from('payment_methods')
                .update({ is_default: false })
                .eq('user_id', user.id)
        }

        const { data: method, error } = await supabase
            .from('payment_methods')
            .insert({
                user_id: user.id,
                card_type,
                last_four,
                expiry_month,
                expiry_year,
                cardholder_name,
                is_default: is_default || false
            })
            .select()
            .single()

        if (error) throw error

        return NextResponse.json(method)
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}

// DELETE - Remove payment method
export async function DELETE(request: NextRequest) {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    try {
        const { searchParams } = new URL(request.url)
        const methodId = searchParams.get('id')

        if (!methodId) {
            return NextResponse.json({ error: 'Payment method ID required' }, { status: 400 })
        }

        const { error } = await supabase
            .from('payment_methods')
            .delete()
            .eq('id', methodId)
            .eq('user_id', user.id)

        if (error) throw error

        return NextResponse.json({ success: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
