import { redirect } from 'next/navigation'

// Tickets live in the Support inbox now; ?ticket=<id> links from older alert emails still land.
export default async function TicketsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const { ticket } = await searchParams
    const id = typeof ticket === 'string' && /^[0-9a-f-]{36}$/i.test(ticket) ? ticket : null
    redirect(id ? `/admin/inbox?open=ticket:${id}` : '/admin/inbox?kind=ticket')
}
