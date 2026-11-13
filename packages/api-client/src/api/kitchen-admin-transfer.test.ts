import { AllergenCode, RecipeId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../contracts/failure.ts';
import type {
    IngredientAdminFilter,
    RecipeAdminFilter,
    TransferResource,
} from '../contracts/kitchen-admin.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createApiKitchenAdminWrites } from './kitchen-admin-writes.ts';
import { createTransport } from './transport.ts';

/**
 * Spreadsheet transfer against a recorded transport. The guard here is the first block: an export
 * must ask for exactly the set its list shows, so both are driven with one filter and their query
 * strings compared — a filter added to the list and forgotten on the export fails it.
 */

interface Call {
    readonly method: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly body: BodyInit | null | undefined;
}

const PAGING_KEYS = ['limit', 'cursor', 'page', 'per_page'];

const CATEGORIES = [
    { id: 'cat-leafy', code: 'leafy', parent_id: null },
    { id: 'cat-packaging', code: 'packaging', parent_id: null },
];

const EMPTY_PAGE = { data: [], meta: { next_cursor: null, has_more: false } };

function harness(answer: (path: string) => unknown = () => EMPTY_PAGE) {
    const calls: Call[] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const relative = url.replace('https://api.example/api/v1', '');
            const [path = '', query = ''] = relative.split('?');

            if (path === '/catalogue/ingredient-categories') {
                return Response.json({ data: CATEGORIES, meta: {} });
            }
            if (path === '/catalogue/procurement/reference') {
                return Response.json({
                    data: { measurement_units: [{ id: 'unit-g', code: 'g' }] },
                    meta: {},
                });
            }

            calls.push({
                method: init?.method ?? 'GET',
                path,
                query: new URLSearchParams(query),
                body: init?.body,
            });

            if (path.endsWith('/export') || path.endsWith('/import-template')) {
                return new Response(new Blob(['PK']), {
                    status: 200,
                    headers: { 'Content-Disposition': 'attachment; filename="book.xlsx"' },
                });
            }
            return Response.json(answer(path));
        },
    });

    return {
        reads: createApiKitchenAdminReads(transport),
        writes: createApiKitchenAdminWrites(transport),
        calls,
    };
}

function withoutPaging(query: URLSearchParams): string {
    const copy = new URLSearchParams(query);
    for (const key of PAGING_KEYS) copy.delete(key);
    return copy.toString();
}

describe('an export asks for what its list shows', () => {
    it('ingredients: the same query, minus paging', async () => {
        const filter: IngredientAdminFilter = {
            query: ' kale ',
            statuses: ['published'],
            categoryCode: 'leafy',
            excludeCategoryCode: 'packaging',
            allergenCodes: [AllergenCode.unsafe('milk')],
            referenceSeries: 'ING-',
            sort: 'name',
            sortDirection: 'desc',
            sortLanguage: 'ar',
            limit: 25,
            cursor: 'next-1',
            page: 2,
            perPage: 50,
        };
        const { reads, calls } = harness();

        await reads.listIngredients(filter);
        await reads.exportIngredients(filter);

        const [list, exported] = calls;
        expect(list?.path).toBe('/catalogue/ingredients');
        expect(exported?.path).toBe('/catalogue/ingredients/export');
        expect(list?.query.get('page')).toBe('2');
        for (const key of PAGING_KEYS) expect(exported?.query.has(key)).toBe(false);
        expect(exported?.query.toString()).toBe(withoutPaging(list!.query));
        expect(exported?.query.get('category')).toBe('cat-leafy');
        expect(exported?.query.get('exclude_category')).toBe('cat-packaging');
        expect(exported?.query.get('allergen')).toBe('milk');
        expect(exported?.query.get('sort')).toBe('name_ar');
    });

    it('recipes: the same query, minus paging', async () => {
        const filter: RecipeAdminFilter = {
            query: 'bowl',
            statuses: ['draft'],
            staleOnly: true,
            allergenCodes: [AllergenCode.unsafe('sesame')],
            kind: 'sauce',
            sellingStatus: 'published',
            category: 'mains',
            limit: 20,
            cursor: 'c-1',
            page: 3,
            perPage: 10,
        };
        const { reads, calls } = harness();

        await reads.listRecipes(filter);
        await reads.exportRecipes(filter);

        const [list, exported] = calls;
        expect(list?.path).toBe('/catalogue/recipes');
        expect(exported?.path).toBe('/catalogue/recipes/export');
        for (const key of PAGING_KEYS) expect(exported?.query.has(key)).toBe(false);
        expect(exported?.query.toString()).toBe(withoutPaging(list!.query));
        expect(exported?.query.get('kind')).toBe('sauce');
        expect(exported?.query.get('stale_only')).toBe('1');
    });

    it('answers the downloaded workbook and its name', async () => {
        const { reads } = harness();

        const file = await reads.exportIngredients();

        expect(file.filename).toBe('book.xlsx');
        expect(await file.blob.text()).toBe('PK');
    });

    it('refuses an unresolvable category rather than exporting everything', async () => {
        const { reads, calls } = harness();

        const failure = await reads.exportIngredients({ categoryCode: 'retired' }).then(
            () => null,
            (error: unknown) => error,
        );

        expect(failure).toBeInstanceOf(ApiError);
        expect((failure as ApiError).code).toBe('resource.not_found');
        expect(calls).toHaveLength(0);
    });
});

