import { RecipeId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenAdminWrites } from './kitchen-admin-writes.ts';
import { createTransport } from './transport.ts';

/**
 * Kitchen catalogue writes against a recorded transport: what went onto the wire, and what the
 * write answered with. A screen test stubs the repository and cannot see either — which is how the
 * recipe editor's "New draft" shipped sending no request at all.
 */

interface Call {
    readonly method: string;
    readonly path: string;
    readonly body: Record<string, unknown> | null;
    readonly headers: Readonly<Record<string, string>>;
}

function harness(responses: readonly { status: number; body: unknown }[]) {
    const calls: Call[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const headers: Record<string, string> = {};
            new Headers(init?.headers).forEach((value, key) => {
                headers[key] = value;
            });

            calls.push({
                method: init?.method ?? 'GET',
                path: decodeURIComponent(url.replace('https://api.example/api/v1', '')),
                body:
                    typeof init?.body === 'string'
                        ? (JSON.parse(init.body) as Record<string, unknown>)
                        : null,
                headers,
            });

            const next = responses[index++];
            if (next === undefined) {
                return new Response(JSON.stringify({ error: { code: 'request.invalid' } }), {
                    status: 500,
                });
            }
            return new Response(JSON.stringify(next.body), { status: next.status });
        },
    });

    return { writes: createApiKitchenAdminWrites(transport), calls };
}

const RECIPE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3001';
const RECIPE_ID = RecipeId.unsafe(RECIPE_UUID);

function wireVersion(versionNumber: number, status: 'draft' | 'published') {
    return {
        id: `0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e310${String(versionNumber)}`,
        recipe_id: RECIPE_UUID,
        version_number: versionNumber,
        status,
        completeness: 'indicative',
        waste_coefficient_percent: '3.00',
        packaging_waste_percent: '0.00',
        derivation_state: 'stale',
        lock_version: 0,
    };
}

const WIRE_RECIPE = {
    id: RECIPE_UUID,
    organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900',
    slug: 'freekeh-bowl',
    name_en: 'Freekeh bowl',
    name_ar: 'Freekeh bowl',
    confidentiality: 'confidential',
    status: 'active',
    published_version_number: 1,
    current_version_status: 'draft',
    current_version_allergen_codes: [],
    current_version_line_count: 0,
    lock_version: 4,
};

describe('createRecipeVersion', () => {
    it('posts the successor as a copy, without If-Match, and answers with it as current', async () => {
        const { writes, calls } = harness([
            { status: 201, body: { data: { version: wireVersion(2, 'draft') } } },
            {
                status: 200,
                body: {
                    data: {
                        recipe: WIRE_RECIPE,
                        versions: [wireVersion(1, 'published'), wireVersion(2, 'draft')],
                    },
                },
            },
            {
                status: 200,
                body: {
                    data: {
                        version: wireVersion(2, 'draft'),
                        lines: [],
                        packaging: [],
                        outputs: [],
                        steps: [],
                        allergens: [],
                    },
                },
            },
            // The unit lookup that follows answers 500 and falls back to no units.
        ]);

        const recipe = await writes.createRecipeVersion(RECIPE_ID, 1);

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/catalogue/recipes/${RECIPE_UUID}/versions`);
        expect(calls[0]?.body).toEqual({ copy_from_version: 1 });
        // Nothing existing is written, so there is no version to be stale against.
        expect(calls[0]?.headers['if-match']).toBeUndefined();

        expect(recipe.currentVersion.versionNumber).toBe(2);
        expect(recipe.currentVersion.status).toBe('draft');
    });
});
