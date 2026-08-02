import { describe, expect, it } from 'vitest';

import { isConflictFailure, isValidationFailure } from '../../contracts/failure.ts';
import { createB2bMockRepositories } from './repositories.ts';
import { AGREEMENT_DOCUMENT_SHA256 } from './seed.ts';
import { MOCK_SIGNING_TOKEN } from './store.ts';

/**
 * The B1 mock world's own mechanics.
 *
 * Speed-mode coverage: the four rules the screens are built on top of and would silently lose if
 * the world were permissive — section ownership, server-side completeness, supersession on replace,
 * and a signature that cannot be produced without a step-up. The wider matrix (lock-version
 * conflicts on every write, withdrawal, download links, the `info_requested` narrowing across all
 * four sections) is itemised as deferred in the wave report.
 */

function world(fixture?: Parameters<typeof createB2bMockRepositories>[0]) {
    return createB2bMockRepositories({ latencyMs: 0, ...fixture });
}

describe('sections', () => {
    it('refuses a field the section does not own rather than dropping it', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        await expect(
            b2bApplication.saveSection({
                applicationId: application?.id ?? '',
                section: 'logistics',
                // `legalName` belongs to `company`. A silent drop here is a bug report six weeks
                // later about data that "didn't save".
                payload: { legalName: 'Elsewhere LLC' } as never,
                lockVersion: application?.lockVersion ?? 0,
            }),
        ).rejects.toSatisfy(isValidationFailure);
    });

    it('persists a section write and bumps the lock version', async () => {
        const { b2bApplication } = world();
        const before = await b2bApplication.getApplication();

        const after = await b2bApplication.saveSection({
            applicationId: before?.id ?? '',
            section: 'trade_terms',
            payload: { requestedPaymentTerms: 'net_15' },
            markComplete: true,
            lockVersion: before?.lockVersion ?? 0,
        });

        expect(after.sections.trade_terms.requestedPaymentTerms).toBe('net_15');
        expect(after.lockVersion).toBe((before?.lockVersion ?? 0) + 1);
        // Re-read: the write went to the world, not to the answer.
        const reread = await b2bApplication.getApplication();
        expect(reread?.sections.trade_terms.requestedPaymentTerms).toBe('net_15');
    });

    it('reports completeness from the data present, not from the applicant claim', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        const claimed = application?.sectionStates.find((state) => state.section === 'company');
        const unclaimed = application?.sectionStates.find(
            (state) => state.section === 'trade_terms',
        );

        expect(claimed?.completedByApplicant).toBe(true);
        expect(claimed?.complete).toBe(true);
        expect(unclaimed?.complete).toBe(false);
        expect(unclaimed?.missingFields).toContain('requestedPaymentTerms');
    });

    it('refuses a stale lock version with the version the server holds', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        await expect(
            b2bApplication.saveSection({
                applicationId: application?.id ?? '',
                section: 'logistics',
                payload: { leadTimeDays: 3 },
                lockVersion: (application?.lockVersion ?? 0) + 7,
            }),
        ).rejects.toSatisfy(isConflictFailure);
    });
});

describe('submission', () => {
    it('names the sections and document kinds that are missing', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        await expect(
            b2bApplication.submitApplication({
                applicationId: application?.id ?? '',
                lockVersion: application?.lockVersion ?? 0,
            }),
        ).rejects.toMatchObject({
            failure: {
                code: 'validation.failed',
                fields: {
                    trade_terms: ['requestedPaymentTerms'],
                    documents: ['signatory_identification'],
                },
            },
        });
    });
});

