import { apiFailure, throwFailure } from '@healthy360/api-client/contracts';
import { PACKAGING_CATEGORY_CODE } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    CursorPage,
    IngredientAdmin,
    IngredientAdminFilter,
    IngredientCategoryAdmin,
} from '@healthy360/api-client/contracts';
import { IngredientId, RoleId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Dimensions } from 'react-native';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    kitchenManagerSession,
    testActiveContext,
    testMeResponse,
    testMembership,
    testOrganisation,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { PackagingScreen } from './screens/packaging-screen.tsx';

/**
 * `/kitchen/packaging`, against a world this file authors.
 *
 * Nothing here stubs a hook: the screen runs through `Repositories`, the interface production
 * speaks. Every box, price and taxonomy node below is written here, so "one row has no price" is a
 * statement about what this test wrote rather than about a fixture somebody else owns.
 *
 * Four things this file exists to prove:
 *
 * 1. **It asks the ingredient endpoint for the packaging branch, by name.** The two families share
 *    one table again, so what makes this a packaging list is its `categoryCode` and nothing else.
 *    The listing stub below *refuses* a request that does not carry it, rather than returning the
 *    boxes anyway — a list that forgot the filter would otherwise render three hundred ingredients
 *    and look like it had worked, which is the failure that got the family split out in the first
 *    place.
 * 2. **The figures the page opens with are the figures a kitchen has to clear.** Unpriced above
 *    all: a recipe's technical sheet withholds its total while any packaging line has no price.
 * 3. **The status vocabulary is the ingredient one.** `PackagingStatus` was active / inactive /
 *    archived and turned out to be the same three states the ingredient column already stored, so
 *    the enum went. What is still absent is `review_required` — the allergen quarantine — because
 *    a box declares no allergens and nothing can put one there.
 * 4. **Archive carries the version the list was showing.** Which is what optimistic locking exists
 *    for, and the only lifecycle write this catalogue publishes for a box.
 */

