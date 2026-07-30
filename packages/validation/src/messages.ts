/**
 * Validation message keys.
 *
 * Every schema message is an i18n key resolved through a caller-supplied translate function, so a
 * form re-renders in Arabic without being rebuilt. Keys are namespace-qualified (`errors:…`) so a
 * plain, unscoped i18next `t` works.
 */
export const VALIDATION_KEYS = {
    required: 'errors:validation.required',
    email: 'errors:validation.email',
    minLength: 'errors:validation.min_length',
    maxLength: 'errors:validation.max_length',
    passwordMinLength: 'errors:validation.password_min_length',
    passwordMismatch: 'errors:validation.password_mismatch',
    acceptTerms: 'errors:validation.accept_terms',
    acceptPrivacy: 'errors:validation.accept_privacy',
    identifier: 'errors:validation.identifier',
} as const;

export type ValidationKey = (typeof VALIDATION_KEYS)[keyof typeof VALIDATION_KEYS];

/**
 * The slice of i18next's `t` the schemas need. Declared structurally so the package does not
 * depend on i18next and stays testable with a two-line stub.
 */
export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Fallback used by tests and by any caller that has no i18n instance yet: echoes the key. */
export const identityTranslate: Translate = (key, params) =>
    params === undefined ? key : `${key}:${JSON.stringify(params)}`;

/** Client mirror of the backend password policy. The server remains the enforcing side. */
export const PASSWORD_MIN_LENGTH = 12;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 120;
export const EMAIL_MAX_LENGTH = 254;
