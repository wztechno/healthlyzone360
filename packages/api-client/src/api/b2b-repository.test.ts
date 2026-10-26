import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiB2bApplicationRepository } from './b2b-repository.ts';
import { createTransport } from './transport.ts';

/**
 * Every single-application endpoint answers `{ application, … }`, never the bare row. Reading the
 * body as the row sent `/b2b/applications/undefined/documents` and drew `status.undefined.label`
 * on `/apply`.
 */

const APPLICATION_UUID = '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9001';

const APPLICATION = {
    id: APPLICATION_UUID,
    reference: 'B2B-2026-000001',
    status: 'draft',
    applicant_user_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9002',
    legal_name: 'Acme Catering LLC',
    requires_invoice_per_location: false,
    completed_sections: ['company'],
    writable_sections: ['company', 'signatory', 'trade_terms', 'logistics'],
    lock_version: 3,
    created_at: '2026-10-26T08:00:00+00:00',
};

function harness() {
    const paths: string[] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = url.replace('https://api.example/api/v1', '');
            const method = init?.method ?? 'GET';
            paths.push(`${method} ${path}`);

            const json = (body: unknown, status = 200) =>
                new Response(JSON.stringify(body), { status });

            if (path === '/b2b/applications' && method === 'POST') {
                return json({ data: { application: APPLICATION } }, 201);
            }
            if (path === '/b2b/applications') {
                return json({ data: [APPLICATION], meta: { has_more: false, next_cursor: null } });
            }
            if (path === `/b2b/applications/${APPLICATION_UUID}`) {
                return json({ data: { application: APPLICATION, contacts: [], locations: [] } });
            }
            if (path === `/b2b/applications/${APPLICATION_UUID}/documents`) {
                return json({ data: [] });
            }
            if (path === `/b2b/applications/${APPLICATION_UUID}/agreements`) {
                return json({ data: [] });
            }
            return json({ error: { code: 'resource.not_found', message: path } }, 404);
        },
    });

    return { repository: createApiB2bApplicationRepository(transport), paths };
}

describe('b2b application envelope', () => {
    it('reads the application out of the detail envelope', async () => {
        const { repository, paths } = harness();

        const application = await repository.getApplication();

        expect(application?.id).toBe(APPLICATION_UUID);
        expect(application?.state).toBe('draft');
        expect(application?.lockVersion).toBe(3);
        expect(application?.sections.company.legalName).toBe('Acme Catering LLC');
        expect(paths.some((path) => path.includes('undefined'))).toBe(false);
    });

    it('reads the application out of a write envelope', async () => {
        const { repository } = harness();

        const application = await repository.startApplication();

        expect(application.id).toBe(APPLICATION_UUID);
        expect(application.state).toBe('draft');
    });
});
