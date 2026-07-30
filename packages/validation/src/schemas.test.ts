import { describe, expect, it } from 'vitest';

import { PASSWORD_MIN_LENGTH, VALIDATION_KEYS, identityTranslate } from './messages.ts';
import {
    contextSelectionSchema,
    makeForgotPasswordSchema,
    makeLoginSchema,
    makeRegisterSchema,
    makeResetPasswordSchema,
} from './schemas.ts';

const t = identityTranslate;
const VALID_PASSWORD = 'correct-horse-battery-staple';
const VALID_UUID = '01935f6c-0000-7000-8000-00000000a001';

/** Collects `path -> message` from a Zod failure so assertions read like the form does. */
function errorsOf(result: { success: boolean; error?: { issues: readonly unknown[] } }) {
    if (result.success || result.error === undefined) return {};
    const map: Record<string, string> = {};
    for (const raw of result.error.issues) {
        const issue = raw as { path: readonly PropertyKey[]; message: string };
        map[issue.path.join('.') || '(root)'] = issue.message;
    }
    return map;
}

describe('makeLoginSchema', () => {
    const schema = makeLoginSchema(t);

    it('accepts a valid credential pair and defaults remember to false', () => {
        const result = schema.safeParse({ email: 'Layla@Example.com ', password: 'x' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
            email: 'layla@example.com',
            password: 'x',
            remember: false,
        });
    });

    it('trims and lower-cases the email', () => {
        expect(schema.safeParse({ email: '  USER@EXAMPLE.COM  ', password: 'x' }).data?.email).toBe(
            'user@example.com',
        );
    });

    it('rejects a malformed email with the email key', () => {
        const result = schema.safeParse({ email: 'not-an-email', password: 'x' });
        expect(errorsOf(result).email).toBe(VALIDATION_KEYS.email);
    });

    it('rejects an empty email and password with the required key', () => {
        const result = schema.safeParse({ email: '', password: '' });
        expect(errorsOf(result)).toEqual({
            email: VALIDATION_KEYS.required,
            password: VALIDATION_KEYS.required,
        });
    });

    it('does not impose a minimum length on the sign-in password', () => {
        expect(schema.safeParse({ email: 'a@b.co', password: 'a' }).success).toBe(true);
    });

    it('honours an explicit remember value', () => {
        expect(
            schema.safeParse({ email: 'a@b.co', password: 'x', remember: true }).data?.remember,
        ).toBe(true);
    });
});

describe('makeRegisterSchema', () => {
    const schema = makeRegisterSchema(t);
    const valid = {
        name: 'Layla Haddad',
        email: 'layla@example.com',
        password: VALID_PASSWORD,
        password_confirmation: VALID_PASSWORD,
        accept_terms: true,
        accept_privacy: true,
    } as const;

    it('accepts a complete registration', () => {
        expect(schema.safeParse(valid).success).toBe(true);
    });

    it('requires at least twelve password characters', () => {
        expect(PASSWORD_MIN_LENGTH).toBe(12);
        const short = 'a'.repeat(PASSWORD_MIN_LENGTH - 1);
        const result = schema.safeParse({
            ...valid,
            password: short,
            password_confirmation: short,
        });
        expect(errorsOf(result).password).toContain(VALIDATION_KEYS.passwordMinLength);
    });

    it('accepts exactly twelve characters', () => {
        const exact = 'a'.repeat(PASSWORD_MIN_LENGTH);
        expect(
            schema.safeParse({ ...valid, password: exact, password_confirmation: exact }).success,
        ).toBe(true);
    });

    it('reports a mismatch on the confirmation field', () => {
        const result = schema.safeParse({
            ...valid,
            password_confirmation: 'something-else-entirely',
        });
        expect(errorsOf(result).password_confirmation).toBe(VALIDATION_KEYS.passwordMismatch);
    });

    it.each([
        ['accept_terms', VALIDATION_KEYS.acceptTerms],
        ['accept_privacy', VALIDATION_KEYS.acceptPrivacy],
    ] as const)('requires %s to be literally true', (field, key) => {
        for (const rejected of [false, undefined, 'true', 1]) {
            const result = schema.safeParse({ ...valid, [field]: rejected });
            expect(errorsOf(result)[field], `rejected value: ${String(rejected)}`).toBe(key);
        }
    });

    it('rejects a name shorter than two characters and longer than 120', () => {
        expect(errorsOf(schema.safeParse({ ...valid, name: 'A' })).name).toContain(
            VALIDATION_KEYS.minLength,
        );
        expect(errorsOf(schema.safeParse({ ...valid, name: 'A'.repeat(121) })).name).toContain(
            VALIDATION_KEYS.maxLength,
        );
    });

    it('trims the name before measuring it', () => {
        expect(schema.safeParse({ ...valid, name: '  Layla  ' }).data?.name).toBe('Layla');
        expect(errorsOf(schema.safeParse({ ...valid, name: '   ' })).name).toContain(
            VALIDATION_KEYS.minLength,
        );
    });

    it('reports every failing field at once rather than stopping at the first', () => {
        const result = schema.safeParse({
            name: '',
            email: 'nope',
            password: 'short',
            password_confirmation: 'short',
            accept_terms: false,
            accept_privacy: false,
        });
        expect(Object.keys(errorsOf(result)).sort()).toEqual([
            'accept_privacy',
            'accept_terms',
            'email',
            'name',
            'password',
        ]);
    });
});

