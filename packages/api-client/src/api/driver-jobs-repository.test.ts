import { describe, expect, it } from 'vitest';

import { asApiFailure } from '../contracts/failure.ts';
import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiDriverJobsRepository } from './driver-jobs-repository.ts';
import { createTransport } from './transport.ts';

interface Call {
    readonly method: string;
    readonly path: string;
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

    return { repository: createApiDriverJobsRepository(transport), calls };
}

const JOB_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3001';
const OTHER_JOB_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3002';
const ORDER_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e3101';

function wireJob(overrides: Record<string, unknown> = {}) {
    return {
        id: JOB_UUID,
        order_id: ORDER_UUID,
        status: 'assigned',
        tracking_status: 'awaiting_assignment',
        ...overrides,
    };
}

describe('createApiDriverJobsRepository — listJobs', () => {
    it('unwraps data.jobs and maps both status axes', async () => {
        const { repository, calls } = harness([
            {
                status: 200,
                body: {
                    data: {
                        jobs: [
                            wireJob(),
                            wireJob({
                                id: OTHER_JOB_UUID,
                                status: 'in_transit',
                                tracking_status: 'en_route',
                            }),
                        ],
                    },
                    meta: {},
                },
            },
        ]);

        const jobs = await repository.listJobs();

        expect(calls[0]?.method).toBe('GET');
        // No parameters at all: the run sheet is narrowed by who is asking, not by what they ask.
        expect(calls[0]?.path).toBe('/driver/jobs');
        expect(jobs).toHaveLength(2);
        expect(jobs[0]?.id).toBe(JOB_UUID);
        expect(jobs[0]?.orderId).toBe(ORDER_UUID);
        // Two axes, not one: dispatch state and the customer-facing message are separate facts.
        expect(jobs[0]?.status).toBe('assigned');
        expect(jobs[0]?.trackingStatus).toBe('awaiting_assignment');
        expect(jobs[1]?.status).toBe('in_transit');
        expect(jobs[1]?.trackingStatus).toBe('en_route');
    });

    it('answers an empty run sheet as an empty array, not as a failure', async () => {
        const { repository } = harness([{ status: 200, body: { data: { jobs: [] }, meta: {} } }]);

        expect(await repository.listJobs()).toEqual([]);
    });
});

describe('createApiDriverJobsRepository — deliverJob', () => {
    it('posts the notes the driver typed, trimmed', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { job: { id: JOB_UUID, status: 'delivered' } } } },
        ]);

        await repository.deliverJob(JOB_UUID, { notes: '  Left with the concierge  ' });

        expect(calls[0]?.method).toBe('POST');
        expect(calls[0]?.path).toBe(`/driver/jobs/${JOB_UUID}/deliver`);
        expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({
            proof_of_delivery_notes: 'Left with the concierge',
        });
    });

    it('always sends the key, as null, when nothing was typed — the field is replace-or-clear', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { job: { id: JOB_UUID, status: 'delivered' } } } },
            { status: 200, body: { data: { job: { id: JOB_UUID, status: 'delivered' } } } },
        ]);

        await repository.deliverJob(JOB_UUID);
        await repository.deliverJob(JOB_UUID, { notes: '   ' });

        expect(JSON.parse(calls[0]?.body ?? 'null')).toEqual({ proof_of_delivery_notes: null });
        // Whitespace is nothing typed, not a note made of spaces.
        expect(JSON.parse(calls[1]?.body ?? 'null')).toEqual({ proof_of_delivery_notes: null });
    });

    it('carries no If-Match: a delivery job has no lock version and delivering is a stamp', async () => {
        const { repository, calls } = harness([
            { status: 200, body: { data: { job: { id: JOB_UUID, status: 'delivered' } } } },
        ]);

        await repository.deliverJob(JOB_UUID);

        expect(calls[0]?.body).not.toContain('lock_version');
    });

    it("passes another driver's job through as not-found rather than translating it", async () => {
        const { repository } = harness([
            {
                status: 404,
                body: {
                    error: {
                        code: 'resource.not_found',
                        message: 'No such delivery job.',
                        details: {},
                        correlation_id: 'c-404',
                    },
                },
            },
        ]);

        // The endpoint declines to confirm that somebody else's job exists; saying "not yours"
        // here would leak exactly what the server withheld.
        await expect(repository.deliverJob(OTHER_JOB_UUID)).rejects.toSatisfy(
            (caught: unknown) => asApiFailure(caught)?.code === 'resource.not_found',
        );
    });
});
