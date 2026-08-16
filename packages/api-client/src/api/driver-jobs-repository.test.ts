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

/** Every address part authored, so a mapper that dropped one would show as a missing field. */
function wireDelivery(overrides: Record<string, unknown> = {}) {
    return {
        line_one: 'Villa 12, Street 8b',
        building: 'Block C',
        floor: '3',
        apartment: '304',
        directions: 'Gate on the north side, park by the bins',
        area_name_en: 'Al Quoz 1',
        area_name_ar: 'القوز ١',
        window_code: 'morning',
        requested_date: '2026-08-16',
        phone: '+971500000001',
        ...overrides,
    };
}

function wireJob(overrides: Record<string, unknown> = {}) {
    return {
        id: JOB_UUID,
        order_id: ORDER_UUID,
        order_number: 'H360-2026-0148',
        status: 'assigned',
        tracking_status: 'awaiting_assignment',
        assigned_at: '2026-08-16T06:40:00+00:00',
        delivery: wireDelivery(),
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

    it('carries the order number, the hand-over instant and the whole address snapshot', async () => {
        const { repository } = harness([
            { status: 200, body: { data: { jobs: [wireJob()] }, meta: {} } },
        ]);

        const [job] = await repository.listJobs();
        if (job === undefined) throw new Error('the run sheet answered no jobs');

        // The number printed on the bag — what a courier matches an order to, rather than the
        // identifier the row is keyed on.
        expect(job.orderNumber).toBe('H360-2026-0148');
        expect(job.assignedAt).toBe('2026-08-16T06:40:00+00:00');
        expect(job.delivery).toEqual({
            lineOne: 'Villa 12, Street 8b',
            building: 'Block C',
            floor: '3',
            apartment: '304',
            directions: 'Gate on the north side, park by the bins',
            areaNameEn: 'Al Quoz 1',
            areaNameAr: 'القوز ١',
            windowCode: 'morning',
            requestedDate: '2026-08-16',
            // The number the *order* was given, not the customer's best current one.
            phone: '+971500000001',
        });
    });

    it('keeps every absence an absence rather than inventing a number or a blank line', async () => {
        const { repository } = harness([
            {
                status: 200,
                body: {
                    data: {
                        jobs: [
                            wireJob({
                                order_number: null,
                                assigned_at: null,
                                delivery: wireDelivery({
                                    building: null,
                                    floor: null,
                                    apartment: null,
                                    directions: null,
                                    phone: null,
                                }),
                            }),
                        ],
                    },
                    meta: {},
                },
            },
        ]);

        const [job] = await repository.listJobs();
        if (job === undefined) throw new Error('the run sheet answered no jobs');

        // Never defaulted to the order identifier: "no number on this job" and "here is the number"
        // are different facts, and the fallback is the screen's to make visibly.
        expect(job.orderNumber).toBeNull();
        expect(job.assignedAt).toBeNull();
        expect(job.delivery.building).toBeNull();
        expect(job.delivery.phone).toBeNull();
        // The parts that *were* recorded still arrive.
        expect(job.delivery.lineOne).toBe('Villa 12, Street 8b');
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
