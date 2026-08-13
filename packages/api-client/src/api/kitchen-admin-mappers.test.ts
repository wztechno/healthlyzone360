import { describe, expect, it } from 'vitest';

import type { EnergyBand, PlanVariantCell } from '../generated/types.ts';
import {
    mapIngredientPublishableStatus,
    mapPlanVariantsFromCells,
} from './kitchen-admin-mappers.ts';

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

describe('mapPlanVariantsFromCells', () => {
    const BAND_ID = '019ffc6a-68d2-70d1-9f6c-6ddc160642a7';

    const band: EnergyBand = {
        id: BAND_ID,
        code: 'kcal-1600-1900',
        name_en: '1600–1900 kcal',
        name_ar: '١٦٠٠–١٩٠٠ سعرة',
        min_kcal: 1600,
        max_kcal: 1900,
        display_order: 1,
        is_active: true,
    };

    const bands = new Map([[BAND_ID, band]]);

    const cell = (overrides: Partial<PlanVariantCell> & { code: string }): PlanVariantCell => ({
        catalogue_item_variant_id: `variant-${overrides.code}`,
        status: 'active',
        name_en: null,
        name_ar: null,
        meal_combination_option_id: '019ffc6a-1111-7000-8000-000000000001',
        energy_band_id: BAND_ID,
        service_tier: 'standard',
        includes_snacks: false,
        meals_per_day: 1,
        snacks_per_day: 0,
        ...overrides,
    });

    /*
     * The seeded family plan: one meal a day, one band, three household sizes. Every one of them is
     * a variant a price can point at, so collapsing the band to a single row would hide two
     * configurations the kitchen sells — and would make a cell switched on in an occupied band
     * disappear on the next read.
     */
    it('keeps every cell of a band rather than the first', () => {
        const variants = mapPlanVariantsFromCells(
            [
                cell({ code: 'family-dinner-2-standard' }),
                cell({ code: 'family-dinner-3-standard' }),
                cell({ code: 'family-dinner-4-premium', service_tier: 'premium' }),
            ],
            bands,
        );

        expect(variants).toHaveLength(3);
        expect(variants.map((variant) => String(variant.id))).toEqual([
            'variant-family-dinner-2-standard',
            'variant-family-dinner-3-standard',
            'variant-family-dinner-4-premium',
        ]);
    });

    it('carries each cell own shape, band and status', () => {
        const [full, lunch, retired] = mapPlanVariantsFromCells(
            [
                cell({ code: 'full-day', meals_per_day: 3, snacks_per_day: 1, name_en: 'Full day' }),
                cell({ code: 'lunch-dinner', meals_per_day: 2 }),
                cell({ code: 'gone', status: 'archived' }),
            ],
            bands,
        );

        expect(full).toMatchObject({
            name: { en: 'Full day' },
            mealsPerDay: 3,
            snacksPerDay: 1,
            energyBand: { min: 1600, max: 1900 },
            isActive: true,
        });
        expect(lunch).toMatchObject({ mealsPerDay: 2, energyBand: { min: 1600, max: 1900 } });
        expect(retired?.isActive).toBe(false);
    });

    it('maps a cell with no band to the empty band rather than dropping it', () => {
        const variants = mapPlanVariantsFromCells(
            [cell({ code: 'no-band', energy_band_id: null })],
            bands,
        );

        expect(variants).toHaveLength(1);
        expect(variants[0]?.energyBand).toEqual({ min: 0, max: 0 });
    });
});
