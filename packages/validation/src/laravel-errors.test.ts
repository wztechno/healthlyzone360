import { describe, expect, it, vi } from 'vitest';

import {
    extractValidationDetails,
    isErrorEnvelope,
    mapLaravelValidationErrors,
} from './laravel-errors.ts';

function envelope(details: Record<string, string[]>, message = 'The given data was invalid.') {
    return {
        error: {
            code: 'validation.failed',
            message,
            details,
            correlation_id: '01935f6c-0000-7000-8000-00000000f001',
        },
    };
}

describe('isErrorEnvelope', () => {
    it.each([
        [{ error: {} }, true],
        [{ error: { code: 'x' } }, true],
        [{}, false],
        [{ error: null }, false],
        [{ error: 'boom' }, false],
        [null, false],
        [undefined, false],
        ['string', false],
        [[], false],
    ])('%j -> %s', (value, expected) => {
        expect(isErrorEnvelope(value)).toBe(expected);
    });
});

describe('extractValidationDetails', () => {
    it('returns the field map untouched', () => {
        expect(extractValidationDetails(envelope({ email: ['Taken.'] }))).toEqual({
            email: ['Taken.'],
        });
    });

    it('tolerates a single string instead of an array', () => {
        expect(extractValidationDetails({ error: { details: { email: 'Taken.' } } })).toEqual({
            email: ['Taken.'],
        });
    });

    it('drops non-string and empty entries', () => {
        expect(
            extractValidationDetails({
                error: { details: { email: [1, 'Taken.', null], name: [], '': ['x'], other: 7 } },
            }),
        ).toEqual({ email: ['Taken.'] });
    });

    it('returns an empty map for anything that is not an envelope', () => {
        expect(extractValidationDetails(null)).toEqual({});
        expect(extractValidationDetails({ error: {} })).toEqual({});
        expect(extractValidationDetails({ error: { details: null } })).toEqual({});
    });
});

describe('mapLaravelValidationErrors', () => {
    it('sets one form error per field', () => {
        const setError = vi.fn();
        const result = mapLaravelValidationErrors(
            envelope({ email: ['Already taken.'], password: ['Too short.'] }),
            setError,
        );

        expect(result).toEqual({ mapped: ['email', 'password'], unmapped: [], handled: true });
        expect(setError).toHaveBeenCalledWith(
            'email',
            { type: 'server', message: 'Already taken.' },
            { shouldFocus: true },
        );
        expect(setError).toHaveBeenCalledWith(
            'password',
            { type: 'server', message: 'Too short.' },
            { shouldFocus: false },
        );
    });

    it('joins multiple messages for one field', () => {
        const setError = vi.fn();
        mapLaravelValidationErrors(envelope({ email: ['Required.', 'Must be valid.'] }), setError);
        expect(setError).toHaveBeenCalledWith(
            'email',
            { type: 'server', message: 'Required. Must be valid.' },
            { shouldFocus: true },
        );
    });

    it('accepts a custom join strategy', () => {
        const setError = vi.fn();
        mapLaravelValidationErrors(envelope({ email: ['A', 'B'] }), setError, {
            joinMessages: (messages) => messages.join(' | '),
        });
        expect(setError.mock.calls[0]?.[1]).toEqual({ type: 'server', message: 'A | B' });
    });

    it('passes nested and indexed Laravel paths straight through', () => {
        const setError = vi.fn();
        const result = mapLaravelValidationErrors(
            envelope({ 'profile.name': ['Required.'], 'branches.0.id': ['Unknown.'] }),
            setError,
        );
        expect(result.mapped).toEqual(['profile.name', 'branches.0.id']);
        expect(setError.mock.calls.map((call) => call[0])).toEqual([
            'profile.name',
            'branches.0.id',
        ]);
    });

    it('folds unknown fields into the root error instead of dropping them', () => {
        const setError = vi.fn();
        const result = mapLaravelValidationErrors(
            envelope({ email: ['Taken.'], captcha: ['Failed.'] }),
            setError,
            { knownFields: ['email'] },
        );

        expect(result).toEqual({ mapped: ['email'], unmapped: ['captcha'], handled: true });
        expect(setError).toHaveBeenCalledWith('root', { type: 'server', message: 'Failed.' });
    });

    it('honours a custom root path', () => {
        const setError = vi.fn();
        mapLaravelValidationErrors(envelope({ captcha: ['Failed.'] }), setError, {
            knownFields: [],
            rootPath: 'root.serverError',
        });
        expect(setError).toHaveBeenCalledWith('root.serverError', {
            type: 'server',
            message: 'Failed.',
        });
    });

    it('falls back to the envelope message when there are no field details', () => {
        const setError = vi.fn();
        const result = mapLaravelValidationErrors(
            {
                error: {
                    code: 'auth.invalid_credentials',
                    message: 'These credentials do not match.',
                },
            },
            setError,
        );

        expect(result).toEqual({ mapped: [], unmapped: [], handled: true });
        expect(setError).toHaveBeenCalledWith('root', {
            type: 'server',
            message: 'These credentials do not match.',
        });
    });

    it('reports handled: false when there is nothing at all to show', () => {
        const setError = vi.fn();
        expect(mapLaravelValidationErrors({ error: {} }, setError)).toEqual({
            mapped: [],
            unmapped: [],
            handled: false,
        });
        expect(mapLaravelValidationErrors('not an envelope', setError).handled).toBe(false);
        expect(setError).not.toHaveBeenCalled();
    });

    it('can be told not to steal focus', () => {
        const setError = vi.fn();
        mapLaravelValidationErrors(envelope({ email: ['Taken.'] }), setError, {
            shouldFocusFirst: false,
        });
        expect(setError.mock.calls[0]?.[2]).toEqual({ shouldFocus: false });
    });
});
