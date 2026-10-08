import * as Sentry from '@sentry/nextjs';

// React assumes it owns the DOM it rendered. Browser page translation (Chrome's
// built-in Translate, which phones offer on our Thai pages) replaces text nodes
// with <font> wrappers, and some in-app browsers rewrite the page too. When React
// later removes a node, or inserts before one, that has been moved, the DOM
// throws NotFoundError ("Failed to execute 'removeChild' / 'insertBefore' on
// 'Node'"), the throw unwinds React's commit, and the error boundary replaces
// the whole page (CARDSTREET-36/2A, handled = the fallback screen was shown).
//
// Letting those two calls skip a node that is no longer where React left it is
// the workaround React's maintainers give (facebook/react#11538): a translated
// label can go stale until the next render instead of the app crashing. A
// warning is still sent once per page load, with the translation markers, so a
// bug of our own that trips the guard does not go invisible.

let reported = false;

function reportOnce(op: 'removeChild' | 'insertBefore') {
    if (reported) return;
    reported = true;
    const html = document.documentElement;
    Sentry.captureMessage('DOM node moved outside React (mutation skipped)', {
        level: 'warning',
        tags: { area: 'dom-guard', op, translated: /\btranslated-(ltr|rtl)\b/.test(html.className) ? 'yes' : 'no' },
        extra: { htmlClass: html.className, htmlLang: html.lang },
    });
}

export function installDomMutationGuard() {
    if (typeof Node !== 'function' || !Node.prototype) return;
    const proto = Node.prototype as Node & { __csDomGuard?: boolean };
    if (proto.__csDomGuard) return;
    proto.__csDomGuard = true;

    const removeChild = proto.removeChild;
    proto.removeChild = function <T extends Node>(this: Node, child: T): T {
        if (child.parentNode !== this) {
            reportOnce('removeChild');
            return child;
        }
        return removeChild.call(this, child) as T;
    };

    const insertBefore = proto.insertBefore;
    proto.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
        if (child && child.parentNode !== this) {
            reportOnce('insertBefore');
            return node;
        }
        return insertBefore.call(this, node, child) as T;
    };
}
