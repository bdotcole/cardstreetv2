'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/hooks/useTranslation';

// Keeps the document's <html lang> in sync with the active UI language. The
// server renders the default (English) content, so the static attribute in the
// root layout is "en"; once the client resolves the user's language (saved
// preference or browser-detected Thai) this updates it to "th" for that
// session. Real per-language URLs come with locale routing later.
export default function HtmlLangSync() {
  const { isThai } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = isThai ? 'th' : 'en';
  }, [isThai]);

  return null;
}