describe('the other downloads', () => {
    it('reads the stock book off the levels export', async () => {
        const { reads, calls } = harness();

        await reads.exportStock();

        expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
            'GET /catalogue/inventory/levels/export',
        ]);
    });

    it.each<[TransferResource, string]>([
        ['ingredients', '/catalogue/ingredients/import-template'],
        ['recipes', '/catalogue/recipes/import-template'],
        ['stock', '/catalogue/inventory/counts/import-template'],
    ])('fetches the %s template from %s', async (resource, path) => {
        const { reads, calls } = harness();

        await reads.downloadImportTemplate(resource);

        expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([`GET ${path}`]);
    });
});

describe('importRecords', () => {
    const REPORT = {
        created: 1,
        updated: 2,
        unchanged: 300,
        skipped: 0,
        failed: 1,
        ignored_columns: ['Notes'],
        rows: [
            { row: 4, outcome: 'failed', reference: 'ING-0004', message: 'Unit not recognised.' },
            { row: 5, outcome: 'created' },
        ],
    };

    it.each<[TransferResource, string]>([
        ['ingredients', '/catalogue/ingredients/imports'],
        ['recipes', '/catalogue/recipes/imports'],
        ['stock', '/catalogue/inventory/counts/imports'],
    ])('posts the %s workbook as multipart to %s', async (resource, path) => {
        const { writes, calls } = harness(() => ({ data: REPORT, meta: {} }));
        const file = new Blob(['PK'], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });

        const report = await writes.importRecords(resource, { file, fileName: 'book.xlsx' });

        expect(calls).toHaveLength(1);
        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(path);
        const form = calls[0]?.body;
        expect(form).toBeInstanceOf(FormData);
        const sent = (form as FormData).get('file');
        expect(sent).toBeInstanceOf(Blob);
        expect((sent as File).name).toBe('book.xlsx');

        expect(report).toEqual({
            created: 1,
            updated: 2,
            unchanged: 300,
            skipped: 0,
            failed: 1,
            ignoredColumns: ['Notes'],
            rows: [
                {
                    row: 4,
                    outcome: 'failed',
                    reference: 'ING-0004',
                    message: 'Unit not recognised.',
                },
                { row: 5, outcome: 'created', reference: null, message: null },
            ],
        });
    });

    it('reads an absent ignored_columns as none', async () => {
        const { ignored_columns: _dropped, ...withoutColumns } = REPORT;
        const { writes } = harness(() => ({ data: withoutColumns, meta: {} }));

        const report = await writes.importRecords('stock', {
            file: new Blob(['PK']),
            fileName: 'count.xlsx',
        });

        expect(report.ignoredColumns).toEqual([]);
    });
});