describe('makeForgotPasswordSchema', () => {
    const schema = makeForgotPasswordSchema(t);

    it('accepts an email and normalises it', () => {
        expect(schema.safeParse({ email: ' Layla@Example.com' }).data).toEqual({
            email: 'layla@example.com',
        });
    });

    it('rejects a missing email', () => {
        expect(errorsOf(schema.safeParse({})).email).toBe(VALIDATION_KEYS.required);
    });
});

describe('makeResetPasswordSchema', () => {
    const schema = makeResetPasswordSchema(t);
    const valid = {
        token: 'reset-token',
        email: 'layla@example.com',
        password: VALID_PASSWORD,
        password_confirmation: VALID_PASSWORD,
    } as const;

    it('accepts a complete reset payload', () => {
        expect(schema.safeParse(valid).success).toBe(true);
    });

    it('requires the token', () => {
        expect(errorsOf(schema.safeParse({ ...valid, token: '' })).token).toBe(
            VALIDATION_KEYS.required,
        );
    });

    it('enforces the password policy and confirmation match', () => {
        expect(
            errorsOf(
                schema.safeParse({ ...valid, password: 'short', password_confirmation: 'short' }),
            ).password,
        ).toContain(VALIDATION_KEYS.passwordMinLength);
        expect(
            errorsOf(
                schema.safeParse({ ...valid, password_confirmation: 'different-but-long-enough' }),
            ).password_confirmation,
        ).toBe(VALIDATION_KEYS.passwordMismatch);
    });
});

describe('contextSelectionSchema', () => {
    it('accepts an organisation with no branch', () => {
        expect(contextSelectionSchema.safeParse({ organisation_id: VALID_UUID }).data).toEqual({
            organisation_id: VALID_UUID,
            branch_id: null,
        });
    });

    it('accepts an organisation and branch pair', () => {
        const result = contextSelectionSchema.safeParse({
            organisation_id: VALID_UUID,
            branch_id: VALID_UUID,
        });
        expect(result.success).toBe(true);
    });

    it('rejects non-uuid identifiers', () => {
        const result = contextSelectionSchema.safeParse({
            organisation_id: '17',
            branch_id: 'not-a-uuid',
        });
        expect(errorsOf(result)).toEqual({
            organisation_id: VALIDATION_KEYS.identifier,
            branch_id: VALIDATION_KEYS.identifier,
        });
    });

    it('requires the organisation identifier', () => {
        expect(contextSelectionSchema.safeParse({ branch_id: null }).success).toBe(false);
    });
});

describe('translation wiring', () => {
    it('routes every message through the supplied translate function', () => {
        const seen: string[] = [];
        const spy = (key: string) => {
            seen.push(key);
            return `translated(${key})`;
        };

        const schema = makeRegisterSchema(spy);
        const result = schema.safeParse({});

        expect(seen.length).toBeGreaterThan(0);
        for (const message of Object.values(errorsOf(result))) {
            expect(message.startsWith('translated(')).toBe(true);
        }
    });

    it('passes the length as a parameter so catalogues can pluralise', () => {
        const params: Array<Record<string, string | number> | undefined> = [];
        makeRegisterSchema((key, p) => {
            if (key === VALIDATION_KEYS.passwordMinLength) params.push(p);
            return key;
        });
        expect(params).toContainEqual({ count: PASSWORD_MIN_LENGTH });
    });
});
