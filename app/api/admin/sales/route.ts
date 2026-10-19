import { requireAdmin } from '@/lib/adminAuth'
import { getSoldListingsPage } from '@/lib/adminSales.server'
import { NextResponse } from 'next/server'

// GET /api/admin/sales?page=N — one page of the dashboard's Sold Listings
// table (paid orders, newest first). Returns { rows, total, page, pageSize }.
export async function GET(request: Request) {
    const gate = await requireAdmin()
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)

    const result = await getSoldListingsPage(page)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
    return NextResponse.json(result)
}
