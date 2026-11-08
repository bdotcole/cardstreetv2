import { redirect } from 'next/navigation'

// Support-shop chats live in the Support inbox now; ?thread=<id> links from older chat emails still land.
export default async function MessagesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const { thread } = await searchParams
    const id = typeof thread === 'string' && /^[0-9a-f-]{36}$/i.test(thread) ? thread : null
    redirect(id ? `/admin/inbox?open=dm:${id}` : '/admin/inbox?kind=dm')
}
