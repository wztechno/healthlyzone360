import { describe, expect, it } from 'vitest';

import { identityTranslate } from './messages.ts';
import { toFormResolver } from './resolver.ts';
import { makeLoginSchema } from './schemas.ts';

const resolver = toFormResolver(makeLoginSchema(identityTranslate));

describe('toFormResolver', () => {
    it('returns parsed values and no errors for valid input', async () => {
        const result = await resolver(
            { email: 'Layla@Example.com', password: 'secret' },
            undefined,
            // React Hook Form supplies this context; only `fields` and `shouldUseNativeValidation`
            // are consulted by the standard-schema resolver.
            { fields: {}, shouldUseNativeValidation: false },
        );

        expect(result.errors).toEqual({});
        expect(result.values).toEqual({
            email: 'layla@example.com',
            password: 'secret',
            remember: false,
        });
    });

    it('maps schema failures onto field paths React Hook Form understands', async () => {
        const result = await resolver({ email: 'nope', password: '' }, undefined, {
            fields: {},
            shouldUseNativeValidation: false,
        });

        expect(result.values).toEqual({});
        expect(Object.keys(result.errors).sort()).toEqual(['email', 'password']);
        expect(result.errors.email?.message).toBe('errors:validation.email');
        expect(result.errors.password?.message).toBe('errors:validation.required');
    });
});
