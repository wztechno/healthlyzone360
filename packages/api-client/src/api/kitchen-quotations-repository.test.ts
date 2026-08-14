import { QuotationId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiKitchenQuotationsRepository } from './kitchen-quotations-repository.ts';
import { createTransport } from './transport.ts';

interface Call {
    readonly method: string;
    readonly path: string;
    readonly headers: Headers;
    readonly body: string | null;
}

function harness(responses: readonly { status: number; body: unknown }[]) {
    const calls: Call[] = [];
    let index = 0;

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push({
                method: init?.method ?? 'GET',
                path: url.replace('https://api.example/api/v1', ''),
                headers: new Headers(init?.headers),
                body: typeof init?.body === 'string' ? init.body : null,
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

    return { repository: createApiKitchenQuotationsRepository(transport), calls };
}

const QUOTATION_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3001';
const BUYER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3101';
const PROGRAMME_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3201';
const LINE_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3301';
const ITEM_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3401';

function wireLine(overrides: Record<string, unknown> = {}) {
    return {
        id: LINE_UUID,
        line_number: 1,
        catalogue_item_id: ITEM_UUID,
        catalogue_item_variant_id: null,
        quantity: '12.0000',
        unit_amount_minor: null,
        line_total_minor: null,
        note: 'Thursday lunch, Al Quoz site',
        ...overrides,
    };
}

function wireQuotation(overrides: Record<string, unknown> = {}) {
    return {
        id: QUOTATION_UUID,
        organisation_id: BUYER_UUID,
        corporate_programme_id: PROGRAMME_UUID,
        reference: 'QT-2026-0007',
        status: 'submitted',
        currency_code: 'USD',
        notes: 'Weekly for the pilot floor.',
        decline_reason: null,
        submitted_at: '2026-08-10T09:00:00Z',
        quoted_at: null,
        expires_at: null,
        decided_at: null,
        lock_version: 2,
        lines: [],
        created_at: '2026-08-10T08:55:00Z',
        updated_at: '2026-08-10T09:00:00Z',
        ...overrides,
    };
}

describe('createApiKitchenQuotationsRepository — listQuotations', () => {
    it('unwraps the bare array from data and asks for no filters the endpoint does not take', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: [wireQuotation(), wireQuotation({ status: 'quoted' })],
                    meta: { count: 2 },
                },
            },
        ]);

        const quotations = await repository.listQuotations();

        expect(calls[0]?.method).toBe('GET');
        expect(calls[0]?.path).toBe('/b2b/kitchen/quotations');
        expect(quotations).toHaveLength(2);
        expect(quotations[0]?.reference).toBe('QT-2026-0007');
        expect(quotations[0]?.buyerOrganisationId).toBe(BUYER_UUID);
        expect(quotations[0]?.programmeId).toBe(PROGRAMME_UUID);
        expect(quotations[0]?.lockVersion).toBe(2);
    });

    it("carries the wire's empty line set through rather than inventing a count", async () => {
        const { repository } = harness([
            { status: 200, body: { data: [wireQuotation()], meta: { count: 1 } } },
        ]);

        expect((await repository.listQuotations())[0]?.lines).toEqual([]);
    });

    it('folds a status it does not recognise into submitted rather than dropping the row', async () => {
        const { repository } = harness([
            {
                status: 200,
                // `draft` cannot arrive — the endpoint filters it — and neither can a status this
                // build has never heard of. Both land on the open ask rather than vanishing.
                body: { data: [wireQuotation({ status: 'draft' })], meta: { count: 1 } },
            },
        ]);

        const quotations = await repository.listQuotations();

        expect(quotations).toHaveLength(1);
        expect(quotations[0]?.status).toBe('submitted');
    });
});

