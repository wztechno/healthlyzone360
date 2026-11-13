import { conflictFailure, throwFailure, validationFailure } from '@healthy360/api-client/contracts';
import type {
    IngredientAdmin,
    ItemPack,
    ItemPacks,
    RecipePackCost,
    SetItemPacksRequest,
} from '@healthy360/api-client/contracts';
import { IngredientId, PriceListId, ProductId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import type { HostSave } from './host-save.ts';
import { PacksPricesSection, packMargin, packsPerBatch } from './packs-prices-section.tsx';
import type { PacksRecipeFacts, PacksReport } from './packs-prices-section.tsx';

/**
 * Packs & prices, the section on its own — as the recipe editor draws it for a sold recipe.
 *
 * What is proven: the draft opens on the saved packs (an inherited price marked as such); a pack is
 * added from a container, its fill starting at what the container holds (a litre read as a kilo);
 * extras are added and removed by hand; a legacy pack with no container offers Choose container and
 * shows no margin while its packaging is unknown; the price fields follow the ticks (Counter is
 * priced by the Home shop field, and never has one of its own); the margin is (price − cost) ÷
 * price over the server's cost; the request the save sends; and what a refused save and a lock
 * conflict leave behind — the draft, still dirty, and a toast.
 */

const ITEM = ProductId.unsafe('01935f6d-0000-7000-8000-0000000d0101');
const SAVED_PACK = '01935f6d-0000-7000-8000-0000000c0101';
const BOTTLE_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0101');
const JAR_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0102');
const CAP_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0103');

function packaging(
    id: IngredientId,
    name: string,
    overrides: Partial<IngredientAdmin> = {},
): IngredientAdmin {
    return {
        id,
        meta: {
            lockVersion: 1,
            status: 'published',
            updatedAt: '2026-08-01T09:00:00.000Z',
            updatedByName: 'Rana Haddad',
        },
        name: { en: name, ar: name },
        slug: name.toLowerCase().replace(/\s+/gu, '-'),
        reference: null,
        subcategoryCode: null,
        categoryCode: 'packaging-disposables',
        measurementUnit: 'piece',
        purchaseUnit: 'pack',
        composition: null,
        itemsPerUnit: 24,
        gramsPerUnit: null,
        purchasePrice: { amount: 12, currency: 'USD' },
        wastePercent: 2,
        capacity: null,
        b2bPrice: null,
        b2cPrice: null,
        unitPrice: null,
        isSellable: false,
        costPer100g: null,
        per100g: null,
        nutritionDerivedFromVersionId: null,
        nutritionEstimated: null,
        nutritionNote: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: TEST_ORGANISATION_ID,
        forkedFromId: null,
        isEditable: true,
        notes: null,
        ...overrides,
    };
}

/** A 0.5 L bottle — the container the saved pack is filled into. */
const BOTTLE = packaging(BOTTLE_ID, 'Bottle 0.5 L', { capacity: { quantity: 0.5, unit: 'l' } });
/** A 1 L jar nobody uses yet: the one container "Add a pack" offers. */
const JAR = packaging(JAR_ID, 'Jar 1 L', { capacity: { quantity: 1, unit: 'l' } });
/** A cap holds nothing: an extra, never a container. */
const CAP = packaging(CAP_ID, 'Cap 38 mm');
const LIBRARY = [BOTTLE, JAR, CAP];

function savedPack(overrides: Partial<ItemPack> = {}): ItemPack {
    return {
        id: SAVED_PACK,
        code: 'BTL05',
        name: { en: 'Bottle 0.5 L', ar: 'زجاجة' },
        isDefault: true,
        fill: { quantity: 0.46, unit: 'kg' },
        components: [{ ingredientId: BOTTLE_ID, quantity: 1, isContainer: true }],
        prices: { home: { amountMinor: 450, inherited: true }, business: null },
        ...overrides,
    };
}

function itemPacks(overrides: Partial<ItemPacks> = {}): ItemPacks {
    return {
        lockVersion: 4,
        places: {
            home: {
                salesChannelId: 'web-shop',
                priceListId: PriceListId.unsafe('retail-usd'),
                currency: 'USD',
                offered: true,
            },
            business: {
                salesChannelId: 'wholesale',
                priceListId: PriceListId.unsafe('trade-usd'),
                currency: 'USD',
                offered: false,
            },
            counter: {
                salesChannelId: 'desk',
                offered: false,
                followsHome: true,
                priceListName: 'Retail',
            },
        },
        packs: [savedPack()],
        ...overrides,
    };
}

const COMPLETE: RecipePackCost = {
    key: SAVED_PACK,
    contents: { amount: 0.95, currency: 'USD' },
    packaging: { amount: 0.35, currency: 'USD' },
    cost: { amount: 1.3, currency: 'USD' },
    withheldReason: null,
};

function facts(overrides: Partial<PacksRecipeFacts> = {}): PacksRecipeFacts {
    return {
        yieldKg: 2,
        piecesPerBatch: null,
        computed: [COMPLETE],
        canViewCosts: true,
        ...overrides,
    };
}

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

async function press(testID: string) {
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

async function type(testID: string, text: string) {
    await act(async () => {
        fireEvent.changeText(screen.getByTestId(testID), text);
    });
}

async function pick(select: string, value: string) {
    await press(`${select}-trigger`);
    await untilVisible(`${select}-option-${value}`);
    await press(`${select}-option-${value}`);
}

const PACK = `kitchen-packs-${SAVED_PACK}`;

/** The section, with what it reports and the save it hands the page. */
async function renderSection(
    kitchenAdmin: Record<string, unknown>,
    given: Partial<PacksRecipeFacts> = {},
) {
    const reports: PacksReport[] = [];
    let save: HostSave | null = null;
    const rendered = await renderStubScreen(
        <PacksPricesSection
            itemId={ITEM}
            facts={facts(given)}
            onReport={(report) => {
                reports.push(report);
            }}
            onRegisterSave={(registered) => {
                save = registered;
            }}
        />,
        {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: async () => page(LIBRARY),
                    getItemPacks: async () => itemPacks(),
                    ...kitchenAdmin,
                },
            },
        },
    );
    const runSave = async (): Promise<boolean> => {
        let answer = false;
        await act(async () => {
            answer = save === null ? true : await save();
        });
        return answer;
    };
    return { ...rendered, reports, runSave };
}

