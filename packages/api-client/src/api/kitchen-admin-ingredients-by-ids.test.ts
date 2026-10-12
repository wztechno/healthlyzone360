import { IngredientId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminReads } from './kitchen-admin-repository.ts';
import { createTransport } from './transport.ts';

/** `getIngredientsByIds` against a transport answered by URL: one request per 100 ids. */

interface Reply {
    readonly status: number;
    readonly body: unknown;
}

const CATEGORIES = '/catalogue/ingredient-categories';

function uuid(n: number): string {
    return `0198c5f2-7d3a-7b1e-9c4d-${n.toString(16).padStart(12, '0')}`;
}

function wireIngredient(id: string) {
    return {
        id,
        name_en: `Ingredient ${id.slice(-4)}`,
        name_ar: `Ingredient ${id.slice(-4)}`,
        slug: `ingredient-${id.slice(-4)}`,
        status: 'archived',
        is_platform: false,
        allergens: [],
        diet_classifications: [],
        ingredient_category_id: null,
        default_unit_code: 'kg',
        organisation_id: 'org-1',
        notes: null,
        lock_version: 3,
    };
}

function alias(value: string) {
    return {
        id: `alias-${value}`,
        alias: value,
        alias_normalised: value.toLowerCase(),
        locale: 'en',
        source_system: null,
        source_ref: null,
    };
}

function harness(route: (url: URL) => Reply) {
    const urls: URL[] = [];
    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input) => {
            const url = new URL(input instanceof Request ? input.url : String(input));
            const path = url.pathname.replace('/api/v1', '');
            if (path === CATEGORIES) {
                return new Response(JSON.stringify({ data: [] }), { status: 200 });
            }
            urls.push(url);
            const { status, body } = route(url);
            return new Response(JSON.stringify(body), { status });
        },
    });
    return { reads: createApiKitchenAdminReads(transport), urls };
}

/** Answers every ids lookup with the rows it names, minus `hidden`. */
function echo(hidden: ReadonlySet<string> = new Set()) {
    return (url: URL): Reply => ({
        status: 200,
        body: {
            data: url.searchParams
                .getAll('ids[]')
                .filter((id) => !hidden.has(id))
                .map((id) => ({ ...wireIngredient(id), aliases: [] })),
            meta: { next_cursor: null, has_more: false },
        },
    });
}

describe('getIngredientsByIds', () => {
    it('resolves three ids in one request, with limit covering them', async () => {
        const { reads, urls } = harness(echo());
        const ids = [1, 2, 3].map((n) => IngredientId.unsafe(uuid(n)));

        const rows = await reads.getIngredientsByIds(ids);

        expect(urls).toHaveLength(1);
        expect(urls[0]!.pathname).toBe('/api/v1/catalogue/ingredients');
        expect(urls[0]!.searchParams.getAll('ids[]')).toEqual(ids.map(String));
        expect(urls[0]!.searchParams.get('limit')).toBe('3');
        expect(rows.map((row) => String(row.id))).toEqual(ids.map(String));
    });

    it('splits 150 ids into two requests of at most 100', async () => {
        const { reads, urls } = harness(echo());
        const ids = Array.from({ length: 150 }, (_, n) => IngredientId.unsafe(uuid(n + 1)));

        const rows = await reads.getIngredientsByIds(ids);

        expect(urls.map((url) => url.searchParams.getAll('ids[]').length)).toEqual([100, 50]);
        expect(urls.map((url) => url.searchParams.get('limit'))).toEqual(['100', '50']);
        expect(rows).toHaveLength(150);
    });

    it('collapses duplicates before sending, and sends nothing for no ids', async () => {
        const { reads, urls } = harness(echo());
        const a = IngredientId.unsafe(uuid(1));
        const b = IngredientId.unsafe(uuid(2));

        await reads.getIngredientsByIds([a, b, a, b, a]);
        expect(urls[0]!.searchParams.getAll('ids[]')).toEqual([String(a), String(b)]);

        expect(await reads.getIngredientsByIds([])).toEqual([]);
        expect(urls).toHaveLength(1);
    });

    it('returns only the rows the server answered with', async () => {
        const hidden = uuid(2);
        const { reads } = harness(echo(new Set([hidden])));

        const rows = await reads.getIngredientsByIds(
            [1, 2, 3].map((n) => IngredientId.unsafe(uuid(n))),
        );

        expect(rows.map((row) => String(row.id))).toEqual([uuid(1), uuid(3)]);
    });

    it('maps a row exactly as getIngredient maps the show endpoint', async () => {
        const id = uuid(7);
        const aliases = [alias('Burghul'), alias('Bulgur')];
        const { reads } = harness((url) =>
            url.pathname.endsWith(`/ingredients/${id}`)
                ? { status: 200, body: { data: { ingredient: wireIngredient(id), aliases } } }
                : {
                      status: 200,
                      body: {
                          data: [{ ...wireIngredient(id), aliases }],
                          meta: { next_cursor: null, has_more: false },
                      },
                  },
        );

        const [batched] = await reads.getIngredientsByIds([IngredientId.unsafe(id)]);
        const shown = await reads.getIngredient(IngredientId.unsafe(id));

        expect(batched).toEqual(shown);
        expect(batched!.aliases).toEqual(['Burghul', 'Bulgur']);
    });

    it.each([
        [422, 'request.invalid'],
        [403, 'authz.permission_denied'],
        [500, 'server.error'],
    ])('propagates a %i', async (status, code) => {
        const { reads } = harness(() => ({
            status,
            body: { error: { code, message: 'No.', correlation_id: 'c' } },
        }));

        await expect(
            reads.getIngredientsByIds([IngredientId.unsafe(uuid(1))]),
        ).rejects.toBeInstanceOf(ApiError);
    });
});
