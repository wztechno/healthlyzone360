import { describe, expect, it } from 'vitest';

import {
    AllergenCode,
    BranchId,
    CODE_CODECS,
    ID_CODECS,
    InvalidIdentifierError,
    KitchenId,
    type MealId,
    OrganisationId,
    UUID_PATTERN,
    UserId,
    isEntityCode,
    isUuid,
    uuidVersion,
} from './ids.ts';

const UUID_V7 = '01935f6c-1a2b-7c3d-8e4f-0123456789ab';
const UUID_V4 = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** The identifiers K1's kitchen-management surface introduced. */
const KITCHEN_MANAGEMENT_ID_LABELS: readonly string[] = [
    'DeliveryWindowId',
    'PriceListId',
    'ProductId',
    'RecipeVersionId',
    'ServiceAreaId',
];

/** The identifiers the kitchen ops surface (inventory, procurement, production, QC) introduced. */
const KITCHEN_OPS_ID_LABELS: readonly string[] = [
    'GoodsReceiptId',
    'ProductionOrderId',
    'PurchaseOrderId',
    'QualityCheckId',
    'StockItemId',
    'SupplierContactId',
    'SupplierId',
];

describe('isUuid', () => {
    it.each([UUID_V7, UUID_V4, UUID_V7.toUpperCase()])('accepts %s', (value) => {
        expect(isUuid(value)).toBe(true);
    });

    it.each([
        ['empty string', ''],
        ['missing hyphens', '01935f6c1a2b7c3d8e4f0123456789ab'],
        ['too short', '01935f6c-1a2b-7c3d-8e4f-0123456789a'],
        ['nil uuid (version nibble 0)', '00000000-0000-0000-0000-000000000000'],
        ['bad variant nibble', '01935f6c-1a2b-7c3d-0e4f-0123456789ab'],
        ['non-hex characters', '01935f6c-1a2b-7c3d-8e4f-0123456789zz'],
    ])('rejects %s', (_label, value) => {
        expect(isUuid(value)).toBe(false);
    });

    it.each([[null], [undefined], [42], [{}], [[UUID_V7]]])('rejects non-string %s', (value) => {
        expect(isUuid(value)).toBe(false);
    });
});

describe('uuidVersion', () => {
    it('reads the version nibble', () => {
        expect(uuidVersion(UUID_V7)).toBe(7);
        expect(uuidVersion(UUID_V4)).toBe(4);
    });

    it('returns null for malformed input', () => {
        expect(uuidVersion('not-a-uuid')).toBeNull();
    });
});

