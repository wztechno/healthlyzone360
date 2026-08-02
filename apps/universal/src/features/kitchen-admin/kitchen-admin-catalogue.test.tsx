import { createMemoryTokenStore } from '@healthy360/api-client';
import { apiFailure, throwFailure, validationFailure } from '@healthy360/api-client/contracts';
import type { MealAdmin, ProductAdmin } from '@healthy360/api-client/contracts';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { availabilityErrors, packErrors } from './catalogue-row-editors.tsx';
import type { AvailabilityDraft, PackDraft } from './catalogue-row-editors.tsx';
import {
    availableChannels,
    defaultPackVariant,
    parseClockTime,
    parseWholeNumber,
} from './format.ts';
import { MealEditScreen } from './screens/meal-edit-screen.tsx';
import { MealsScreen } from './screens/meals-screen.tsx';
import { ProductEditScreen } from './screens/product-edit-screen.tsx';
import { ProductsScreen } from './screens/products-screen.tsx';

/**
 * The product and meal half of the kitchen workspace, against the real mock repositories (K1.4).
 *
 * Nothing here stubs a hook. Five things this file exists to prove:
 *
 * 1. **Both lists tell the truth about what they cannot do.** A product has no publish action on
 *    this contract, so no row offers one; a meal has no archive, because retiring *is* the archive.
 * 2. **The pack editor keeps the row-editor promises.** Add, remove, undo to the row's own position,
 *    and a save that is refused — with the reason on the offending row — rather than silently
 *    writing a duplicate code that would orphan a price.
 * 3. **Channel and availability writes are their own acts.** Each has its own save, each lands
 *    through its own contract method, and each survives a reload of the record.
 * 4. **Publishing a meal is visible outside the kitchen.** The assertion is not on a status field:
 *    it is that `marketplace.listMeals` — the *consumer* repository, the same store — starts
 *    answering for the meal. That is the strongest claim this world can make, and it is real here.
 * 5. **The confidential field is confidential by construction.** The margin renders in the admin
 *    editor and has no field to render from on the consumer shape at all.
 */

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;
const CLINIC_OWNER = MOCK_SCENARIOS['single-org-owner'].primaryEmail;

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/kitchen/products',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

/** Signs in, applies the organisation context, lets a test arrange the world, then renders. */
async function renderKitchen(
    node: ReactNode | ((repositories: MockRepositories) => ReactNode),
    options: {
        readonly email?: string;
        readonly organisationSlug?: string;
        readonly latencyMs?: number;
        readonly prepare?: (repositories: MockRepositories) => void;
    } = {},
): Promise<Harness> {
    const email = options.email ?? KITCHEN_MANAGER;
    const slug = options.organisationSlug ?? 'verdant-kitchen';

    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: email === CLINIC_OWNER ? 'single-org-owner' : 'multi-org-dietitian',
        latencyMs: options.latencyMs ?? 1,
        tokenStore,
    });
    await repositories.auth.login({ email, password: 'password' });

    const me = await repositories.session.me();
    const membership = me.memberships.find(
        (candidate) => candidate.organisation.slug === slug && candidate.status === 'active',
    );
    if (membership === undefined) throw new Error(`No active membership in "${slug}".`);
    await repositories.context.setContext({ organisationId: membership.organisation.id });

    options.prepare?.(repositories);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {typeof node === 'function' ? node(repositories) : node}
        </AppProviders>,
    );

    return { repositories };
}

/** Waits for an element, with the same contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

/** A seeded product carrying more than one pack and at least one channel. */
let seededProduct: ProductAdmin;
/** A seeded, published meal — the one the consumer surfaces already answer for. */
let publishedMeal: MealAdmin;

beforeAll(async () => {
    const products = await scratch.kitchenAdmin.listProducts({ limit: 100 });
    const product = products.items.find(
        (row) => row.packVariants.length > 1 && row.channelAvailability.length > 0,
    );
    if (product === undefined) {
        throw new Error('The seed carries no product with several packs and a channel.');
    }
    seededProduct = product;

    const meals = await scratch.kitchenAdmin.listMeals({ limit: 100, statuses: ['published'] });
    const meal = meals.items[0];
    if (meal === undefined) throw new Error('The seed carries no published meal.');
    publishedMeal = meal;
});

/* ------------------------------------------------------------------------------------------------
 * Pure helpers
 * ---------------------------------------------------------------------------------------------- */

