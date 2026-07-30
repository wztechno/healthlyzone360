import { z } from 'zod';

import {
    EMAIL_MAX_LENGTH,
    NAME_MAX_LENGTH,
    NAME_MIN_LENGTH,
    PASSWORD_MIN_LENGTH,
    VALIDATION_KEYS,
} from './messages.ts';
import type { Translate } from './messages.ts';

function emailField(t: Translate) {
    return z
        .string({ error: t(VALIDATION_KEYS.required) })
        .trim()
        .min(1, { error: t(VALIDATION_KEYS.required) })
        .max(EMAIL_MAX_LENGTH, { error: t(VALIDATION_KEYS.maxLength, { count: EMAIL_MAX_LENGTH }) })
        .pipe(z.email({ error: t(VALIDATION_KEYS.email) }))
        .transform((value) => value.toLowerCase());
}

function newPasswordField(t: Translate) {
    return z.string({ error: t(VALIDATION_KEYS.required) }).min(PASSWORD_MIN_LENGTH, {
        error: t(VALIDATION_KEYS.passwordMinLength, { count: PASSWORD_MIN_LENGTH }),
    });
}

function confirmPasswordMatches<T extends { password: string; password_confirmation: string }>(
    schema: z.ZodType<T>,
    t: Translate,
) {
    return schema.refine((value) => value.password === value.password_confirmation, {
        error: t(VALIDATION_KEYS.passwordMismatch),
        path: ['password_confirmation'],
    });
}

/** `POST /api/v1/auth/login`. */
export function makeLoginSchema(t: Translate) {
    return z.object({
        email: emailField(t),
        // Length is deliberately *not* validated on sign-in: the policy may have changed since the
        // account was created, and telling an attacker the minimum length is free information.
        password: z.string({ error: t(VALIDATION_KEYS.required) }).min(1, {
            error: t(VALIDATION_KEYS.required),
        }),
        remember: z.boolean().default(false),
    });
}

/** `POST /api/v1/auth/register`. */
export function makeRegisterSchema(t: Translate) {
    return confirmPasswordMatches(
        z.object({
            name: z
                .string({ error: t(VALIDATION_KEYS.required) })
                .trim()
                .min(NAME_MIN_LENGTH, {
                    error: t(VALIDATION_KEYS.minLength, { count: NAME_MIN_LENGTH }),
                })
                .max(NAME_MAX_LENGTH, {
                    error: t(VALIDATION_KEYS.maxLength, { count: NAME_MAX_LENGTH }),
                }),
            email: emailField(t),
            password: newPasswordField(t),
            password_confirmation: z.string({ error: t(VALIDATION_KEYS.required) }),
            accept_terms: z.literal(true, { error: t(VALIDATION_KEYS.acceptTerms) }),
            accept_privacy: z.literal(true, { error: t(VALIDATION_KEYS.acceptPrivacy) }),
        }),
        t,
    );
}

/** `POST /api/v1/auth/forgot-password`. */
export function makeForgotPasswordSchema(t: Translate) {
    return z.object({
        email: emailField(t),
    });
}

/** `POST /api/v1/auth/reset-password`. */
export function makeResetPasswordSchema(t: Translate) {
    return confirmPasswordMatches(
        z.object({
            token: z.string({ error: t(VALIDATION_KEYS.required) }).min(1, {
                error: t(VALIDATION_KEYS.required),
            }),
            email: emailField(t),
            password: newPasswordField(t),
            password_confirmation: z.string({ error: t(VALIDATION_KEYS.required) }),
        }),
        t,
    );
}

/**
 * `PUT /api/v1/me/context`.
 *
 * Needs no translate function: the fields are opaque identifiers chosen from a list the user was
 * shown, so a failure here is a client bug rather than something to explain to a person.
 * The server re-validates that the identifiers are inside the caller's membership scope (plan §9).
 */
export const contextSelectionSchema = z.object({
    organisation_id: z.uuid({ error: VALIDATION_KEYS.identifier }),
    branch_id: z.uuid({ error: VALIDATION_KEYS.identifier }).nullable().default(null),
});

export type LoginValues = z.infer<ReturnType<typeof makeLoginSchema>>;
export type LoginInput = z.input<ReturnType<typeof makeLoginSchema>>;
export type RegisterValues = z.infer<ReturnType<typeof makeRegisterSchema>>;
export type RegisterInput = z.input<ReturnType<typeof makeRegisterSchema>>;
export type ForgotPasswordValues = z.infer<ReturnType<typeof makeForgotPasswordSchema>>;
export type ResetPasswordValues = z.infer<ReturnType<typeof makeResetPasswordSchema>>;
export type ContextSelectionValues = z.infer<typeof contextSelectionSchema>;
export type ContextSelectionInput = z.input<typeof contextSelectionSchema>;