describe('createApiKitchenQuotationsRepository — getQuotation', () => {
    it('unwraps data.quotation and maps the line identifiers the write needs', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: { data: { quotation: wireQuotation({ lines: [wireLine()] }) }, meta: {} },
            },
        ]);

        const quotation = await repository.getQuotation(QuotationId.unsafe(QUOTATION_UUID));

        expect(calls[0]?.path).toBe(`/b2b/kitchen/quotations/${QUOTATION_UUID}`);
        expect(quotation.currencyCode).toBe('USD');
        expect(quotation.lines).toHaveLength(1);

        // The identifier `quote` prices against, which the buyer's own shape does not carry.
        expect(quotation.lines[0]?.id).toBe(LINE_UUID);
        expect(quotation.lines[0]?.lineNumber).toBe(1);
        expect(quotation.lines[0]?.catalogueItemId).toBe(ITEM_UUID);

        // The decimal string, never a float — the quantity an invoice is reconciled against.
        expect(quotation.lines[0]?.quantity).toBe('12.0000');

        // `null` is the statement that no price has been named. Never a zero.
        expect(quotation.lines[0]?.unitAmountMinor).toBeNull();
        expect(quotation.lines[0]?.lineTotalMinor).toBeNull();
    });

    it('falls back to USD rather than trusting an unrecognised currency code', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: { data: { quotation: wireQuotation({ currency_code: 'XYZ' }) }, meta: {} },
            },
        ]);

        expect(
            (await repository.getQuotation(QuotationId.unsafe(QUOTATION_UUID))).currencyCode,
        ).toBe('USD');
    });
});

describe('createApiKitchenQuotationsRepository — quoteQuotation', () => {
    it('sends every price in snake_case with the lock version as a quoted If-Match', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        quotation: wireQuotation({
                            status: 'quoted',
                            quoted_at: '2026-08-11T10:00:00Z',
                            expires_at: '2026-08-18T10:00:00Z',
                            lock_version: 3,
                            lines: [wireLine({ unit_amount_minor: 1800, line_total_minor: 21600 })],
                        }),
                    },
                    meta: {},
                },
            },
        ]);

        const quotation = await repository.quoteQuotation({
            id: QuotationId.unsafe(QUOTATION_UUID),
            lockVersion: 2,
            prices: [{ quotationLineId: LINE_UUID, unitAmountMinor: 1800 }],
        });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/b2b/kitchen/quotations/${QUOTATION_UUID}/quote`);
        expect(calls[0]?.headers.get('If-Match')).toBe('"2"');
        expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
            prices: [{ quotation_line_id: LINE_UUID, unit_amount_minor: 1800 }],
        });

        expect(quotation.status).toBe('quoted');
        expect(quotation.lockVersion).toBe(3);
        expect(quotation.lines[0]?.unitAmountMinor).toBe(1800);
        expect(quotation.lines[0]?.lineTotalMinor).toBe(21600);
    });

    it('surfaces a stale lock version as resource.conflict rather than retrying it', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'resource.conflict',
                        message: 'This quotation changed while you were working on it',
                    },
                },
            },
        ]);

        const caught = await repository
            .quoteQuotation({
                id: QuotationId.unsafe(QUOTATION_UUID),
                lockVersion: 1,
                prices: [{ quotationLineId: LINE_UUID, unitAmountMinor: 1800 }],
            })
            .catch((error: unknown) => error);

        expect(asApiFailure(caught)?.code).toBe('resource.conflict');
    });

    it('surfaces a buyer who already decided as b2b.quotation_state_invalid, not as a server error', async () => {
        const { repository } = harness([
            {
                status: 409,
                body: {
                    error: {
                        code: 'b2b.quotation_state_invalid',
                        message: 'A quotation that is accepted cannot become quoted.',
                        details: { status: 'accepted', requested_status: 'quoted' },
                    },
                },
            },
        ]);

        const caught = await repository
            .quoteQuotation({
                id: QuotationId.unsafe(QUOTATION_UUID),
                lockVersion: 2,
                prices: [{ quotationLineId: LINE_UUID, unitAmountMinor: 1800 }],
            })
            .catch((error: unknown) => error);

        expect(asApiFailure(caught)?.code).toBe('b2b.quotation_state_invalid');
    });
});
