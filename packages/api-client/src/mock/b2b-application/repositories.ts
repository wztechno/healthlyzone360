import type {
    B2BAgreement,
    B2BApplication,
    B2BApplicationRepository,
    B2BApplicationSection,
    B2BOffboarding,
    B2BSectionPayload,
    DocumentDownload,
    SignAgreementRequest,
    SignOffOffboardingRequest,
    UploadDocumentRequest,
} from '../../contracts/b2b-application.ts';
import type { OtpChallenge } from '../../contracts/verification.ts';
import { B2bMockStore } from './store.ts';
import type { B2bMockStoreOptions } from './store.ts';

/**
 * The B1 B2B-onboarding mock repository.
 *
 * Deliberately **not** a member of the `MockRepositories` bundle's required contracts:
 * `B2BApplicationRepository` is not in `contracts/index.ts`'s bundle either, and registering it is
 * the same commit that writes the API-side implementation. Until then this is a standalone factory,
 * which is enough for the mock world's own tests and for a screen handed it through the bundle's
 * extra fields.
 */
export interface B2bMockRepositories {
    readonly kind: 'mock-b2b-application';
    readonly b2bApplication: B2BApplicationRepository;
    /** The mutable world, so a test can assert what a write did without a second round trip. */
    readonly store: B2bMockStore;
}

export interface B2bMockRepositoriesOptions extends B2bMockStoreOptions {
    /** Simulated round trip. Set to `0` in unit tests. */
    readonly latencyMs?: number | undefined;
    /** Reuse an existing world instead of building a fresh one. */
    readonly store?: B2bMockStore | undefined;
}

function sleep(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEFAULT_B2B_MOCK_LATENCY_MS = 200;

export function createB2bMockRepositories(
    options: B2bMockRepositoriesOptions = {},
): B2bMockRepositories {
    const store =
        options.store ??
        new B2bMockStore({
            ...(options.now === undefined ? {} : { now: options.now }),
            ...(options.fixture === undefined ? {} : { fixture: options.fixture }),
            ...(options.empty === undefined ? {} : { empty: options.empty }),
            ...(options.withoutOffboarding === undefined
                ? {}
                : { withoutOffboarding: options.withoutOffboarding }),
            ...(options.openOrders === undefined ? {} : { openOrders: options.openOrders }),
        });
    const latency = options.latencyMs ?? DEFAULT_B2B_MOCK_LATENCY_MS;
    const settle = () => sleep(latency);

    const b2bApplication: B2BApplicationRepository = {
        async getApplication(): Promise<B2BApplication | null> {
            await settle();
            return store.application();
        },

        async startApplication(): Promise<B2BApplication> {
            await settle();
            return store.startApplication();
        },

        async saveSection(request: {
            readonly applicationId: string;
            readonly section: B2BApplicationSection;
            readonly payload: B2BSectionPayload;
            readonly markComplete?: boolean | undefined;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            await settle();
            return store.saveSection(request);
        },

        async uploadDocument(request: UploadDocumentRequest): Promise<B2BApplication> {
            await settle();
            return store.uploadDocument(request);
        },

        async removeDocument(request: {
            readonly applicationId: string;
            readonly documentId: string;
        }): Promise<B2BApplication> {
            await settle();
            return store.removeDocument(request);
        },

        async getDocumentDownload(request: {
            readonly applicationId: string;
            readonly documentId: string;
        }): Promise<DocumentDownload> {
            await settle();
            return store.documentDownload(request);
        },

        async submitApplication(request: {
            readonly applicationId: string;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            await settle();
            return store.submitApplication(request);
        },

        async withdrawApplication(request: {
            readonly applicationId: string;
            readonly lockVersion: number;
        }): Promise<B2BApplication> {
            await settle();
            return store.withdrawApplication(request);
        },

        async getAgreement(request: {
            readonly applicationId: string;
        }): Promise<B2BAgreement | null> {
            await settle();
            return store.agreement(request.applicationId);
        },

        async signAgreement(request: SignAgreementRequest): Promise<B2BApplication> {
            await settle();
            return store.signAgreement(request);
        },

        async getOffboarding(request: {
            readonly organisationId: string;
        }): Promise<B2BOffboarding | null> {
            await settle();
            return store.offboarding(request.organisationId);
        },

        async runSettlementChecks(request: {
            readonly offboardingId: string;
            readonly lockVersion: number;
        }): Promise<B2BOffboarding> {
            await settle();
            return store.runSettlementChecks(request.offboardingId, request.lockVersion);
        },

        async issueSignoffChallenge(request: {
            readonly offboardingId: string;
        }): Promise<OtpChallenge> {
            await settle();
            return store.issueSignoffChallenge(request.offboardingId);
        },

        async signOffOffboarding(request: SignOffOffboardingRequest): Promise<B2BOffboarding> {
            await settle();
            return store.signOffOffboarding(request);
        },
    };

    return { kind: 'mock-b2b-application', b2bApplication, store };
}
