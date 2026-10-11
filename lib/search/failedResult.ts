/**
 * Search services answer [] both when nothing matched and when the request
 * failed, and the UI renders both as an empty state. Analytics must not: a
 * timeout on a flaky mobile link would read as a zero-result search. So the
 * services mark the [] they return on failure, without changing its type.
 */
const failed = new WeakSet<object>();

export function markFailedResult<T extends object>(value: T): T {
    failed.add(value);
    return value;
}

export function isFailedResult(value: unknown): boolean {
    return typeof value === 'object' && value !== null && failed.has(value);
}
