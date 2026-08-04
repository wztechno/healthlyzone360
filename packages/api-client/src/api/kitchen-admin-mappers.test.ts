import { describe, expect, it } from 'vitest';

import { mapIngredientPublishableStatus } from './kitchen-admin-mappers.ts';

describe('mapIngredientPublishableStatus', () => {
    it('maps archived rows to retired', () => {
        expect(mapIngredientPublishableStatus('archived', 'verified')).toBe('retired');
    });

    it('maps requires_review verification to review_required', () => {
        expect(mapIngredientPublishableStatus('active', 'requires_review')).toBe('review_required');
    });

    it('maps active verified rows to published', () => {
        expect(mapIngredientPublishableStatus('active', 'verified')).toBe('published');
    });

    it('maps inactive rows to draft', () => {
        expect(mapIngredientPublishableStatus('inactive', 'unverified')).toBe('draft');
    });
});
