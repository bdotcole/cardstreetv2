import Image from 'next/image';
import Link from 'next/link';
import type { PublicWishlist, PublicWishlistCard, PublicWishlistOwner } from '@/lib/wishlistShare';
import { CARD_BLUR_DATA_URL, getThumbnailUrl, shouldSkipNextOptimization } from '@/lib/imageUtils';
import { formatTHB } from '@/lib/currency';

// A shared wishlist as a gift-giver sees it. A server component: the page
// (app/desktop/wishlist/[token]) renders it with the loader's data, and
// nothing on it needs a browser beyond links. Bilingual inline like the
// seller page, keyed on the request language, since server components cannot
// use the translation hook.
//
// Available cards come first and carry the cheapest price and shop count,
// because the visitor is here to buy one thing for one person: the question
// is "which of these can I get right now", not "what does the list contain".

export type PublicWishlistLang = 'EN' | 'TH';

export function ownerName(owner: PublicWishlistOwner, lang: PublicWishlistLang): string {
    return owner.displayName || (lang === 'EN' ? 'A collector' : 'นักสะสม');
}

export default function PublicWishlistView({
    data,
    lang,
    pathPrefix,
    isOwner,
    giftSeason,
}: {
    data: PublicWishlist;
    lang: PublicWishlistLang;
    /** '' on the Thai canonical, '/en' under the English prefix. */
    pathPrefix: string;
    /** The signed-in viewer is the list's owner: say this is the public view. */
    isOwner: boolean;
    /** Inside the gift window (lib/wishlistShare isGiftSeason): holiday wording. */
    giftSeason: boolean;
}) {
    const en = lang === 'EN';
    const name = ownerName(data.owner, lang);
    const total = data.totalCards;
    const shown = data.cards.length;
    const avail = data.availableCount;

    const lead = giftSeason
        ? en
            ? `Shopping for ${name} this holiday season? These are the cards they are hoping for. Anything marked available can be bought right now and ships anywhere in Thailand.`
            : `กำลังหาของขวัญปีใหม่ให้ ${name} อยู่ใช่ไหม นี่คือการ์ดที่เขาอยากได้ ใบไหนมีขายอยู่สั่งซื้อได้เลย จัดส่งทั่วไทย`
        : en
          ? `These are the cards ${name} is hoping for. Anything marked available can be bought right now and ships anywhere in Thailand.`
          : `นี่คือการ์ดที่ ${name} อยากได้ ใบไหนมีขายอยู่สั่งซื้อได้เลย จัดส่งทั่วไทย`;

    return (
        <div>
            <nav className="text-sm text-slate-500">
                <Link href={pathPrefix || '/'} className="hover:text-slate-300 transition-colors">
                    {en ? 'Marketplace' : 'มาร์เก็ตเพลส'}
                </Link>
                <span className="mx-2">›</span>
                <span className="text-slate-300">{en ? 'Wishlist' : 'รายการที่อยากได้'}</span>
            </nav>

            <header className="flex items-center gap-4 mt-6">
                <div className="w-16 h-16 rounded-full bg-slate-800 border border-white/10 overflow-hidden flex items-center justify-center text-xl font-black text-white shrink-0">
                    {data.owner.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={data.owner.avatarUrl} alt={name} className="w-full h-full object-cover" />
                    ) : (
                        name.charAt(0).toUpperCase()
                    )}
                </div>
                <div className="min-w-0">
                    {/* Wraps rather than truncates: on a phone the owner's name is the one thing the visitor must read. */}
                    <h1 className="text-2xl font-black text-white leading-tight break-words">
                        {en ? `${name}'s wishlist` : `รายการที่อยากได้ของ ${name}`}
                    </h1>
                    <p className="text-sm text-slate-400 mt-1">
                        {en ? `${total} card${total === 1 ? '' : 's'}` : `${total} ใบ`}
                        {avail > 0 ? ` · ${en ? `${avail} available to buy now` : `มีขายตอนนี้ ${avail} ใบ`}` : ''}
                    </p>
                </div>
            </header>

            <section className="mt-6 rounded-2xl border border-brand-cyan/30 bg-brand-cyan/10 px-5 py-4 flex items-start gap-3">
                <i className="fa-solid fa-gift text-brand-cyan mt-0.5"></i>
                <p className="text-sm text-slate-200 leading-relaxed">{lead}</p>
            </section>

            {isOwner && (
                <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-3">
                    <p className="text-xs text-amber-200 leading-snug">
                        {en
                            ? 'This is your wishlist as others see it. Manage sharing from your wishlist in the app.'
                            : 'นี่คือรายการที่อยากได้ของคุณในแบบที่คนอื่นเห็น จัดการการแชร์ได้จากหน้ารายการที่อยากได้ในแอป'}
                    </p>
                </div>
            )}

            {shown === 0 ? (
                <p className="text-slate-500 text-sm mt-10">{en ? 'Nothing on this wishlist yet.' : 'ยังไม่มีการ์ดในรายการนี้'}</p>
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 mt-8">
                    {data.cards.map((entry) => (
                        <WishTile key={entry.card.id} entry={entry} lang={lang} pathPrefix={pathPrefix} />
                    ))}
                </div>
            )}

            {total > shown && (
                <p className="text-xs text-slate-500 mt-4">
                    {en ? `Showing the first ${shown} of ${total} cards.` : `แสดง ${shown} ใบแรกจากทั้งหมด ${total} ใบ`}
                </p>
            )}

            <section className="mt-12 rounded-3xl border border-white/10 bg-slate-800/40 px-6 py-6 text-center">
                <h2 className="text-lg font-black text-white">{en ? 'Want a wishlist of your own?' : 'อยากมีรายการที่อยากได้ของตัวเองไหม'}</h2>
                <p className="text-sm text-slate-400 mt-1 max-w-xl mx-auto">
                    {en
                        ? 'Save the cards you are hoping for on Cardstreet, then share the link with whoever is shopping for you.'
                        : 'บันทึกการ์ดที่อยากได้บน Cardstreet แล้วแชร์ลิงก์ให้คนที่จะซื้อของขวัญให้คุณ'}
                </p>
                <Link
                    href={pathPrefix || '/'}
                    className="inline-flex items-center gap-2 mt-4 bg-brand-cyan hover:bg-cyan-400 text-brand-darker text-sm font-black px-5 py-2.5 rounded-xl transition-colors"
                >
                    <i className="fa-solid fa-heart text-xs"></i>
                    {en ? 'Start on Cardstreet' : 'เริ่มใช้ Cardstreet'}
                </Link>
            </section>
        </div>
    );
}

