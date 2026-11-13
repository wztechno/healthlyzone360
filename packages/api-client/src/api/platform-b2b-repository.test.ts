import { describe, expect, it } from 'vitest';

import { createMemoryTokenStore } from '../contracts/session.ts';
import { createApiPlatformB2bRepository } from './platform-b2b-repository.ts';
import { createTransport } from './transport.ts';

/**
 * The reviewer's repository against a transport that answers by path.
 *
 * What only a wire test proves: every response is read out of its envelope, `If-Match` travels
 * from the version the caller read, and provisioning carries an `Idempotency-Key`.
 */

const APPLICATION = {
    id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9101',
    reference: 'B2B-2026-000009',
    status: 'in_review',
    applicant_user_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9102',
    legal_name: 'Cedars Catering SAL',
    requires_invoice_per_location: false,
    completed_sections: ['company', 'signatory'],
    writable_sections: [],
    decision_note: 'Checked the registry.',
    lock_version: 4,
};

const AGREEMENT = {
    id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9201',
    b2b_application_id: APPLICATION.id,
    version: 1,
    status: 'draft',
    title: 'Master supply agreement',
    price_list_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9301',
    seller: {
        organisation_id: '0198c5f2-7d3a-7b1e-9c4d-2f6a8b0e9302',
        organisation_name: 'Verdant Kitchen',
        price_list_name_en: 'Cedars negotiated',
        price_list_name_ar: null,
    },
    currency_code: 'USD',
    auto_renews: false,
    signature_otp_verified: false,
    document_sha256: 'a'.repeat(64),
    lock_version: 0,
};

interface Sent {
    readonly method: string;
    readonly path: string;
    readonly headers: Headers;
    readonly body: unknown;
}

function harness() {
    const sent: Sent[] = [];

    const transport = createTransport({
        baseUrl: 'https://api.example',
        tokenStore: createMemoryTokenStore('token'),
        fetch: async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            const path = url.replace('https://api.example/api/v1', '');
            const method = init?.method ?? 'GET';
            const raw = init?.body;
            sent.push({
                method,
                path,
                headers: new Headers(init?.headers),
                body: typeof raw === 'string' ? JSON.parse(raw) : null,
            });

            const json = (data: unknown, status = 200) =>
                new Response(JSON.stringify({ data, meta: { correlation_id: 'c' } }), { status });

            if (path === `/platform/b2b/applications/${APPLICATION.id}`) {
                return json({
                    application: APPLICATION,
                    contacts: [
                        { id: 'c1', role: 'primary', name: 'Nadia', email: 'nadia@cedars.test' },
                    ],
                    locations: [],
                    documents: [],
                    missing_documents: ['signatory_identification'],
                    duplicate_matches: 0,
                    duplicate_applications: [],
                });
            }
            if (
                path === `/platform/b2b/applications/${APPLICATION.id}/agreements` &&
                method === 'POST'
            ) {
                return json({ agreement: AGREEMENT }, 201);
            }
            if (path === `/platform/b2b/agreements/${AGREEMENT.id}/send`) {
                return json({
                    agreement: { ...AGREEMENT, status: 'pending_signature', lock_version: 1 },
                });
            }
            if (path === `/platform/b2b/applications/${APPLICATION.id}/provision`) {
                return json({
                    application: APPLICATION,
                    organisation: { id: 'org-1', name: 'Cedars Catering SAL' },
                    customer_account: {},
                    agreement: null,
                    invitations_issued: 2,
                    owner_membership_created: true,
                });
            }
            return json({ application: APPLICATION });
        },
    });

    return { repository: createApiPlatformB2bRepository(transport), sent };
}

describe('platform B2B repository', () => {
    it('reads the review file out of its envelope', async () => {
        const { repository } = harness();

        const application = await repository.getApplication(APPLICATION.id);

        expect(application.reference).toBe('B2B-2026-000009');
        expect(application.status).toBe('in_review');
        expect(application.decisionNote).toBe('Checked the registry.');
        expect(application.contacts[0]?.email).toBe('nadia@cedars.test');
        expect(application.missingDocumentKinds).toEqual(['signatory_identification']);
    });

    it('drafts with the title and only the terms given, and sends with If-Match', async () => {
        const { repository, sent } = harness();

        const draft = await repository.draftAgreement({
            applicationId: APPLICATION.id,
            title: 'Master supply agreement',
            terms: { priceListId: AGREEMENT.price_list_id, paymentTerms: 'net_30' },
        });

        expect(draft.seller?.organisationName).toBe('Verdant Kitchen');
        expect(sent[0]?.body).toEqual({
            title: 'Master supply agreement',
            price_list_id: AGREEMENT.price_list_id,
            payment_terms: 'net_30',
        });

        const pending = await repository.sendAgreement({
            agreementId: draft.id,
            lockVersion: draft.lockVersion,
        });

        expect(pending.status).toBe('pending_signature');
        expect(sent[1]?.headers.get('If-Match')).toBe('"0"');
    });

    it('provisions with an idempotency key and reports the owner membership', async () => {
        const { repository, sent } = harness();

        const outcome = await repository.provision(APPLICATION.id);

        expect(outcome).toEqual({
            organisationId: 'org-1',
            organisationName: 'Cedars Catering SAL',
            invitationsIssued: 2,
            ownerMembershipCreated: true,
        });
        expect(sent[0]?.headers.get('Idempotency-Key')).toMatch(/[0-9a-f-]{36}/);
    });
});
