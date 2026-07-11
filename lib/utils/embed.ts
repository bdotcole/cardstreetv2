/**
 * PostgREST embeds a to-one relationship as a bare object, not a one-element
 * array. orders -> shipping_labels is to-one (shipping_labels.order_id is
 * UNIQUE), but every consumer — web, desktop, and the reconcile-shipments
 * cron — was written against the array shape, so `order.shipping_labels?.[0]`
 * silently resolved to undefined: the cron skipped every in-flight order and
 * the UI hid tracking rows. Normalize any embed through this helper before
 * indexing into it.
 */
export function embedArray<T>(value: T | T[] | null | undefined): T[] {
    if (Array.isArray(value)) return value
    return value ? [value] : []
}
