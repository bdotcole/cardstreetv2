import DesktopCardDetail from '@/components/desktop/DesktopCardDetail';

export default async function DesktopCardPage({ params }: { params: Promise<{ cardId: string }> }) {
    const { cardId } = await params;
    return <DesktopCardDetail cardId={cardId} />;
}