jest.mock('expo-router', () => {
    const push = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({
            push,
            replace: jest.fn(),
            setParams: jest.fn(),
            back: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/packaging',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
});

/** Waits for an element, with the contention headroom the other kitchen suites document. */
function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 10_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The world this file authors
 * ---------------------------------------------------------------------------------------------- */

const SUBCATEGORY_CODE = `${PACKAGING_CATEGORY_CODE}-boxes`;

function itemIdentifier(ordinal: number): IngredientId {
    return IngredientId.unsafe(`01935f6d-0000-7000-8000-0000000e000${String(ordinal)}`);
}

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

interface ItemSeed {
    readonly ordinal: number;
    readonly name?: string;
    readonly overrides?: Partial<IngredientAdmin>;
}

/**
 * A priced box, filed under a leaf of the packaging branch.
 *
 * An `IngredientAdmin`, because that is what packaging is now: the two families share one table and
 * one row shape, and what makes this row packaging is its category — nothing else on it. The three
 * fields food leaves null (`purchasePrice`, `wastePercent`, `capacity`) are the three this page
 * draws columns for.
 */
function item({ ordinal, name, overrides = {} }: ItemSeed): IngredientAdmin {
    const label = name ?? `Box ${String(ordinal)}`;
    return {
        id: itemIdentifier(ordinal),
        meta: meta(),
        name: { en: label, ar: `${label} بالعربية` },
        reference: `PKG-00${String(ordinal)}`,
        categoryCode: PACKAGING_CATEGORY_CODE,
        subcategoryCode: SUBCATEGORY_CODE,
        composition: 'Kraft paper',
        measurementUnit: 'piece',
        purchaseUnit: 'piece',
        itemsPerUnit: 50,
        wastePercent: 2,
        purchasePrice: { amount: 12.5, currency: 'AED' },
        capacity: { quantity: 0.75, unit: 'kg' },
        costPer100g: null,
        b2bPrice: null,
        b2cPrice: null,
        unitPrice: null,
        isSellable: false,
        per100g: null,
        allergens: [],
        dietClassifications: [],
        aliases: [],
        organisationId: null,
        forkedFromId: null,
        isEditable: true,
        notes: null,
        ...overrides,
    };
}

const CATEGORIES: readonly IngredientCategoryAdmin[] = [
    {
        code: PACKAGING_CATEGORY_CODE,
        name: { en: 'Packaging & disposables', ar: 'التغليف' },
        parentCode: null,
        displayOrder: 1,
        isActive: true,
    },
    {
        code: SUBCATEGORY_CODE,
        name: { en: 'Boxes', ar: 'علب' },
        parentCode: PACKAGING_CATEGORY_CODE,
        displayOrder: 2,
        isActive: true,
    },
];

/**
 * The ingredient listing, as this screen drives it.
 *
 * **It asserts the branch.** A packaging list that forgot its `categoryCode` would simply be an
 * ingredient list — the mirror of the failure that got the family moved to a table of its own —
 * so this stub refuses a request that does not name the branch rather than quietly returning the
 * boxes anyway and letting a broken screen look correct.
 */
function packagingListing(
    read: () => readonly IngredientAdmin[],
): (filter?: IngredientAdminFilter) => Promise<CursorPage<IngredientAdmin>> {
    return async (filter) => {
        if (filter?.categoryCode !== PACKAGING_CATEGORY_CODE) {
            throw new Error(
                'The packaging list must ask `listIngredients` for the ' +
                    `"${PACKAGING_CATEGORY_CODE}" branch by name; it asked for ` +
                    `"${String(filter?.categoryCode)}".`,
            );
        }

        const statuses = filter.statuses;
        const needle = filter.query?.trim().toLocaleLowerCase() ?? '';
        return page(
            read().filter(
                (row) =>
                    (statuses === undefined || statuses.includes(row.meta.status)) &&
                    (needle === '' || row.name.en.toLocaleLowerCase().includes(needle)),
            ),
        );
    };
}

/** An organisation owner: an organisation, a branch, and no catalogue permission at all. */
function organisationOwnerSession() {
    return testMeResponse({
        memberships: [
            testMembership({
                organisation: testOrganisation({
                    name: 'Cedar Clinic',
                    slug: 'cedar-clinic',
                    type: 'clinic',
                }),
                roles: [
                    {
                        id: RoleId.unsafe('test-0000-role-0002'),
                        key: 'organisation_owner',
                        name: 'Owner',
                    },
                ],
            }),
        ],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

/* ------------------------------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------------------------------- */

describe('the packaging list', () => {
    /*
     * A desk surface, and above `md` the Catalogue draws a record as tracks rather than the
     * two-line row it falls back to below it (§4.1). React Native's Jest default window is 750px,
     * eighteen short of the 768 `md` asks for, so a column assertion needs the window widened
     * first. `Dimensions.set` rather than a mocked `useBreakpoint`: the branch reads the real
     * window, and a test that stubbed the hook would prove the stub.
     */
    const narrowWindow = Dimensions.get('window');
    const narrowScreen = Dimensions.get('screen');

    beforeAll(() => {
        Dimensions.set({
            window: { ...narrowWindow, width: 1440, height: 900 },
            screen: { ...narrowScreen, width: 1440, height: 900 },
        });
    });

    afterAll(() => {
        Dimensions.set({ window: narrowWindow, screen: narrowScreen });
    });

    it('renders skeletons, then the authored rows with their price, capacity and status', async () => {
        const row = item({ ordinal: 1, name: 'Kraft lunch box' });

        // A visible latency, so the pending frame is deterministically observable rather than a
        // race against a stub that resolves on a microtask.
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            latencyMs: 40,
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [row]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });

        await untilVisible('kitchen-packaging-loading');
        await untilVisible('kitchen-packaging-table');

        const base = `kitchen-packaging-row-${String(row.id)}`;

        /*
         * The column that names the row, on the `label` step — what the other five Catalogue lists
         * give it.
         *
         * This column had no `render` at all, so `DataList` fell back to its default cell class and
         * the item set at `role-body`'s 400 while the ingredient list next door set the same column
         * at 500. Nothing caught it because nothing asserted it: the cell had no test id either, so
         * there was no row content here to be wrong.
         *
         * The class assertion is the exception this file makes to leaving type treatment to the
         * design system's own suite. The id alone proves a `render` exists; it cannot tell one
         * rendered at the wrong step from one rendered at the right one, which is the half that
         * actually drifted.
         *
         * **These classes are the comfortable ladder, not the admin's.** The screen is mounted
         * here on its own, so `KitchenOpsShell` — and the `DensityProvider value="compact"` it
         * carries — is not in the tree. `variant="label"` therefore resolves to `text-sm
         * font-medium` rather than to `text-role-label`; in the running app it is the latter, 12px
         * at 500 against the cells' 400. Both are the same variant, which is the thing being
         * asserted. `text-role-body` is the tell either way: that is `DataList`'s fallback cell
         * class, which is density-agnostic, and its absence is what proves a `render` exists.
         */
        const name = screen.getByTestId(`${base}-name`);
        expect(name).toHaveTextContent('Kraft lunch box');
        expect(name.props.className).toContain('font-medium');
        expect(name.props.className).not.toContain('text-role-body');

        expect(screen.getByTestId(`${base}-reference`)).toHaveTextContent('PKG-001');
        // The branch, not the leaf: this track carries the parent category. The sub-category is
        // still on the record and still filters — it is read in the View panel.
        expect(screen.getByTestId(`${base}-category`)).toHaveTextContent('Packaging & disposables');
        expect(screen.getByTestId(`${base}-purchase-price`)).toHaveTextContent('12.50');
        // "Live", not "Active": packaging is an ingredient and reads the ingredient vocabulary.
        // `PackagingStatus` turned out to be the same three states under different names, so the
        // enum went and these rows joined the one the rest of the catalogue already used.
        expect(screen.getByTestId(`${base}-status`)).toHaveTextContent(/Published/);
    });

    it('opens with the figures a kitchen has to clear, and Inactive narrows the list', async () => {
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [
                        item({ ordinal: 1, name: 'Kraft lunch box' }),
                        item({ ordinal: 2, name: 'Sauce cup', overrides: { purchasePrice: null } }),
                        item({
                            ordinal: 3,
                            name: 'Paper straw',
                            overrides: { meta: meta({ status: 'draft' }) },
                        }),
                    ]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        // Unpriced is the figure this page exists to chase: a recipe's technical sheet withholds
        // its total while any one packaging line has no price.
        expect(screen.getByTestId('kitchen-packaging-stats-shown-value')).toHaveTextContent('3');
        expect(screen.getByTestId('kitchen-packaging-stats-unpriced-value')).toHaveTextContent('1');
        expect(screen.getByTestId('kitchen-packaging-stats-inactive-value')).toHaveTextContent('1');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-stats-inactive'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('kitchen-packaging-stats-shown-value')).toHaveTextContent(
                '1',
            );
        });
    });

    it('draws a sort arrow on every column that sorts, and a filter mark once one is applied', async () => {
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [
                        item({ ordinal: 1, name: 'Kraft lunch box' }),
                        item({
                            ordinal: 2,
                            name: 'Paper straw',
                            overrides: { meta: meta({ status: 'draft' }) },
                        }),
                    ]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        /*
         * `includeHiddenElements`, because every arrow is *supposed* to be hidden. None of them
         * repeats anything — the label says which column it is and the menu names both directions
         * in words — so they stay decorative and the accessibility tree drops them, which is also
         * why the default query does.
         */
        const hidden = { includeHiddenElements: true } as const;
        const glyph = (testID: string) => screen.getByTestId(testID, hidden).props.children;

        // The list opens sorted by reference, so that column carries the black arrow and every
        // other sortable column carries the grey one. A column with no menu carries neither, which
        // is what makes the mark worth anything.
        expect(
            screen.getByTestId('kitchen-packaging-column-reference-sorted', hidden),
        ).toBeTruthy();
        expect(screen.getByTestId('kitchen-packaging-column-name-affordance', hidden)).toBeTruthy();
        expect(
            screen.queryByTestId('kitchen-packaging-column-capacity-trigger', hidden),
        ).toBeNull();
        expect(
            screen.queryByTestId('kitchen-packaging-column-capacity-affordance', hidden),
        ).toBeNull();

        // Status filters but does not sort on this list, so its arrow is never the black one a
        // sorted column earns — and, until something is applied, it points up like every other
        // untouched head.
        expect(screen.queryByTestId('kitchen-packaging-column-status-sorted', hidden)).toBeNull();
        expect(glyph('kitchen-packaging-column-status-affordance')).toBe('↑');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-column-status-trigger'));
        });
        await untilVisible('kitchen-packaging-column-status-draft');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-column-status-draft'));
        });

        // The arrow turns over, which is what the list had no way of saying before. A shape, not a
        // shade — a filtered column a reader cannot see is a filter they cannot clear.
        await waitFor(() => {
            expect(glyph('kitchen-packaging-column-status-affordance')).toBe('↓');
        });

        // And the way out is inside the menu the mark points at, rather than somewhere the reader
        // has to remember: Clear appears only while there is something to clear, and takes the mark
        // with it.
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-column-status-trigger'));
        });
        await untilVisible('kitchen-packaging-column-status-clear');
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-column-status-clear'));
        });

        await waitFor(() => {
            expect(glyph('kitchen-packaging-column-status-affordance')).toBe('↑');
        });
    });

    it('offers every status a packaging row can hold, Archived aside', async () => {
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [item({ ordinal: 1 })]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        /*
         * Packaging shares the ingredient status vocabulary, and the segments now name three of its
         * four states; Archived stays out and is reachable from the Status column's own filter,
         * which is the call the ingredient list makes about `retired` too.
         *
         * Review used to be out as well, on the argument that the state is the *allergen
         * quarantine* — a record whose determination contradicts a published recipe — and a box
         * declares no allergens, so nothing could put one there. That reasoning was about how a row
         * *enters* the state, not about whether the field can hold it: it is a column on the same
         * ingredient table, and an import or a hand edit can set it. Offered by request. It costs
         * nothing when no row is in it, because the value simply matches none.
         */
        const segments = screen.getByTestId('kitchen-packaging-toolbar-status-segments');
        expect(segments).toHaveTextContent(/Published/);
        expect(segments).toHaveTextContent(/Draft/);
        expect(segments).toHaveTextContent(/Review/);
        expect(segments).not.toHaveTextContent(/Archived/);
    });

    it('archives a row at the version the list was showing, and says so', async () => {
        const row = item({ ordinal: 1, name: 'Kraft lunch box' });
        const archived = { ...row, meta: meta({ status: 'retired', lockVersion: 2 }) };

        const { repositories } = await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [row]),
                    listIngredientCategories: async () => CATEGORIES,
                    archiveIngredient: async () => archived,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-packaging-row-${String(row.id)}-archive`));
        });

        await untilVisible('kitchen-packaging-archive-dialog');

        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-archive-confirm'));
        });

        await untilVisible('kitchen-packaging-archived-toast');
        expect(repositories.kitchenAdmin.archiveIngredient).toHaveBeenCalledWith(row.id, {
            lockVersion: row.meta.lockVersion,
        });
    });

    it('offers no archive on a row the server would refuse it for', async () => {
        // A platform-library row this kitchen may read and not write. Offering Archive here earned
        // a 403 on every press, which is the failure this check exists to prevent.
        const platform = item({
            ordinal: 1,
            // `organisationId: null` *is* the platform library on the ingredient shape; the
            // packaging table carried a separate `isPlatform` flag saying the same thing twice.
            overrides: { isEditable: false, organisationId: null },
        });

        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [platform]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        const base = `kitchen-packaging-row-${String(platform.id)}`;
        expect(screen.getByTestId(`${base}-view`)).toBeTruthy();
        // Edit stays: the ingredient editor is what decides what a reader may change on a platform
        // row. Archive is the one the server would refuse, so it is the one that is not offered.
        expect(screen.getByTestId(`${base}-open`)).toBeTruthy();
        expect(screen.queryByTestId(`${base}-archive`)).toBeNull();
    });

    it('reads the whole record in the View panel, and edits it from the panel footer', async () => {
        const row = item({ ordinal: 1, name: 'Kraft lunch box' });

        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [row]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-packaging-row-${String(row.id)}-view`));
        });

        await untilVisible('kitchen-packaging-view-field-composition');
        // The material — the field a sustainability question is asked about, and the one the row
        // has no track for.
        expect(screen.getByTestId('kitchen-packaging-view-field-composition')).toHaveTextContent(
            /Kraft paper/,
        );
        // Edit routes to `/kitchen/packaging/{item}`, which exists now: the ingredient form
        // wearing this family's `PKG-` series, its category and its back-link.
        expect(routerMock.__push).not.toHaveBeenCalled();
        await act(async () => {
            fireEvent.press(screen.getByTestId('kitchen-packaging-view-edit'));
        });
        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchen/packaging/${String(row.id)}`);
    });

    it('opens the packaging editor from the row', async () => {
        const row = item({ ordinal: 1, name: 'Kraft lunch box' });

        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [row]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        await act(async () => {
            fireEvent.press(screen.getByTestId(`kitchen-packaging-row-${String(row.id)}-open`));
        });

        expect(routerMock.__push).toHaveBeenCalledWith(`/kitchen/packaging/${String(row.id)}`);
    });

    it('answers a search nothing matches with the filtered empty state', async () => {
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: packagingListing(() => [
                        item({ ordinal: 1, name: 'Kraft lunch box' }),
                        item({ ordinal: 2, name: 'Sauce cup' }),
                    ]),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });
        await untilVisible('kitchen-packaging-table');

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('kitchen-packaging-toolbar-search-input'),
                'nothing-like-this-exists',
            );
        });

        await untilVisible('kitchen-packaging-empty');
        expect(screen.getByTestId('kitchen-packaging-clear')).toBeTruthy();
    });

    it('renders the error state when the listing fails', async () => {
        await renderStubScreen(<PackagingScreen />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenAdmin: {
                    listIngredients: async () =>
                        throwFailure(apiFailure('server', { message: 'Boom.' })),
                    listIngredientCategories: async () => CATEGORIES,
                },
            },
        });

        await untilVisible('kitchen-packaging-error');
    });

    it('refuses a role with no catalogue permission', async () => {
        // No repository overrides at all: the gate refuses before the table can ask for anything, so
        // a screen that fetched here would fail loudly with StubNotConfiguredError.
        await renderStubScreen(<PackagingScreen />, { session: organisationOwnerSession() });

        await untilVisible('kitchen-packaging-forbidden');
        expect(screen.queryByTestId('kitchen-packaging-table')).toBeNull();
    });
});