describe('listRecipeTechnicalSheets', () => {
    const RECIPE_A = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3001';
    const RECIPE_B = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3002';
    const INGREDIENT = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3500';

    function wireRecipe(id: string) {
        return {
            id,
            organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900',
            slug: `recipe-${id.slice(-4)}`,
            name_en: 'Freekeh bowl',
            name_ar: 'Freekeh bowl',
            confidentiality: 'confidential',
            status: 'active',
            published_version_number: 1,
            current_version_status: 'published',
            current_version_allergen_codes: [],
            current_version_line_count: 1,
            lock_version: 4,
        };
    }

    function wireVersion(recipeId: string) {
        return {
            id: `${recipeId.slice(0, -4)}31${recipeId.slice(-2)}`,
            recipe_id: recipeId,
            version_number: 1,
            status: 'published',
            completeness: 'indicative',
            waste_coefficient_percent: '3.00',
            packaging_waste_percent: '0.00',
            derivation_state: 'current',
            lock_version: 0,
        };
    }

    const costBlock = {
        total_input_cost_amount: '4.20',
        cost_per_yield_unit_amount: null,
        cost_per_yield_unit_with_waste_amount: null,
        cost_per_piece_amount: null,
        cost_per_piece_with_waste_amount: null,
        waste_percent: '3.00',
        uncosted_line_numbers: [],
        is_complete: true,
        lines: [],
    };

    function wireSheet(recipeId: string) {
        return {
            version: wireVersion(recipeId),
            currency_code: 'SAR',
            currency_conflict: false,
            lines: [],
            uncosted_line_numbers: [],
            snapshots: { as_recorded: null, recalculated: null },
            computed: null,
            weekly: {
                currency_code: 'SAR',
                production: costBlock,
                packaging: {
                    total_packaging_cost_amount: null,
                    cost_per_yield_unit_amount: null,
                    cost_per_yield_unit_with_waste_amount: null,
                    waste_percent: '0.00',
                    uncosted_line_numbers: [],
                    is_complete: true,
                    lines: [],
                },
                total_cost_per_yield_unit_amount: null,
                weekly_price_publication_id: null,
                has_carried_forward_prices: false,
                ingredients_needing_initial_price: [],
                line_sources: [],
            },
        };
    }

    function entry(recipeId: string, withSheet: boolean) {
        return {
            recipe: wireRecipe(recipeId),
            versions: [wireVersion(recipeId)],
            current: {
                version: wireVersion(recipeId),
                lines: [
                    {
                        id: `${recipeId.slice(0, -4)}41${recipeId.slice(-2)}`,
                        line_number: 1,
                        ingredient_id: INGREDIENT,
                        quantity: '120.0000',
                        unit_id: 'unit-g',
                        source_designation: 'kale, raw',
                        ingredient_name_en: 'Kale',
                        ingredient_name_ar: 'كرنب',
                    },
                ],
                packaging: [],
                outputs: [],
                steps: [],
                allergens: [],
            },
            sheet: withSheet ? wireSheet(recipeId) : null,
        };
    }

    it('reads every recipe in one request and names lines from the batch', async () => {
        const { reads, calls } = harness(() => ({
            data: { sheets: [entry(RECIPE_A, true), entry(RECIPE_B, false)] },
            meta: {},
        }));

        const bundles = await reads.listRecipeTechnicalSheets([
            RecipeId.unsafe(RECIPE_A),
            RecipeId.unsafe(RECIPE_B),
        ]);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.path).toBe('/catalogue/recipes/technical-sheets');
        expect(calls[0]?.query.getAll('ids[]')).toEqual([RECIPE_A, RECIPE_B]);

        expect(bundles).toHaveLength(2);
        expect(String(bundles[0]?.recipe.id)).toBe(RECIPE_A);
        expect(bundles[0]?.recipe.currentVersion.lines[0]?.ingredientName).toEqual({
            en: 'Kale',
            ar: 'كرنب',
        });
        expect(String(bundles[0]?.sheet?.versionId)).toBe(wireVersion(RECIPE_A).id);
        expect(bundles[0]?.sheet?.currency).toBe('SAR');
        expect(bundles[1]?.sheet).toBeNull();
    });

    it('makes no request for no recipes', async () => {
        const { reads, calls } = harness();

        await expect(reads.listRecipeTechnicalSheets([])).resolves.toEqual([]);
        expect(calls).toHaveLength(0);
    });
});