describe('documents', () => {
    it('supersedes rather than overwrites when a document is replaced', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();
        const existing = application?.documents[0];

        const after = await b2bApplication.uploadDocument({
            applicationId: application?.id ?? '',
            kind: 'commercial_registration',
            fileName: 'northwind-cr-2026-clearer.pdf',
            mimeType: 'application/pdf',
            byteSize: 1024,
            content: 'AAAA',
            replacesDocumentId: existing?.id,
        });

        const replaced = after.documents.find((held) => held.id === existing?.id);
        expect(replaced?.reviewStatus).toBe('superseded');
        expect(after.documents).toHaveLength(2);
    });

    it('removes an uploaded document', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        const after = await b2bApplication.removeDocument({
            applicationId: application?.id ?? '',
            documentId: application?.documents[0]?.id ?? '',
        });

        expect(after.documents).toHaveLength(0);
    });

    it('refuses a countersigned agreement posted by a client', async () => {
        const { b2bApplication } = world();
        const application = await b2bApplication.getApplication();

        await expect(
            b2bApplication.uploadDocument({
                applicationId: application?.id ?? '',
                kind: 'signed_agreement',
                fileName: 'my-own-idea-of-what-i-signed.pdf',
                mimeType: 'application/pdf',
                byteSize: 10,
                content: 'AA',
            }),
        ).rejects.toSatisfy(isConflictFailure);
    });
});

describe('information requested', () => {
    it('reopens only the sections an unresolved request named', async () => {
        const { b2bApplication } = world({ fixture: 'information-requested', latencyMs: 0 });
        const application = await b2bApplication.getApplication();

        const editable = application?.sectionStates
            .filter((state) => state.editable)
            .map((state) => state.section);

        expect(editable).toEqual(['trade_terms']);
    });
});

describe('signing', () => {
    it('refuses without the authority confirmation and without a step-up token', async () => {
        const { b2bApplication } = world({ fixture: 'agreement-pending', latencyMs: 0 });
        const application = await b2bApplication.getApplication();
        const agreement = application?.agreement;

        const base = {
            agreementId: agreement?.id ?? '',
            kind: 'typed_name' as const,
            typedName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            documentSha256: AGREEMENT_DOCUMENT_SHA256,
            lockVersion: agreement?.lockVersion ?? 0,
        };

        await expect(
            b2bApplication.signAgreement({
                ...base,
                authorityConfirmed: false,
                verificationToken: MOCK_SIGNING_TOKEN,
            }),
        ).rejects.toSatisfy(isValidationFailure);

        await expect(
            b2bApplication.signAgreement({
                ...base,
                authorityConfirmed: true,
                verificationToken: '',
            }),
        ).rejects.toSatisfy(isValidationFailure);
    });

    it('records click-wrap evidence and starts provisioning', async () => {
        const { b2bApplication, store } = world({ fixture: 'agreement-pending', latencyMs: 0 });
        const application = await b2bApplication.getApplication();
        const agreement = application?.agreement;

        const signed = await b2bApplication.signAgreement({
            agreementId: agreement?.id ?? '',
            kind: 'typed_name',
            typedName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            authorityConfirmed: true,
            documentSha256: AGREEMENT_DOCUMENT_SHA256,
            verificationToken: MOCK_SIGNING_TOKEN,
            lockVersion: agreement?.lockVersion ?? 0,
        });

        expect(signed.state).toBe('provisioning');
        expect(signed.agreement?.signature?.kind).toBe('typed_name');
        expect(signed.agreement?.signature?.documentSha256).toBe(AGREEMENT_DOCUMENT_SHA256);
        // The countersigned copy is produced by the flow, never posted by the client.
        expect(signed.documents.some((held) => held.kind === 'signed_agreement')).toBe(true);
        expect(signed.provisioning?.completedAt).toBeNull();

        expect(store.completeProvisioning().state).toBe('provisioned');
    });

    it('refuses a signature against a document that changed', async () => {
        const { b2bApplication } = world({ fixture: 'agreement-pending', latencyMs: 0 });
        const application = await b2bApplication.getApplication();
        const agreement = application?.agreement;

        await expect(
            b2bApplication.signAgreement({
                agreementId: agreement?.id ?? '',
                kind: 'typed_name',
                typedName: 'Layla Haddad',
                signatoryTitle: 'Managing Director',
                authorityConfirmed: true,
                documentSha256: 'ff'.repeat(32),
                verificationToken: MOCK_SIGNING_TOKEN,
                lockVersion: agreement?.lockVersion ?? 0,
            }),
        ).rejects.toSatisfy(isConflictFailure);
    });
});