function WishTile({ entry, lang, pathPrefix }: { entry: PublicWishlistCard; lang: PublicWishlistLang; pathPrefix: string }) {
    const { card, available } = entry;
    const en = lang === 'EN';
    const src = card.images?.small || card.imageUrl;
    const thumb = getThumbnailUrl(src);

    return (
        <Link
            href={`${pathPrefix}/card/${encodeURIComponent(card.id)}`}
            className="group bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden hover:border-brand-cyan/40 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 transition-all"
        >
            <div className="relative aspect-[3/4] bg-brand-darker overflow-hidden">
                {src ? (
                    <Image
                        src={thumb}
                        alt={card.name || 'Card'}
                        fill
                        sizes="(min-width: 1536px) 15vw, (min-width: 1024px) 20vw, 40vw"
                        loading="lazy"
                        placeholder="blur"
                        blurDataURL={CARD_BLUR_DATA_URL}
                        unoptimized={shouldSkipNextOptimization(thumb)}
                        className={`group-hover:scale-[1.03] transition-transform duration-300 ${card.isSealed ? 'object-contain p-3' : 'object-cover'}`}
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-600">
                        <i className="fa-solid fa-image text-2xl"></i>
                    </div>
                )}
                {/* Bottom corner: the card's own name and HP sit along the top of the art. */}
                {available && (
                    <span className="absolute bottom-2 left-2 rounded-full bg-emerald-500/90 text-brand-darker text-[10px] font-black uppercase tracking-wide px-2 py-0.5">
                        {en ? 'Available' : 'มีขาย'}
                    </span>
                )}
            </div>
            <div className="p-3">
                <h2 className="text-sm font-bold text-white truncate">{card.name}</h2>
                <p className="text-[11px] text-slate-500 font-bold uppercase tracking-wide truncate mt-0.5">
                    {card.set}
                    {card.rarity ? ` · ${card.rarity}` : ''}
                </p>
                {available ? (
                    <p className="text-sm font-black text-emerald-400 mt-1.5">
                        {en ? `From ${formatTHB(available.fromPrice)}` : `เริ่ม ${formatTHB(available.fromPrice)}`}
                        <span className="text-[11px] font-bold text-slate-400 ml-1.5">
                            {en ? `${available.sellers} ${available.sellers === 1 ? 'shop' : 'shops'}` : `${available.sellers} ร้าน`}
                        </span>
                    </p>
                ) : (
                    <p className="text-[11px] text-slate-500 mt-1.5">
                        {en ? 'Not for sale right now' : 'ยังไม่มีขายตอนนี้'}
                        {card.marketPrice > 0 ? ` · ${en ? 'Market' : 'ราคาตลาด'} ${formatTHB(card.marketPrice)}` : ''}
                    </p>
                )}
            </div>
        </Link>
    );
}
