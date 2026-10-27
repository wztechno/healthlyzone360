import { BranchId, OrganisationId } from '@healthy360/domain-types';
import { describe, expect, it } from 'vitest';

import { ApiError } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createTransport, filenameFromDisposition } from './transport.ts';

/**
 * The transport against a recorded `fetch`: what headers a download carries, what it answers with,
 * and that a refused download is the same `ApiError` a refused JSON read is.
 */

function harness(respond: () => Response) {
    const sent: Array<Readonly<Record<string, string>>> = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (_input, init) => {
            const headers: Record<string, string> = {};
            new Headers(init?.headers).forEach((value, key) => {
                headers[key] = value;
            });
            sent.push(headers);
            return respond();
        },
    });

    return { transport, sent };
}

function workbook(disposition?: string): Response {
    return new Response(new Blob(['PK-bytes']), {
        status: 200,
        headers: disposition === undefined ? {} : { 'Content-Disposition': disposition },
    });
}

function envelope(status: number, error: unknown, headers: Record<string, string> = {}) {
    return () => new Response(JSON.stringify({ error }), { status, headers });
}

async function caught(promise: Promise<unknown>): Promise<ApiError> {
    try {
        await promise;
    } catch (error) {
        if (error instanceof ApiError) return error;
        throw error;
    }
    throw new Error('expected the request to reject');
}

describe('requestFile', () => {
    it('answers the bytes and the RFC 5987 file name', async () => {
        const { transport } = harness(() =>
            workbook(
                `attachment; filename="fallback.xlsx"; filename*=UTF-8''%D9%85%D8%B7%D8%A8%D8%AE.xlsx`,
            ),
        );

        const file = await transport.requestFile({ method: 'GET', path: '/x/export' });

        expect(await file.blob.text()).toBe('PK-bytes');
        expect(file.filename).toBe('مطبخ.xlsx');
    });

    it('reads a quoted filename', async () => {
        const { transport } = harness(() =>
            workbook('attachment; filename="ingredients 2026-10-26.xlsx"'),
        );

        const file = await transport.requestFile({ method: 'GET', path: '/x/export' });

        expect(file.filename).toBe('ingredients 2026-10-26.xlsx');
    });

    it('reads a bare filename', async () => {
        const { transport } = harness(() => workbook('attachment; filename=recipes.xlsx'));

        const file = await transport.requestFile({ method: 'GET', path: '/x/export' });

        expect(file.filename).toBe('recipes.xlsx');
    });

    it('answers a null name when the header is absent', async () => {
        const { transport } = harness(() => workbook());

        const file = await transport.requestFile({ method: 'GET', path: '/x/export' });

        expect(file.filename).toBeNull();
    });

    it('sends the bearer token and the active context', async () => {
        const { transport, sent } = harness(() => workbook());
        transport.context.set(
            OrganisationId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900'),
            BranchId.unsafe('0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3901'),
        );

        await transport.requestFile({ method: 'GET', path: '/x/export' });

        expect(sent[0]).toMatchObject({
            authorization: 'Bearer token',
            'x-organisation-id': '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3900',
            'x-branch-id': '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3901',
        });
    });

    it('throws validation.failed with its fields from a refused download', async () => {
        const { transport } = harness(
            envelope(422, {
                code: 'validation.failed',
                message: 'The file is invalid.',
                details: { fields: { file: ['The file must be a workbook.'] } },
            }),
        );

        const error = await caught(transport.requestFile({ method: 'GET', path: '/x/export' }));

        expect(error.failure).toMatchObject({
            code: 'validation.failed',
            fields: { file: ['The file must be a workbook.'] },
        });
    });

    it('throws rate_limit.exceeded with the Retry-After seconds', async () => {
        const { transport } = harness(
            envelope(
                429,
                { code: 'rate_limit.exceeded', message: 'Too many requests.' },
                { 'Retry-After': '17' },
            ),
        );

        const error = await caught(transport.requestFile({ method: 'GET', path: '/x/export' }));

        expect(error.failure).toMatchObject({
            code: 'rate_limit.exceeded',
            retryAfterSeconds: 17,
        });
    });
});

describe('complete, after the failure branch moved out', () => {
    it('resolves a 204 as void', async () => {
        const { transport } = harness(() => new Response(null, { status: 204 }));

        await expect(transport.requestVoid({ method: 'DELETE', path: '/x' })).resolves.toBe(
            undefined,
        );
    });

    it('still throws the mapped ApiError', async () => {
        const { transport } = harness(
            envelope(404, { code: 'resource.not_found', message: 'Gone.' }),
        );

        const error = await caught(transport.request({ method: 'GET', path: '/x' }));

        expect(error.code).toBe('resource.not_found');
    });
});

describe('filenameFromDisposition', () => {
    it('unescapes a quoted name and ignores a malformed extended one', () => {
        expect(filenameFromDisposition('attachment; filename="a \\"b\\".xlsx"')).toBe('a "b".xlsx');
        expect(
            filenameFromDisposition(`attachment; filename*=UTF-8''%E0%A4%A; filename="safe.xlsx"`),
        ).toBe('safe.xlsx');
        expect(filenameFromDisposition('attachment')).toBeNull();
        expect(filenameFromDisposition(null)).toBeNull();
    });
});