function pack(overrides: Partial<PackDraft>): PackDraft {
    return {
        key: 'a',
        code: 'SINGLE',
        label: { en: 'Single', ar: 'مفردة' },
        netQuantity: '250',
        netUnit: 'g',
        unitsPerPack: '1',
        ...overrides,
    };
}

function day(overrides: Partial<AvailabilityDraft>): AvailabilityDraft {
    return {
        key: 'a',
        date: '2026-08-12',
        isAvailable: true,
        remaining: '',
        orderCutOffAt: '',
        ...overrides,
    };
}

const PACK_MESSAGES = {
    codeRequired: 'code required',
    codeDuplicate: 'code duplicate',
    quantityInvalid: 'quantity invalid',
    unitsInvalid: 'units invalid',
};

const DAY_MESSAGES = {
    dateRequired: 'date required',
    dateDuplicate: 'date duplicate',
    remainingInvalid: 'remaining invalid',
    cutOffInvalid: 'cut-off invalid',
};

describe('catalogue display helpers', () => {
    it('reads a whole count and refuses a fraction of one', () => {
        expect(parseWholeNumber('12')).toBe(12);
        expect(parseWholeNumber('0')).toBe(0);
        expect(parseWholeNumber('')).toBeNull();
        expect(parseWholeNumber('2.5')).toBeNull();
        expect(parseWholeNumber('-1')).toBeNull();
    });

    it('reads a branch-local cut-off and normalises the hour', () => {
        expect(parseClockTime('18:00')).toBe('18:00');
        expect(parseClockTime('9:30')).toBe('09:30');
        expect(parseClockTime('24:00')).toBeNull();
        expect(parseClockTime('18:60')).toBeNull();
        expect(parseClockTime('six')).toBeNull();
    });

    it('calls the first pack the default one, because position is the only ordering there is', () => {
        expect(defaultPackVariant([])).toBeNull();
        expect(defaultPackVariant(seededProduct.packVariants)?.code).toBe(
            seededProduct.packVariants[0]!.code,
        );
    });

    it('reports only the channels a record is actually available on', () => {
        expect(
            availableChannels([
                { channel: 'b2c', isAvailable: true },
                { channel: 'b2b', isAvailable: false },
            ]),
        ).toEqual(['b2c']);
    });

    it('refuses a pack with no code, a duplicate code or an impossible measure', () => {
        expect(packErrors([pack({ code: '  ' })], PACK_MESSAGES).get('a')).toBe('code required');

        const duplicates = packErrors(
            [pack({ key: 'a', code: 'TRAY' }), pack({ key: 'b', code: 'tray' })],
            PACK_MESSAGES,
        );
        expect(duplicates.get('a')).toBeUndefined();
        expect(duplicates.get('b')).toBe('code duplicate');

        expect(packErrors([pack({ netQuantity: '0' })], PACK_MESSAGES).get('a')).toBe(
            'quantity invalid',
        );
        expect(packErrors([pack({ unitsPerPack: '0' })], PACK_MESSAGES).get('a')).toBe(
            'units invalid',
        );
        expect(packErrors([pack({})], PACK_MESSAGES).size).toBe(0);
    });

    it('refuses two answers about one calendar day, and an unparseable count or cut-off', () => {
        expect(availabilityErrors([day({ date: null })], DAY_MESSAGES).get('a')).toBe(
            'date required',
        );

        const duplicates = availabilityErrors([day({ key: 'a' }), day({ key: 'b' })], DAY_MESSAGES);
        expect(duplicates.get('b')).toBe('date duplicate');

        expect(availabilityErrors([day({ remaining: 'lots' })], DAY_MESSAGES).get('a')).toBe(
            'remaining invalid',
        );
        expect(availabilityErrors([day({ orderCutOffAt: 'evening' })], DAY_MESSAGES).get('a')).toBe(
            'cut-off invalid',
        );
        // Blank is `null` on the wire, not zero and not midnight — both are legal.
        expect(availabilityErrors([day({})], DAY_MESSAGES).size).toBe(0);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The product list
 * ---------------------------------------------------------------------------------------------- */

describe('the product list', () => {
    it('renders skeletons, then the seeded rows with their packs, channels and status', async () => {
        await renderKitchen(<ProductsScreen />, { latencyMs: 40 });

        await untilVisible('kitchen-products-loading');
        await untilVisible('kitchen-products-table');

        const base = `kitchen-product-${String(seededProduct.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-category`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-packs`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-packs-count`)).toHaveTextContent(
            new RegExp(String(seededProduct.packVariants.length)),
        );
        expect(screen.getByTestId(`${base}-channels`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-status`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('offers no publish control, because the contract publishes none for a product', async () => {
        await renderKitchen(<ProductsScreen />);
        await untilVisible('kitchen-products-table');

        const base = `kitchen-product-${String(seededProduct.id)}`;
        expect(screen.getByTestId(`${base}-open`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-archive`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-publish`)).toBeNull();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderKitchen(<ProductsScreen />);
        await untilVisible('kitchen-products-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-products-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-products-empty');
        expect(screen.getByTestId('kitchen-products-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        await renderKitchen(<ProductsScreen />, {
            prepare: (repositories) => {
                const failing = repositories.kitchenAdmin as unknown as {
                    listProducts: () => Promise<never>;
                };
                failing.listProducts = () =>
                    Promise.reject(throwFailure(apiFailure('server', { message: 'Boom.' })));
            },
        });

        await untilVisible('kitchen-products-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        await renderKitchen(<ProductsScreen />, {
            email: CLINIC_OWNER,
            organisationSlug: 'cedar-clinic',
        });

        await untilVisible('kitchen-products-forbidden');
        expect(screen.queryByTestId('kitchen-products-table')).toBeNull();
    });
});

/* ------------------------------------------------------------------------------------------------
 * The meal list
 * ---------------------------------------------------------------------------------------------- */

describe('the meal list', () => {
    it('renders skeletons, then the seeded rows with their label and publication state', async () => {
        await renderKitchen(<MealsScreen />, { latencyMs: 40 });

        await untilVisible('kitchen-meals-loading');
        await untilVisible('kitchen-meals-table');

        const base = `kitchen-meal-${String(publishedMeal.id)}`;
        expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-meal-types`)).toBeTruthy();
        expect(screen.getByTestId(`${base}-status`)).toHaveTextContent(/Published/);
        // A published meal says what publication *means* rather than leaving the badge to imply it.
        expect(screen.getByTestId(`${base}-visible`)).toHaveTextContent(/customers/i);
        expect(screen.getByTestId(`${base}-updated`)).toBeTruthy();
    });

    it('offers withdraw rather than archive, because retiring is the archive here', async () => {
        await renderKitchen(<MealsScreen />);
        await untilVisible('kitchen-meals-table');

        const base = `kitchen-meal-${String(publishedMeal.id)}`;
        expect(screen.getByTestId(`${base}-retire`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-archive`)).toBeNull();
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderKitchen(<MealsScreen />);
        await untilVisible('kitchen-meals-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meals-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-meals-empty');
    });

    it('renders the error state when the listing fails', async () => {
        await renderKitchen(<MealsScreen />, {
            prepare: (repositories) => {
                const failing = repositories.kitchenAdmin as unknown as {
                    listMeals: () => Promise<never>;
                };
                failing.listMeals = () =>
                    Promise.reject(throwFailure(apiFailure('server', { message: 'Boom.' })));
            },
        });

        await untilVisible('kitchen-meals-error');
    });
});

/* ------------------------------------------------------------------------------------------------
 * The product editor
 * ---------------------------------------------------------------------------------------------- */

describe('creating and editing a product', () => {
    it('creates a draft, lands on its own address, and saves an edit to it', async () => {
        const { repositories } = await renderKitchen(<ProductEditScreen product="new" />);

        await untilVisible('kitchen-product-name-en-input');
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-product-name-en-input'),
                'Cold-pressed pomegranate',
            );
        });
        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-product-name-ar-input'),
                'رمّان معصور على البارد',
            );
        });

        // A category is required, and the derived vocabulary is what the picker offers.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-category-trigger'));
        });
        await act(async () => {
            fireEvent.press(screen.getAllByTestId(/^kitchen-product-category-option-/)[0] as never);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await waitFor(() => {
            expect(routerMock.__replace).toHaveBeenCalled();
        });

        const page = await repositories.kitchenAdmin.listProducts({
            limit: 100,
            query: 'Cold-pressed pomegranate',
        });
        expect(page.items).toHaveLength(1);
        const created = page.items[0]!;
        expect(created.meta.status).toBe('draft');
        expect(created.name.ar).toBe('رمّان معصور على البارد');

        // …and the edit that follows lands on the record the create produced.
        const renamed = await repositories.kitchenAdmin.updateProduct(created.id, {
            lockVersion: created.meta.lockVersion,
            name: { en: 'Cold-pressed pomegranate, 2026', ar: 'رمّان معصور على البارد ٢٠٢٦' },
        });
        expect(renamed.meta.lockVersion).toBe(created.meta.lockVersion + 1);
    });

    it('adds a pack, undoes a removal to its own position, and refuses a duplicate code', async () => {
        await renderKitchen(<ProductEditScreen product={String(seededProduct.id)} />);
        await untilVisible('kitchen-product-packs-add');

        const first = seededProduct.packVariants[0]!;
        const second = seededProduct.packVariants[1]!;
        const firstRow = `kitchen-product-pack-editor-row-seed-0-${first.code}`;
        const secondRow = `kitchen-product-pack-editor-row-seed-1-${second.code}`;

        expect(screen.getByTestId(`${firstRow}-default`)).toBeTruthy();
        expect(screen.queryByTestId(`${secondRow}-default`)).toBeNull();

        // Remove the first pack; the second inherits the default badge, and undo puts it back.
        await act(async () => {
            fireEvent.press(screen.getByTestId(`${firstRow}-remove`));
        });
        expect(screen.queryByTestId(firstRow)).toBeNull();
        expect(screen.getByTestId(`${secondRow}-default`)).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-pack-editor-removed-bar-undo'));
        });
        await untilVisible(`${firstRow}-default`);
        expect(screen.queryByTestId(`${secondRow}-default`)).toBeNull();

        // A duplicate code is refused on the offending row and blocks the save, because a price
        // list points at a pack by its code and two of them make the reference ambiguous.
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${secondRow}-code-input`), first.code);
        });
        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-product-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        expect(screen.getByTestId('kitchen-product-pack-editor-row-pack-1')).toBeTruthy();
    });

    it('saves a new pack through the record write, and the list reads it back', async () => {
        const { repositories } = await renderKitchen(
            <ProductEditScreen product={String(seededProduct.id)} />,
        );
        await untilVisible('kitchen-product-packs-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        const added = 'kitchen-product-pack-editor-row-pack-1';
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-code-input`), 'CASE24');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-quantity-input`), '6000');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${added}-units-per-pack-input`), '24');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getProduct(seededProduct.id);
            expect(after.packVariants.map((entry) => entry.code)).toContain('CASE24');
            expect(after.packVariants.find((entry) => entry.code === 'CASE24')?.unitsPerPack).toBe(
                24,
            );
        });
    });

    it('persists a channel toggle through its own contract method', async () => {
        const { repositories } = await renderKitchen(
            <ProductEditScreen product={String(seededProduct.id)} />,
        );
        await untilVisible('kitchen-product-channel-editor');

        // Every channel is a row, including the ones this product is not sold through.
        expect(screen.getByTestId('kitchen-product-channel-editor-pos')).toBeTruthy();

        const before = await repositories.kitchenAdmin.getProduct(seededProduct.id);
        expect(availableChannels(before.channelAvailability)).not.toContain('pos');

        await act(async () => {
            fireEvent.press(
                screen.getByTestId('kitchen-product-channel-editor-pos-toggle-control'),
            );
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-channels-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getProduct(seededProduct.id);
            expect(availableChannels(after.channelAvailability)).toContain('pos');
        });
        await untilVisible('kitchen-product-channels-saved-toast');
    });

    it('archives behind a confirmation that says nothing is deleted', async () => {
        const { repositories } = await renderKitchen(
            <ProductEditScreen product={String(seededProduct.id)} />,
        );
        await untilVisible('kitchen-product-archive');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-archive'));
        });
        await untilVisible('kitchen-product-archive-dialog');
        expect(screen.getByTestId('kitchen-product-archive-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-archive-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getProduct(seededProduct.id);
            expect(after.meta.status).toBe('retired');
        });
    });

    it('offers reload-or-keep when somebody else has moved the product on', async () => {
        const { repositories } = await renderKitchen(
            <ProductEditScreen product={String(seededProduct.id)} />,
        );
        await untilVisible('kitchen-product-name-en-input');

        const held = await repositories.kitchenAdmin.getProduct(seededProduct.id);
        repositories.prototypeStore.kitchenCatalogue.updateProduct(seededProduct.id, {
            lockVersion: held.meta.lockVersion,
            description: { en: 'Changed by the other tab.', ar: 'غُيّر من التبويب الآخر.' },
        });

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-product-name-en-input'), 'My version');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-save'));
        });

        await untilVisible('kitchen-product-editor-screen-conflict-dialog');
        const untouched = await repositories.kitchenAdmin.getProduct(seededProduct.id);
        expect(untouched.name.en).toBe(seededProduct.name.en);
        expect(untouched.description.en).toBe('Changed by the other tab.');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-conflict-reload'));
        });
        await waitFor(() => {
            expect(screen.getByTestId('kitchen-product-name-en-input').props.value).toBe(
                seededProduct.name.en,
            );
        });
    });

    it('asks before throwing away an unsaved pack', async () => {
        await renderKitchen(<ProductEditScreen product={String(seededProduct.id)} />);
        await untilVisible('kitchen-product-packs-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-packs-add'));
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-back'));
        });

        await untilVisible('kitchen-product-editor-screen-unsaved-dialog');
        expect(routerMock.__push).not.toHaveBeenCalledWith('/kitchen/products');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-product-editor-screen-unsaved-discard'));
        });
        await waitFor(() => {
            expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/products');
        });
    });
});

/* ------------------------------------------------------------------------------------------------
 * The meal editor
 * ---------------------------------------------------------------------------------------------- */

describe('editing a meal', () => {
    it('saves both halves of a bilingual name and a changed portion', async () => {
        const { repositories } = await renderKitchen(
            <MealEditScreen meal={String(publishedMeal.id)} />,
        );
        await untilVisible('kitchen-meal-name-en-input');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-meal-name-en-input'),
                'Freekeh bowl, larger',
            );
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-meal-portion-input'), '1.5');
        });
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-editor-screen-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getMeal(publishedMeal.id);
            expect(after.name.en).toBe('Freekeh bowl, larger');
            expect(after.portionFactor).toBe(1.5);
        });
    });

    it('refuses a portion of nothing rather than dividing by it', async () => {
        await renderKitchen(<MealEditScreen meal={String(publishedMeal.id)} />);
        await untilVisible('kitchen-meal-portion-input');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-meal-portion-input'), '0');
        });

        await waitFor(() => {
            expect(
                screen.getByTestId('kitchen-meal-editor-screen-save').props.accessibilityState
                    ?.disabled,
            ).toBe(true);
        });
    });

    it('writes a day of availability by its calendar date, and reads it back', async () => {
        const { repositories } = await renderKitchen(
            <MealEditScreen meal={String(publishedMeal.id)} />,
        );
        await untilVisible('kitchen-meal-availability-add');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-availability-add'));
        });

        const row = 'kitchen-meal-availability-editor-row-day-1';
        await untilVisible(row);

        // The date field is the design system's, so the value is set through its own onChange.
        await act(async () => {
            fireEvent(screen.getByTestId(`${row}-date`), 'onChange', '2026-09-01');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-remaining-input`), '40');
        });
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${row}-cutoff-input`), '18:00');
        });

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-availability-save'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getMeal(publishedMeal.id);
            const written = after.availability.find((entry) => entry.date === '2026-09-01');
            expect(written).toBeDefined();
            expect(written?.remaining).toBe(40);
            expect(written?.orderCutOffAt).toBe('18:00');
        });
    });

    it('renders the confidential margin here, where the consumer shape has no field for it', async () => {
        const { repositories } = await renderKitchen(
            <MealEditScreen meal={String(publishedMeal.id)} />,
        );
        await untilVisible('kitchen-meal-confidential');

        expect(screen.getByTestId('kitchen-meal-confidential-badge')).toBeTruthy();
        // Either a figure or the honest refusal to state one — never a fabricated zero.
        const stated =
            screen.queryByTestId('kitchen-meal-margin') ??
            screen.queryByTestId('kitchen-meal-margin-unknown');
        expect(stated).toBeTruthy();

        // The confidentiality is structural, not a filter: the consumer record has no such field.
        const consumer = await repositories.marketplace.getMeal(publishedMeal.id);
        expect(Object.keys(consumer)).not.toContain('marginPercent');
    });
});

/* ------------------------------------------------------------------------------------------------
 * Publication
 * ---------------------------------------------------------------------------------------------- */

describe('publishing a meal', () => {
    it('makes it visible to consumers, and not before', async () => {
        let mealId: MealAdmin['id'] | null = null;

        const { repositories } = await renderKitchen((repos) => {
            const created = repos.prototypeStore.kitchenCatalogue.createMeal({
                name: { en: 'Charred aubergine bowl', ar: 'وعاء الباذنجان المشوي' },
                description: { en: 'Smoked, with tahini.', ar: 'مدخّن، مع طحينة.' },
                mealTypes: ['lunch'],
            });
            mealId = created.id;
            return <MealEditScreen meal={String(created.id)} />;
        });

        const created = mealId!;

        // A draft is on no consumer surface, which is the state publication changes.
        const before = await repositories.marketplace.listMeals({ limit: 100 });
        expect(before.items.map((item) => String(item.id))).not.toContain(String(created));

        await untilVisible('kitchen-meal-publish');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });

        await untilVisible('kitchen-meal-publish-dialog');
        // The dialog states the consequence and the label before it asks.
        expect(screen.getByTestId('kitchen-meal-publish-consequence')).toBeTruthy();
        expect(screen.getByTestId('kitchen-meal-publish-allergens')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.kitchenAdmin.getMeal(created);
            expect(after.meta.status).toBe('published');
        });

        // The store flipped: the *consumer* repository now answers for it.
        const after = await repositories.marketplace.listMeals({ limit: 100 });
        expect(after.items.map((item) => String(item.id))).toContain(String(created));
        await expect(repositories.marketplace.getMeal(created)).resolves.toBeDefined();

        // …and the editor offers the way to go and look at it.
        await untilVisible('kitchen-meal-view-public');
    });

    it('gives a new meal no allergen label it did not earn', async () => {
        const created = scratch.prototypeStore.kitchenCatalogue.createMeal({
            name: { en: 'Plain rice', ar: 'أرز سادة' },
            description: { en: 'Nothing else.', ar: 'لا شيء آخر.' },
        });

        // The mock builds a new meal from a template row. Inheriting that row's allergen
        // declaration would publish a food-safety claim nobody made about this dish.
        expect(created.allergens).toEqual([]);
        expect(created.recipeVersionId).toBeNull();
    });

    /**
     * The quarantine refusal, driven from the repository rather than from the store.
     *
     * Deliberate: this world's `setIngredientAllergens` quarantines *ingredients and recipes*, and
     * nothing in the mock catalogue moves a meal to `review_required` — so arranging that state
     * would mean writing into the store's private fields, which asserts the harness rather than the
     * product. What is genuinely this screen's job is rendering the server's structural refusal as a
     * quarantine rather than as a generic error, and leaving the meal invisible. That is what a
     * `validation.failed` on `status` produces, and that is what is asserted here.
     */
    it('renders a refusal on `status` as a quarantine, and the meal stays invisible', async () => {
        let mealId: MealAdmin['id'] | null = null;

        const { repositories } = await renderKitchen((repos) => {
            const created = repos.prototypeStore.kitchenCatalogue.createMeal({
                name: { en: 'Contested tabbouleh', ar: 'تبولة محلّ خلاف' },
                description: { en: 'Under review.', ar: 'قيد المراجعة.' },
                mealTypes: ['lunch'],
            });
            mealId = created.id;

            const refusing = repos.kitchenAdmin as unknown as {
                publishMeal: () => Promise<never>;
            };
            refusing.publishMeal = () =>
                Promise.reject(
                    throwFailure(
                        validationFailure({
                            status: [
                                'This meal is quarantined for review because its allergen ' +
                                    'information contradicts a published recipe.',
                            ],
                        }),
                    ),
                );

            return <MealEditScreen meal={String(created.id)} />;
        });

        const created = mealId!;
        await untilVisible('kitchen-meal-publish');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish'));
        });
        await untilVisible('kitchen-meal-publish-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-publish-confirm'));
        });

        // A quarantine, not a red apology: the refusal is a fact about the record.
        await untilVisible('kitchen-meal-publish-refused-quarantine');
        expect(screen.queryByTestId('kitchen-meal-publish-failed')).toBeNull();

        const consumer = await repositories.marketplace.listMeals({ limit: 100 });
        expect(consumer.items.map((item) => String(item.id))).not.toContain(String(created));
    });

    it('withdraws a published meal and the consumer listing loses it', async () => {
        const { repositories } = await renderKitchen(
            <MealEditScreen meal={String(publishedMeal.id)} />,
        );
        await untilVisible('kitchen-meal-retire');

        const before = await repositories.marketplace.listMeals({ limit: 100 });
        expect(before.items.map((item) => String(item.id))).toContain(String(publishedMeal.id));

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-retire'));
        });
        await untilVisible('kitchen-meal-retire-dialog');
        expect(screen.getByTestId('kitchen-meal-retire-consequence')).toBeTruthy();

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-meal-retire-confirm'));
        });

        await waitFor(async () => {
            const after = await repositories.marketplace.listMeals({ limit: 100 });
            expect(after.items.map((item) => String(item.id))).not.toContain(
                String(publishedMeal.id),
            );
        });
    });
});