describe('the arithmetic', () => {
    it('reads a margin off the price, and how many packs one batch fills', () => {
        // (4.50 − 1.30) ÷ 4.50 = 71 %, and $3.20 a pack.
        expect(packMargin(4.5, 1.3)).toEqual({ percent: 71, amount: expect.closeTo(3.2, 5) });
        expect(packMargin(null, 1.3)).toBeNull();
        expect(packMargin(0, 1.3)).toBeNull();
        // 2 kg fills four 0.46 kg packs; a litre is read as a kilogram; pieces need a count.
        expect(packsPerBatch({ fill: '0.46', fillUnit: 'kg' }, 2, null)).toBe(4);
        expect(packsPerBatch({ fill: '1', fillUnit: 'l' }, 2, null)).toBe(2);
        expect(packsPerBatch({ fill: '500', fillUnit: 'g' }, 2, null)).toBe(4);
        expect(packsPerBatch({ fill: '2', fillUnit: 'piece' }, 2, null)).toBeNull();
        expect(packsPerBatch({ fill: '2', fillUnit: 'piece' }, null, 12)).toBe(6);
    });
});

describe('Packs & prices', () => {
    it('opens on the saved packs, an inherited price marked as the item’s own', async () => {
        await renderSection({});

        await untilVisible(`${PACK}-price-home-input`);
        expect(screen.getByTestId(`${PACK}-price-home-input`).props.value).toBe('4.50');
        expect(screen.getByTestId(`${PACK}-fill-input`).props.value).toBe('0.46');
        expect(screen.getByTestId(`${PACK}-price-home-inherited`)).toBeTruthy();
        expect(screen.getByTestId(`${PACK}-code`)).toHaveTextContent('BTL05');
        expect(screen.getByTestId(`${PACK}-per-batch`)).toHaveTextContent('4 per batch');
        expect(screen.getByTestId('kitchen-packs-batch-fills')).toHaveTextContent(
            /One batch \(2\.00 Kg\) fills 4 × Bottle 0\.5 L/,
        );
        // The three places, each with what it is.
        expect(screen.getByTestId('kitchen-packs-place-home')).toHaveTextContent(/Web shop/);
        expect(screen.getByTestId('kitchen-packs-place-business')).toHaveTextContent(
            /Quotes · corporate catalogue/,
        );
        expect(screen.getByTestId('kitchen-packs-place-counter')).toHaveTextContent(/Order desk/);

        // Typed over, it is the pack's own price and the note goes.
        await type(`${PACK}-price-home-input`, '4.75');
        expect(screen.queryByTestId(`${PACK}-price-home-inherited`)).toBeNull();
    });

    it('adds a pack from a container, its fill starting at what the container holds', async () => {
        const { reports } = await renderSection({});

        await untilVisible('kitchen-packs-add-trigger');
        await press('kitchen-packs-add-trigger');
        // The jar is offered; the bottle (already a pack's) and the cap (holds nothing) are not.
        await untilVisible(`kitchen-packs-add-option-${String(JAR_ID)}`);
        expect(screen.queryByTestId(`kitchen-packs-add-option-${String(BOTTLE_ID)}`)).toBeNull();
        expect(screen.queryByTestId(`kitchen-packs-add-option-${String(CAP_ID)}`)).toBeNull();
        await press(`kitchen-packs-add-option-${String(JAR_ID)}`);

        // A litre is read as a kilogram (owner's ruling 4): the fill opens at 1 Kg.
        await untilVisible('kitchen-packs-new-1-fill-input');
        expect(screen.getByTestId('kitchen-packs-new-1-fill-input').props.value).toBe('1');
        // The suffix is decorative to assistive technology (the label names the unit).
        expect(
            screen.getByTestId('kitchen-packs-new-1-fill-unit', { includeHiddenElements: true }),
        ).toHaveTextContent('Kg');
        expect(screen.getByTestId('kitchen-packs-new-1-container')).toHaveTextContent('Jar 1 L');
        // Scoped to the new pack: the fixture's own pack (0.46 Kg in a 0.5 L bottle) carries its hint.
        expect(screen.queryByTestId('kitchen-packs-new-1-fill-hint')).toBeNull();

        // Changed, the field says what the container holds.
        await type('kitchen-packs-new-1-fill-input', '0.92');
        expect(screen.getByTestId('kitchen-packs-new-1-fill-hint')).toHaveTextContent(
            'Container holds 1 L',
        );

        // The draft goes up as roll-up input, keyed by the row.
        await waitFor(() => {
            expect(reports.at(-1)?.rollup).toEqual(
                expect.arrayContaining([
                    {
                        key: 'new-1',
                        fillQuantity: 0.92,
                        fillUnit: 'kg',
                        components: [{ ingredientId: JAR_ID, quantity: 1, isContainer: true }],
                    },
                ]),
            );
        });
        expect(reports.at(-1)?.dirty).toBe(true);
    });

    it('adds an extra by hand and takes it off again', async () => {
        await renderSection({});

        await untilVisible(`${PACK}-add-part-trigger`);
        await pick(`${PACK}-add-part`, String(CAP_ID));
        await untilVisible(`${PACK}-part-${String(CAP_ID)}`);
        expect(screen.getByTestId(`${PACK}-part-${String(CAP_ID)}`)).toHaveTextContent('Cap 38 mm');

        await press(`${PACK}-part-${String(CAP_ID)}-remove`);
        expect(screen.queryByTestId(`${PACK}-part-${String(CAP_ID)}`)).toBeNull();
        // The container is fixed: no remove beside it.
        expect(screen.queryByTestId(`${PACK}-container-remove`)).toBeNull();
    });

    it('offers Choose container on a pack with none, and shows no margin while packaging is unknown', async () => {
        await renderSection(
            {
                getItemPacks: async () => itemPacks({ packs: [savedPack({ components: [] })] }),
            },
            {
                computed: [
                    {
                        key: SAVED_PACK,
                        contents: { amount: 0.95, currency: 'USD' },
                        packaging: null,
                        cost: null,
                        withheldReason: 'packaging_unknown',
                    },
                ],
            },
        );

        await untilVisible(`${PACK}-choose-container-trigger`);
        expect(screen.getByTestId(`${PACK}-no-container`)).toBeTruthy();
        // The contents are costed; the pack is not, and says why — never a margin over half a cost.
        expect(screen.getByTestId(`${PACK}-cost`)).toHaveTextContent(/\$0\.95/);
        expect(screen.getByTestId(`${PACK}-cost`)).toHaveTextContent(/Packaging not known yet/);
        expect(screen.queryByTestId(`${PACK}-price-home-margin`)).toBeNull();

        await pick(`${PACK}-choose-container`, String(JAR_ID));
        await untilVisible(`${PACK}-container`);
        expect(screen.getByTestId(`${PACK}-container`)).toHaveTextContent('Jar 1 L');
        expect(screen.queryByTestId(`${PACK}-no-container`)).toBeNull();
    });

    it('draws the price fields the ticks call for — Home shop for Counter, never a Counter field', async () => {
        await renderSection({
            getItemPacks: async () =>
                itemPacks({
                    places: {
                        ...itemPacks().places,
                        home: { ...itemPacks().places.home!, offered: false },
                        counter: { ...itemPacks().places.counter!, offered: true },
                    },
                }),
        });

        // Counter alone: it charges the Home shop's price, so that is the field.
        await untilVisible(`${PACK}-price-home-input`);
        expect(screen.getByTestId(`${PACK}-price-home-counter`)).toHaveTextContent(
            'Counter charges this price',
        );
        expect(screen.queryByTestId(`${PACK}-price-business-input`)).toBeNull();
        expect(screen.queryByTestId(`${PACK}-price-counter-input`)).toBeNull();

        await press('kitchen-packs-place-business');
        await untilVisible(`${PACK}-price-business-input`);
        expect(screen.getByTestId(`${PACK}-price-business-input`).props.placeholder).toBe(
            'Not sold',
        );

        // Counter off and Home shop off: no Home shop field either.
        await press('kitchen-packs-place-counter');
        expect(screen.queryByTestId(`${PACK}-price-home-input`)).toBeNull();
    });

    it('reads Counter as locked, naming the list, when the desk does not follow the Home shop', async () => {
        await renderSection({
            getItemPacks: async () =>
                itemPacks({
                    places: {
                        ...itemPacks().places,
                        counter: {
                            salesChannelId: 'desk',
                            offered: false,
                            followsHome: false,
                            priceListName: 'Desk specials',
                        },
                    },
                }),
        });

        await untilVisible('kitchen-packs-counter-locked');
        expect(screen.getByTestId('kitchen-packs-counter-locked')).toHaveTextContent(
            /Desk specials/,
        );
        expect(
            screen.getByTestId('kitchen-packs-place-counter').props.accessibilityState.disabled,
        ).toBe(true);
    });

    it('states the margin over a complete cost: (price − cost) ÷ price, and the amount', async () => {
        await renderSection({});

        await untilVisible(`${PACK}-price-home-margin`);
        expect(screen.getByTestId(`${PACK}-price-home-margin`)).toHaveTextContent(
            '71% margin · $3.20 a pack',
        );
        expect(screen.getByTestId(`${PACK}-cost`)).toHaveTextContent(/\$1\.30/);

        await type(`${PACK}-price-home-input`, '2.60');
        expect(screen.getByTestId(`${PACK}-price-home-margin`)).toHaveTextContent(
            '50% margin · $1.30 a pack',
        );
    });

    it('saves the whole set in minor units, on the item’s lock', async () => {
        const sent: SetItemPacksRequest[] = [];
        const { runSave } = await renderSection({
            setItemPacks: async (_item: ProductId, request: SetItemPacksRequest) => {
                sent.push(request);
                return itemPacks({ lockVersion: 5 });
            },
        });

        await untilVisible(`${PACK}-price-home-input`);
        await press('kitchen-packs-place-business');
        await untilVisible(`${PACK}-price-business-input`);
        await type(`${PACK}-price-business-input`, '9.5');
        await pick(`${PACK}-add-part`, String(CAP_ID));

        await expect(runSave()).resolves.toBe(true);
        expect(sent).toEqual([
            {
                lockVersion: 4,
                places: { home: true, business: true, counter: false },
                packs: [
                    {
                        id: SAVED_PACK,
                        fill: { quantity: 0.46, unit: 'kg' },
                        components: [
                            { ingredientId: BOTTLE_ID, quantity: 1, isContainer: true },
                            { ingredientId: CAP_ID, quantity: 1, isContainer: false },
                        ],
                        // The inherited price is written as the pack's own (S1).
                        prices: { home: 450, business: 950 },
                    },
                ],
            },
        ]);
    });

    it('keeps the draft and says so when the packs are refused after the listing saved', async () => {
        const { runSave, reports } = await renderSection({
            setItemPacks: async () =>
                throwFailure(
                    validationFailure({
                        'packs.0.prices.home': ['A price needs a pack the Home shop can sell.'],
                    }),
                ),
        });

        await untilVisible(`${PACK}-price-home-input`);
        await type(`${PACK}-price-home-input`, '5.00');

        await expect(runSave()).resolves.toBe(false);
        await untilVisible('kitchen-packs-failed-toast');
        expect(screen.getByTestId(`${PACK}-price-home-input`).props.value).toBe('5.00');
        expect(screen.getByText('A price needs a pack the Home shop can sell.')).toBeTruthy();
        // Still unsaved, so the next Save writes it again.
        expect(reports.at(-1)?.dirty).toBe(true);
    });

    it('reads the item again on a lock conflict, keeps the draft, and says so', async () => {
        const { runSave, repositories, reports } = await renderSection({
            setItemPacks: async () => throwFailure(conflictFailure({ currentLockVersion: 6 })),
        });

        await untilVisible(`${PACK}-price-home-input`);
        await type(`${PACK}-price-home-input`, '5.00');
        const reads = (repositories.kitchenAdmin.getItemPacks as jest.Mock).mock.calls.length;

        await expect(runSave()).resolves.toBe(false);
        await untilVisible('kitchen-packs-failed-toast');
        expect(screen.getByTestId('kitchen-packs-failed-toast')).toHaveTextContent(
            /Someone changed this item/,
        );
        await waitFor(() => {
            expect(
                (repositories.kitchenAdmin.getItemPacks as jest.Mock).mock.calls.length,
            ).toBeGreaterThan(reads);
        });
        expect(screen.getByTestId(`${PACK}-price-home-input`).props.value).toBe('5.00');
        expect(reports.at(-1)?.dirty).toBe(true);
    });

    it('reports the publish blockers off the draft', async () => {
        const { reports } = await renderSection({
            getItemPacks: async () =>
                itemPacks({
                    packs: [savedPack({ prices: { home: null, business: null } })],
                }),
        });

        await waitFor(() => {
            expect(reports.at(-1)?.issues.map((issue) => issue.key)).toEqual([
                'place_unpriced-home',
            ]);
        });
        await untilVisible(`${PACK}-remove`);
        await press(`${PACK}-remove`);
        await press('kitchen-packs-place-home');
        await waitFor(() => {
            expect(reports.at(-1)?.issues.map((issue) => issue.code)).toEqual([
                'no_pack',
                'no_selling_place',
            ]);
        });
    });
});
