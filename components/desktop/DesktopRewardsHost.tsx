'use client';

import { useCallback, useEffect, useState } from 'react';
import RewardsHub from '@/components/rewards/RewardsHub';
import { useRewardsSummary } from '@/lib/hooks/useRewardsSummary';

/**
 * Desktop mount point for the Rewards Hub.
 *
 * Lives in the desktop layout rather than inside DesktopNav on purpose: the
 * nav's `backdrop-blur` establishes a containing block, so a fixed-position
 * overlay rendered from inside it would be trapped under the header instead of
 * covering the viewport.
 *
 * The nav's coin chip opens it through the shared 'cs:openRewards' window
 * event — the same contract the mobile shell and the Profile menu row use, so
 * any future entry point works without touching this file.
 */
export default function DesktopRewardsHost() {
    const [open, setOpen] = useState(false);
    // Shares the module-level cache with the nav chip: one /api/rewards/summary
    // fetch, and a claim here updates the chip via the hook's change event.
    const { summary, refresh } = useRewardsSummary(true);

    useEffect(() => {
        const onOpen = () => setOpen(true);
        window.addEventListener('cs:openRewards', onOpen);
        return () => window.removeEventListener('cs:openRewards', onOpen);
    }, []);

    const close = useCallback(() => setOpen(false), []);

    // Signed out, no beta grant, or kill switch off: the hook fails closed and
    // there is nothing to open.
    if (!summary) return null;

    return <RewardsHub open={open} onClose={close} summary={summary} refresh={refresh} />;
}
