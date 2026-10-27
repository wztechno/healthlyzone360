import type {
    AdminEntityMeta,
    IngredientAdmin,
    RecipeAdmin,
    RecipeLine,
    RecipeSheetBundle,
    RecipeVersionAdmin,
} from '@healthy360/api-client/contracts';
import type { DataListColumn } from '@healthy360/design-system';
import { Button } from '@healthy360/design-system';
import { IngredientId, KitchenId, RecipeId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Platform } from 'react-native';

import { TEST_ORGANISATION_ID, kitchenManagerSession } from '../../testing/session-fixtures.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import type { ListPrintJob } from './catalogue/list-print.ts';
import { TECHNICAL_SHEETS_MAX, listPrintJob, useListPrint } from './catalogue/list-print.ts';
import { ListPrintScreen } from './screens/list-print-screen.tsx';
import { RecipeSheetsPrintScreen } from './screens/recipe-sheets-print-screen.tsx';

/**
 * Export → PDF: the list print (`/kitchen/{resource}/print`) and the technical sheets
 * (`/kitchen/recipes/sheets?recipes=…`), against a world this file authors.
 *
 * The platform branch is asserted the way the supply-order print suite does it — exactly one of the
 * Print button and the native notice, according to `Platform.OS` — because mocking `Platform`
 * module-wide would take the browser cases with it.
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
            dismissTo: jest.fn(),
            prefetch: jest.fn(),
        }),
        usePathname: () => '/kitchen/ingredients/print',
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

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/* ------------------------------------------------------------------------------------------------
 * The list print
 * ---------------------------------------------------------------------------------------------- */

interface Row {
    readonly name: string;
    readonly unit: string;
    readonly code: string;
}

const ROWS: readonly Row[] = [
    { name: 'Burghul', unit: 'kg', code: 'ING-002' },
    { name: 'Parsley', unit: 'g', code: 'ING-010' },
    { name: 'Lemon', unit: 'piece', code: 'ING-001' },
];

const NAME: DataListColumn<Row> = {
    key: 'name',
    label: 'Name',
    width: 240,
    priority: 100,
    value: (row) => row.name,
};
const UNIT: DataListColumn<Row> = {
    key: 'unit',
    label: 'Unit',
    width: 80,
    priority: 50,
    value: (row) => row.unit,
};
/** Hidden from the list, but the list is sorted by it. */
const CODE: DataListColumn<Row> = {
    key: 'code',
    label: 'Code',
    width: 100,
    priority: 70,
    value: (row) => row.code,
};
const ACTIONS: DataListColumn<Row> = {
    key: 'actions',
    label: 'Actions',
    width: 48,
    priority: 95,
    sortable: false,
    render: () => null,
};

function ingredientsJob(): ListPrintJob {
    return listPrintJob<Row>({
        resource: 'ingredients',
        title: 'Ingredients',
        columns: [NAME, UNIT, ACTIONS],
        rows: ROWS,
        sort: { key: 'code', direction: 'desc', from: [NAME, UNIT, CODE, ACTIONS] },
    });
}

/** Starts a job on a press, as the list's Export menu does, then shows the print route in the same cache. */
function StartThenPrint({ job }: { readonly job: ListPrintJob }) {
    const { start } = useListPrint();
    const [started, setStarted] = useState(false);

    return started ? (
        <ListPrintScreen resource={job.resource} />
    ) : (
        <Button
            testID="probe-start"
            label="Start"
            onPress={() => {
                start(job);
                setStarted(true);
            }}
        />
    );
}

async function startPrint(job: ListPrintJob) {
    await renderStubScreen(<StartThenPrint job={job} />, { session: kitchenManagerSession() });
    await untilVisible('probe-start');
    fireEvent.press(screen.getByTestId('probe-start'));
    await untilVisible('kitchen-list-print-sheets');
}

describe('listPrintJob', () => {
    it('keeps the printable columns and orders the rows by a sort column that is not drawn', () => {
        const job = ingredientsJob();

        expect(job.columns).toEqual([
            { key: 'name', label: 'Name', width: 240 },
            { key: 'unit', label: 'Unit', width: 80 },
        ]);
        // ING-010, ING-002, ING-001 — descending by the hidden Code column.
        expect(job.rows).toEqual([
            ['Parsley', 'g'],
            ['Burghul', 'kg'],
            ['Lemon', 'piece'],
        ]);
        expect(Number.isNaN(Date.parse(job.printedAt))).toBe(false);
    });

    it('leaves the rows as given without a sort', () => {
        const job = listPrintJob<Row>({
            resource: 'stock',
            title: 'Stock',
            columns: [NAME],
            rows: ROWS,
        });

        expect(job.rows).toEqual([['Burghul'], ['Parsley'], ['Lemon']]);
    });
});

