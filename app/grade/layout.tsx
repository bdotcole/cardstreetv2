import type { Metadata } from 'next';

// Premium-gated AI grader with no crawlable copy — keep it out of the index. The
// public, indexable page for grading intent is /graded (c6d00d7), which stays
// self-canonical and untouched. Without this layout the client page inherited
// the root layout's homepage title and shipped no canonical.
//
// Static Thai title for the same reason as app/live/layout.tsx: /grade is not in
// middleware's config.matcher, so x-cs-lang never reaches it.
export const metadata: Metadata = {
    title: 'ตรวจเกรดการ์ดด้วย AI | CardStreet',
    robots: { index: false, follow: false },
};

export default function GradeLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
}
