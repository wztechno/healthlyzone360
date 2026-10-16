import { apiFailure, validationFailure } from '@healthy360/api-client';
import type { ApiFailure } from '@healthy360/api-client';

import { serverFieldErrors } from './server-field-errors.ts';

function refused(fields: Record<string, readonly string[]>): ApiFailure {
    return validationFailure(fields, { message: 'The submitted data is invalid.' });
}

describe('serverFieldErrors', () => {
    it('is empty for no failure and for a failure that is not about fields', () => {
        expect(serverFieldErrors(null).isValidation).toBe(false);
        const conflict = apiFailure('address.area_not_served');
        const none = serverFieldErrors(conflict, { name_ar: { label: 'AR', fieldId: 'x' } });
        expect(none.isValidation).toBe(false);
        expect(none.flag('name_ar')).toEqual({});
        expect(none.items).toHaveLength(0);
    });

    it('puts each message on its field and names the field in the banner', () => {
        const server = serverFieldErrors(
            refused({ name_ar: ['The name ar field is required.'], email: ['Bad email.'] }),
            {
                name_ar: { label: 'Name (AR)', fieldId: 'name-ar' },
                email: { label: 'Email', fieldId: 'email' },
            },
        );

        expect(server.flag('name_ar')).toEqual({ error: 'The name ar field is required.' });
        expect(server.flag('email')).toEqual({ error: 'Bad email.' });
        expect(server.flag('phone')).toEqual({});
        expect(server.items.map((item) => item.label)).toEqual(['Name (AR)', 'Email']);
        expect(server.unplaced).toBeNull();
    });

    it('matches rows by wildcard, one chip for the table', () => {
        const server = serverFieldErrors(
            refused({ 'lines.0.quantity': ['Too few.'], 'lines.3.quantity': ['Too many.'] }),
            { 'lines.*.quantity': { label: 'Quantity', fieldId: 'lines' } },
        );

        expect(server.errorFor('lines.3.quantity')).toBe('Too many.');
        expect(server.errorFor('lines.1.quantity')).toBeUndefined();
        expect(server.items).toHaveLength(1);
    });

    it('hands back what the form did not describe, so it is never lost', () => {
        const server = serverFieldErrors(refused({ slug: ['Taken.'], email: ['Bad email.'] }), {
            email: { label: 'Email', fieldId: 'email' },
        });

        expect(server.unplaced).toBe('Taken.');
        expect(server.items).toHaveLength(1);
    });
});