describe('list print screen', () => {
    it('says there is nothing to print when no list was sent, with the way back', async () => {
        await renderStubScreen(<ListPrintScreen resource="recipes" />, {
            session: kitchenManagerSession(),
        });

        await untilVisible('kitchen-list-print-expired');

        expect(screen.getByText('Nothing to print')).toBeTruthy();
        expect(screen.getByTestId('kitchen-list-print-back')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-list-print-sheets')).toBeNull();
        expect(screen.queryByTestId('kitchen-list-print-action')).toBeNull();
    });

    it('prints the list it was handed: headers, cells in sort order, the count', async () => {
        await startPrint(ingredientsJob());

        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/ingredients/print');

        const sheets = screen.getByTestId('kitchen-list-print-sheets');
        expect(within(sheets).getByText('Name')).toBeTruthy();
        expect(within(sheets).getByText('Unit')).toBeTruthy();
        // The actions column draws a control, not a value: it never reaches the paper.
        expect(screen.queryByTestId('kitchen-list-print-header-actions')).toBeNull();
        expect(within(sheets).queryByText('Actions')).toBeNull();
        // Sorted on a column that is not printed.
        expect(within(sheets).queryByText('Code')).toBeNull();

        const firstCells = [0, 1, 2].map((index) =>
            within(screen.getByTestId(`kitchen-list-print-row-${String(index)}`))
                .getAllByText(/./)
                .map((node) => String(node.props.children)),
        );
        expect(firstCells).toEqual([
            ['Parsley', 'g'],
            ['Burghul', 'kg'],
            ['Lemon', 'piece'],
        ]);

        expect(screen.getByTestId('kitchen-list-print-count').props.children).toBe('Rows: 3');
        expect(screen.getByTestId('kitchen-list-print-title').props.children).toBe('Ingredients');
    });

    it('renders exactly one of the print control and the native notice', async () => {
        await startPrint(ingredientsJob());

        const hasAction = screen.queryByTestId('kitchen-list-print-action') !== null;
        const hasNotice = screen.queryByTestId('kitchen-list-print-native-notice') !== null;

        expect(hasAction).toBe(Platform.OS === 'web');
        expect(hasNotice).toBe(!hasAction);
    });
});

/* ------------------------------------------------------------------------------------------------
 * The technical sheets
 * ---------------------------------------------------------------------------------------------- */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000c001');
const BURGHUL_ID = IngredientId.unsafe('01935f6d-0000-7000-8000-0000000a0001');

function recipeId(ordinal: number): RecipeId {
    return RecipeId.unsafe(`01935f6d-0000-7000-8000-0000000b${String(ordinal).padStart(4, '0')}`);
}

function meta(): AdminEntityMeta {
    return {
        lockVersion: 1,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
    };
}

const BURGHUL: IngredientAdmin = {
    id: BURGHUL_ID,
    meta: meta(),
    name: { en: 'Burghul', ar: 'برغل' },
    slug: 'ingredient-burghul',
    reference: null,
    subcategoryCode: null,
    categoryCode: 'store-cupboard',
    measurementUnit: 'g',
    purchaseUnit: null,
    composition: null,
    itemsPerUnit: null,
    gramsPerUnit: null,
    purchasePrice: null,
    wastePercent: null,
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
};

/** A line the editor created with no note: the mapper's name is blank, and nothing designates it. */
const NAMELESS_LINE: RecipeLine = {
    ingredientId: BURGHUL_ID,
    ingredientName: { en: '', ar: '' },
    quantity: 0.2,
    unit: 'kg',
    sourceDesignation: null,
    isOptional: false,
    lineCost: null,
};

const DESIGNATED_LINE: RecipeLine = { ...NAMELESS_LINE, sourceDesignation: 'Fine burghul' };

function recipe(ordinal: number, lines: readonly RecipeLine[] = [DESIGNATED_LINE]): RecipeAdmin {
    const id = recipeId(ordinal);
    const version: RecipeVersionAdmin = {
        id: `01935f6d-0000-7000-8000-0000000e${String(ordinal).padStart(4, '0')}` as RecipeVersionId,
        recipeId: id,
        versionNumber: 1,
        status: 'published',
        yieldQuantity: 4,
        yieldUnit: 'kg',
        yieldPieces: null,
        wastePercent: 3,
        packagingWastePercent: 0,
        b2bPrice: null,
        b2cPrice: null,
        lines,
        packaging: [],
        outputs: [],
        steps: [],
        allergens: [],
        estimatedCost: null,
        derivationStale: false,
        publishedAt: '2026-08-01T09:00:00.000Z',
    };

    return {
        id,
        meta: meta(),
        name: { en: `Recipe ${String(ordinal)}`, ar: `وصفة ${String(ordinal)}` },
        slug: `recipe-${String(ordinal)}`,
        reference: `RC-${String(ordinal).padStart(4, '0')}`,
        kitchenId: KITCHEN_ID,
        sourceKind: null,
        recipeCategory: null,
        currentVersionNumber: 1,
        versionCount: 1,
        currentVersionStatus: 'published',
        allergenCodes: [],
        lineCount: lines.length,
        description: { en: '', ar: '' },
        shelfLifeDays: null,
        currentVersion: version,
        versions: [
            {
                id: version.id,
                versionNumber: 1,
                status: 'published',
                publishedAt: version.publishedAt,
                updatedAt: '2026-08-01T09:00:00.000Z',
                isCurrent: true,
            },
        ],
    };
}

function sheetOverrides(
    bundles: readonly RecipeSheetBundle[],
    spy: jest.Mock = jest.fn(),
): RepositoryOverrides {
    return {
        kitchenAdmin: {
            listRecipeTechnicalSheets: async (ids: readonly RecipeId[]) => {
                spy(ids);
                const wanted = new Set(ids.map(String));
                return bundles.filter((bundle) => wanted.has(String(bundle.recipe.id)));
            },
            getIngredient: async (ingredientId: IngredientId) => {
                if (String(ingredientId) !== String(BURGHUL_ID)) {
                    throw new Error(`No ingredient ${String(ingredientId)}.`);
                }
                return BURGHUL;
            },
        },
    };
}

describe('technical sheets print', () => {
    it('reads the first twenty in one call, says it truncated, and names the one not returned', async () => {
        const spy = jest.fn();
        const ordinals = Array.from({ length: TECHNICAL_SHEETS_MAX + 1 }, (_, index) => index + 1);
        // Recipe 5 is asked for and never comes back.
        const bundles = ordinals
            .filter((ordinal) => ordinal !== 5)
            .map((ordinal) => ({ recipe: recipe(ordinal), sheet: null }));

        await renderStubScreen(
            <RecipeSheetsPrintScreen recipes={ordinals.map((n) => recipeId(n)).join(',')} />,
            { session: kitchenManagerSession(), repositories: sheetOverrides(bundles, spy) },
        );

        await untilVisible('kitchen-recipe-sheets-print-sheets');

        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(
            ordinals.slice(0, TECHNICAL_SHEETS_MAX).map((n) => recipeId(n)),
        );

        expect(screen.getByTestId('kitchen-recipe-sheets-print-truncated')).toBeTruthy();
        expect(
            within(screen.getByTestId('kitchen-recipe-sheets-print-missing')).getByText(
                new RegExp(String(recipeId(5))),
            ),
        ).toBeTruthy();

        // Nineteen sheets: twenty asked for, one missing — and the 21st never requested.
        const drawn = ordinals.filter(
            (n) =>
                screen.queryByTestId(`kitchen-recipe-sheets-print-sheet-${recipeId(n)}`) !== null,
        );
        expect(drawn).toEqual(ordinals.slice(0, TECHNICAL_SHEETS_MAX).filter((n) => n !== 5));
    });

    it('draws the panel without costs when the member may not see them', async () => {
        const record = recipe(1);

        await renderStubScreen(<RecipeSheetsPrintScreen recipes={String(record.id)} />, {
            session: kitchenManagerSession(),
            repositories: sheetOverrides([{ recipe: record, sheet: null }]),
        });

        const panel = `kitchen-recipe-sheets-print-panel-${String(record.id)}`;
        await untilVisible(panel);

        expect(screen.getByTestId(`${panel}-cost-hidden`)).toBeTruthy();
        expect(screen.queryByTestId(`${panel}-cost`)).toBeNull();
        expect(within(screen.getByTestId(panel)).queryByText('U.P.')).toBeNull();
        expect(within(screen.getByTestId(panel)).getByText('Fine burghul')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-recipe-sheets-print-missing')).toBeNull();
        expect(screen.queryByTestId('kitchen-recipe-sheets-print-truncated')).toBeNull();
    });

    it('names a line from its ingredient when the line carries no designation', async () => {
        const record = recipe(2, [NAMELESS_LINE]);

        const harness = await renderStubScreen(
            <RecipeSheetsPrintScreen recipes={String(record.id)} />,
            {
                session: kitchenManagerSession(),
                repositories: sheetOverrides([{ recipe: record, sheet: null }]),
            },
        );

        const panel = `kitchen-recipe-sheets-print-panel-${String(record.id)}`;
        await untilVisible(panel);

        await waitFor(
            () => {
                expect(within(screen.getByTestId(panel)).getByText('Burghul')).toBeTruthy();
            },
            { timeout: 20_000 },
        );
        expect(harness.repositories.kitchenAdmin.getIngredient).toHaveBeenCalledWith(BURGHUL_ID);
    });

    it('asks for nothing when the link names no recipe', async () => {
        const spy = jest.fn();

        await renderStubScreen(<RecipeSheetsPrintScreen recipes="not-an-id, ," />, {
            session: kitchenManagerSession(),
            repositories: sheetOverrides([], spy),
        });

        await untilVisible('kitchen-recipe-sheets-print-nothing');
        expect(spy).not.toHaveBeenCalled();
    });
});
