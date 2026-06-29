/**
 * Client-side mirror of the password policy Supabase Auth (GoTrue) enforces, so
 * users get inline feedback instead of a server-side 422 after submitting.
 *
 * The live policy (probed against the GoTrue /auth/v1 endpoint) is:
 *   - at least 6 characters
 *   - at least one lowercase letter, one uppercase letter, and one digit
 *     (symbols are NOT required)
 *
 * Supabase additionally rejects breached / commonly-guessed passwords via its
 * HaveIBeenPwned check ("Password is known to be weak and easy to guess"). That
 * needs a network lookup we deliberately don't replicate here, so the server
 * stays the final authority — its message is surfaced inline when it fires.
 *
 * Keep this in sync with the dashboard policy. If you change requirements in the
 * Supabase Auth settings, update this file (and the passwordPolicy.* locale
 * strings) to match.
 */

export const PASSWORD_MIN_LENGTH = 6;

export type PasswordRule = 'minLength' | 'lowercase' | 'uppercase' | 'digit';

/**
 * Returns the structural rules the password fails, in display order.
 * An empty array means it satisfies the structural policy (it may still be
 * rejected by the server's breached-password check).
 */
export function getUnmetPasswordRules(password: string): PasswordRule[] {
    const unmet: PasswordRule[] = [];
    if (password.length < PASSWORD_MIN_LENGTH) unmet.push('minLength');
    if (!/[a-z]/.test(password)) unmet.push('lowercase');
    if (!/[A-Z]/.test(password)) unmet.push('uppercase');
    if (!/[0-9]/.test(password)) unmet.push('digit');
    return unmet;
}

export function isPasswordStructurallyValid(password: string): boolean {
    return getUnmetPasswordRules(password).length === 0;
}