describe('identifier codecs', () => {
    it('exposes the six foundation identifiers', () => {
        for (const label of [
            'BranchId',
            'DeviceId',
            'MembershipId',
            'OrganisationId',
            'RoleId',
            'UserId',
        ]) {
            expect(Object.keys(ID_CODECS)).toContain(label);
        }
    });

    it('exposes the twenty-one nutrition, marketplace and commerce identifiers', () => {
        expect(
            Object.keys(ID_CODECS)
                .filter(
                    (label) =>
                        ![
                            'BranchId',
                            'DeviceId',
                            'MembershipId',
                            'OrganisationId',
                            'RoleId',
                            'UserId',
                            ...KITCHEN_MANAGEMENT_ID_LABELS,
                            ...KITCHEN_OPS_ID_LABELS,
                        ].includes(label),
                )
                .sort(),
        ).toEqual([
            'CartId',
            'CorporateProgrammeId',
            'DeliveryZoneId',
            'DietitianId',
            'GroceryListId',
            'IngredientId',
            'KitchenBranchId',
            'KitchenId',
            'MealId',
            'MealPlanEntryId',
            'MealPlanId',
            'NutritionTargetId',
            'OrderId',
            'PlanVariantId',
            'QuotationId',
            'RecipeId',
            'SubscriptionId',
            'SubscriptionPlanId',
            'VdMessageId',
            'VdSessionId',
            'VolumeTierId',
        ]);
    });

    /**
     * The K1 management identifiers, kept as their own group rather than folded into the list above.
     * They name rows a consumer never sees — a recipe version, a price list, a service-area row —
     * and the split is what makes "did this phase add an identifier?" answerable at a glance.
     */
    it('exposes the five kitchen-management identifiers', () => {
        expect(
            Object.keys(ID_CODECS)
                .filter((label) => KITCHEN_MANAGEMENT_ID_LABELS.includes(label))
                .sort(),
        ).toEqual([...KITCHEN_MANAGEMENT_ID_LABELS].sort());
    });

    it('exposes the seven kitchen ops identifiers', () => {
        expect(
            Object.keys(ID_CODECS)
                .filter((label) => KITCHEN_OPS_ID_LABELS.includes(label))
                .sort(),
        ).toEqual([...KITCHEN_OPS_ID_LABELS].sort());
    });

    it('keeps every codec label unique', () => {
        const labels = [...Object.values(ID_CODECS), ...Object.values(CODE_CODECS)].map(
            (codec) => codec.label,
        );
        expect(new Set(labels).size).toBe(labels.length);
    });

    it.each(Object.entries(ID_CODECS))('%s.parse brands a valid uuid', (label, codec) => {
        expect(codec.label).toBe(label);
        expect(codec.parse(UUID_V7)).toBe(UUID_V7);
        expect(codec.is(UUID_V7)).toBe(true);
    });

    it.each(Object.entries(ID_CODECS))('%s.parse throws on invalid input', (label, codec) => {
        expect(() => codec.parse('nope')).toThrow(InvalidIdentifierError);
        try {
            codec.parse('nope');
        } catch (error) {
            expect(error).toBeInstanceOf(InvalidIdentifierError);
            expect((error as InvalidIdentifierError).label).toBe(label);
            expect((error as InvalidIdentifierError).received).toBe('nope');
            expect((error as Error).message).toContain(label);
        }
    });

    it('safeParse returns null instead of throwing', () => {
        expect(UserId.safeParse('nope')).toBeNull();
        expect(UserId.safeParse(UUID_V7)).toBe(UUID_V7);
    });

    it('unsafe brands without validating (fixtures only)', () => {
        expect(UserId.unsafe('fixture-user')).toBe('fixture-user');
    });

    it('keeps distinct identifier types nominally separate', () => {
        const organisation = OrganisationId.parse(UUID_V7);
        const branch = BranchId.parse(UUID_V7);

        // Compile-time proof: assigning across brands is rejected. Runtime values are equal strings.
        // @ts-expect-error branded identifiers are not interchangeable
        const misassigned: OrganisationId = branch;

        expect(misassigned).toBe(organisation);
    });

    it('keeps the new prototype identifiers nominally separate too', () => {
        const kitchen = KitchenId.parse(UUID_V7);

        // @ts-expect-error a KitchenId is not a MealId
        const misassigned: MealId = kitchen;

        expect(misassigned).toBe(kitchen);
    });
});

describe('code identifiers', () => {
    it.each(['peanut', 'tree_nut', 'gluten', 'sesame', 'sulphur_dioxide', 'milk'])(
        'accepts the allergen code %s',
        (code) => {
            expect(isEntityCode(code)).toBe(true);
            expect(AllergenCode.parse(code)).toBe(code);
        },
    );

    it.each([
        ['uppercase', 'Peanut'],
        ['kebab-case', 'tree-nut'],
        ['leading underscore', '_gluten'],
        ['trailing underscore', 'gluten_'],
        ['double underscore', 'tree__nut'],
        ['leading digit', '2_milk'],
        ['single character', 'x'],
        ['whitespace', 'tree nut'],
        ['empty', ''],
    ])('rejects %s', (_label, code) => {
        expect(isEntityCode(code)).toBe(false);
        expect(AllergenCode.safeParse(code)).toBeNull();
    });

    it('rejects a UUID, because an allergen is reference data rather than a row', () => {
        expect(AllergenCode.safeParse(UUID_V7)).toBeNull();
    });

    it('throws an InvalidIdentifierError naming the expected shape', () => {
        expect(() => AllergenCode.parse('Peanut')).toThrow(InvalidIdentifierError);
        try {
            AllergenCode.parse('Peanut');
        } catch (error) {
            expect((error as Error).message).toContain('AllergenCode');
            expect((error as Error).message).toContain('lowercase snake_case code');
        }
    });

    it('exposes exactly one code codec today', () => {
        expect(Object.keys(CODE_CODECS)).toEqual(['AllergenCode']);
    });
});

describe('UUID_PATTERN', () => {
    it('is case-insensitive and anchored', () => {
        expect(UUID_PATTERN.flags).toContain('i');
        expect(UUID_PATTERN.test(` ${UUID_V7}`)).toBe(false);
        expect(UUID_PATTERN.test(`${UUID_V7} `)).toBe(false);
    });
});
