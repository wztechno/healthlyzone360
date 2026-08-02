import { createMemoryTokenStore } from '@healthy360/api-client';
import { B2B_FIXTURES, B2bMockStore, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { i18n } from '../../i18n.ts';
import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { AgreementPanel } from './agreement-panel.tsx';
import type { B2BApplication, B2BApplicationState } from './repositories-shim.ts';
import { firstIncompleteStep, validateSection } from './sections.ts';
import { ApplyStepScreen } from './screens/apply-step-screen.tsx';
import { StatusPanel } from './status-panel.tsx';

/**
 * The B1 applicant journey, against the real mock world.
 *
 * Speed-mode coverage: the five things this wave exists to get right — per-section validation, the
 * deep link landing on the first *incomplete* step, document upload and removal against a store that
 * genuinely supersedes, all eleven status states rendering distinctly, and a signature that cannot be
 * produced without both the authority confirmation and a step-up token.
 *
 * Screens run over `createMockRepositories`, which carries the B2B repository as an extra field, so
 * this suite exercises the same resolution path the application uses including the shim's runtime
 * probe.
 *
 * ## Two conventions this file follows, and why
 *
 * **Screen tests come first and use `findBy*`; component tests come after and use `getBy*`.** Each
 * `AppProviders` mount opens an async `act` scope, and from roughly the third mount in a file the
 * `waitFor` behind `findBy*` stops settling — the tree is genuinely there (a synchronous
 * `queryAllByTestId` returns it) but the retry loop times out. The screens have to wait for a query
 * to land; the panels take their data as props and their trees are complete the moment `render`
 * returns, so they ask synchronously and the problem does not arise. Worth stating rather than
 * leaving as an inexplicable mixture of query styles.
 *
 * The wider matrix — lock-version conflicts on every write, the `info_requested` narrowing across
 * all four sections, withdrawal, download links, RTL and axe — is itemised as deferred in the wave
 * report.
 */

/**
 * The router, stubbed.
 *
 * `Redirect` records its destination and renders nothing. It deliberately does **not** build an
 * element: a `jest.mock` factory that references a React Native component gets NativeWind's babel
 * transform injected into it, and the factory may not reference anything out of its own scope —
 * which is a transform-time failure of the whole suite rather than a test that merely fails.
 * Recording the href answers the same question ("where did this send them?") with none of that.
 */
jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    const redirected = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/apply',
        useLocalSearchParams: () => ({}),
        Redirect: ({ href }: { href: string }) => {
            redirected(href);
            return null;
        },
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
        __redirected: redirected,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as {
    __push: jest.Mock;
    __replace: jest.Mock;
    __redirected: jest.Mock;
};

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
    routerMock.__redirected.mockClear();
    globalThis.localStorage?.clear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

/**
 * Everything renders inside `AppProviders`, including the components that take their data as props.
 *
 * Not because they need a repository — they do not — but because they need the i18n provider, and a
 * component rendered without one draws nothing at all rather than drawing untranslated keys.
 */
async function renderApply(
    node: ReactNode,
    seed?: (store: B2bMockStore) => void,
): Promise<Harness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'consumer-account-setup',
        latencyMs: 0,
        tokenStore,
    });
    // Seeded before the first frame: these screens are about a sequence of states, and seeding
    // afterwards would test the refetch path instead of the first paint.
    seed?.(repositories.b2bApplicationStore);

    await render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            {node}
        </AppProviders>,
    );

    return { repositories };
}

/**
 * A copy-only tree: i18n and layout metrics, and nothing else.
 *
 * The panels take their data as props and touch no repository, so mounting the full provider stack
 * for them buys nothing and costs the suite an `AppProviders` mount — and mounts accumulate (see the
 * file header). This is the smallest tree in which design-system components render honestly.
 */
async function renderPanel(node: ReactNode): Promise<void> {
    await render(
        <I18nextProvider i18n={i18n}>
            <SafeAreaProvider initialMetrics={TEST_METRICS}>{node}</SafeAreaProvider>
        </I18nextProvider>,
    );
}

/** A whole application in a chosen state, for the components that take one directly. */
function fixtureApplication(state: B2BApplicationState): B2BApplication {
    const store = new B2bMockStore({ fixture: 'draft-half-complete' });
    store.forceState(state);
    return store.application() as unknown as B2BApplication;
}

/* ══ pure decisions ════════════════════════════════════════════════════════════════════════════ */

describe('section validation', () => {
    it('names every missing required field at once rather than the first', () => {
        const result = validateSection('company', {
            legalName: '',
            legalNameAr: '',
            tradingName: '',
            businessType: null,
            countryCode: '',
            commercialRegistrationNumber: '',
            taxRegistrationNumber: '',
            incorporatedOn: '',
            website: '',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(Object.keys(result.errors).sort()).toEqual([
            'commercialRegistrationNumber',
            'countryCode',
            'legalName',
        ]);
    });

    it('normalises an unanswered optional to null rather than to an empty string', () => {
        const result = validateSection('company', {
            legalName: 'Northwind Catering Services LLC',
            legalNameAr: '',
            tradingName: '  ',
            businessType: 'catering',
            countryCode: 'ae',
            commercialRegistrationNumber: 'CR-1',
            taxRegistrationNumber: '',
            incorporatedOn: '',
            website: '',
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const value = result.value as Record<string, unknown>;
        expect(value['tradingName']).toBeNull();
        expect(value['website']).toBeNull();
        // Uppercased at the boundary: the server holds a foreign key, not a typed string.
        expect(value['countryCode']).toBe('AE');
    });

    it('refuses an address that is not an email and a number that is not E.164', () => {
        const result = validateSection('signatory', {
            signatoryName: 'Layla Haddad',
            signatoryTitle: 'Managing Director',
            signatoryEmail: 'layla at northwind',
            signatoryPhone: '0501234567',
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.errors['signatoryEmail']).toBe('email');
        expect(result.errors['signatoryPhone']).toBe('phone');
    });

    it('lands a deep link on the first incomplete step, not on the first step', () => {
        const store = new B2bMockStore({ fixture: 'draft-half-complete' });
        const application = store.application() as unknown as B2BApplication;

        // Company and signatory are answered; trade terms is not.
        expect(firstIncompleteStep(application)).toBe('trade-terms');
    });
});

/* ══ screens ═══════════════════════════════════════════════════════════════════════════════════ */

describe('the wizard', () => {
    it('redirects a step to the status panel once the application has left the applicant', async () => {
        await renderApply(<ApplyStepScreen step="company" />, (store) => {
            store.forceState('in_review');
        });

        // The destination is assertable rather than merely "something navigated": an approved
        // application opened at a wizard step must not show an editable form nobody will read.
        await waitFor(() => {
            expect(routerMock.__redirected).toHaveBeenCalledWith('/apply/status');
        });
    });

    it('uploads against a document slot, supersedes on replacement, and removes', async () => {
        // No render: this is the vault's mechanics, and the store is the thing under test. Each
        // `render` in this file costs the next one its ability to settle (see the header), so the
        // mounts are spent on the surfaces that can only be checked by drawing them.
        const repositories = createMockRepositories({ latencyMs: 0 });
        const before = repositories.b2bApplicationStore.application();

        await repositories.b2bApplication.uploadDocument({
            applicationId: before?.id ?? '',
            kind: 'commercial_registration',
            fileName: 'clearer-scan.pdf',
            mimeType: 'application/pdf',
            byteSize: 2048,
            content: 'AAAA',
            replacesDocumentId: before?.documents[0]?.id,
        });

        const replaced = repositories.b2bApplicationStore.application();
        // Kept and marked, not overwritten: a reviewer's decision trail has to survive a re-upload.
        expect(replaced?.documents).toHaveLength(2);
        expect(replaced?.documents[0]?.reviewStatus).toBe('superseded');
        expect(replaced?.documents[1]?.fileName).toBe('clearer-scan.pdf');

        await repositories.b2bApplication.removeDocument({
            applicationId: replaced?.id ?? '',
            documentId: replaced?.documents[1]?.id ?? '',
        });

        const after = repositories.b2bApplicationStore.application();
        expect(after?.documents.map((held) => held.reviewStatus)).toEqual(['superseded']);
        // The requirement is the server's list, and it does not move when a file does.
        expect(after?.requiredDocumentKinds).toEqual([
            'commercial_registration',
            'signatory_identification',
        ]);
    });
});

/* ══ the applicant's two panels ════════════════════════════════════════════════════════════════ */

const STATES: readonly B2BApplicationState[] = [
    'draft',
    'submitted',
    'in_review',
    'info_requested',
    'approved',
    'agreement_pending',
    'agreement_signed',
    'provisioning',
    'provisioned',
    'declined',
    'withdrawn',
];

/**
 * Both panels, one tree, one test.
 *
 * Not a stylistic choice. Only the first couple of `render` calls in this file produce a tree that
 * the queries can see — the third mount and beyond come back empty whether the wrapper is the full
 * provider stack or two providers, and whether the query is synchronous or retried. Rather than
 * leave a third of the coverage failing, the panel assertions share the one mount they need, and
 * the reason is written here instead of being rediscovered.
 *
 * The assertions are still separable by eye: the eleven states, the request links, and the two
 * signing states.
 */
describe('the applicant panels', () => {
    const agreement = B2B_FIXTURES['agreement-pending'].agreement as NonNullable<
        (typeof B2B_FIXTURES)['agreement-pending']['agreement']
    >;

    it('draws every state distinctly, links each request, and opens signing only after a step-up', async () => {
        const requested = new B2bMockStore({ fixture: 'information-requested' });
        const withRequests = requested.application() as unknown as B2BApplication;
        const opened: string[] = [];
        const withoutToken = jest.fn();
        const withToken = jest.fn();

        await renderPanel(
            <>
                {STATES.map((state) => (
                    <StatusPanel
                        key={state}
                        testID={`state-${state}`}
                        application={fixtureApplication(state)}
                    />
                ))}
                <StatusPanel
                    testID="requests"
                    application={withRequests}
                    onOpenStep={(slug) => {
                        opened.push(slug);
                    }}
                />
                <AgreementPanel
                    testID="open"
                    agreement={agreement as never}
                    onRequestCode={jest.fn()}
                    onVerifyCode={jest.fn()}
                    onResendCode={jest.fn()}
                    onSign={withoutToken}
                />
                <AgreementPanel
                    testID="stepped"
                    agreement={agreement as never}
                    verificationToken="verified-challenge-id"
                    onRequestCode={jest.fn()}
                    onVerifyCode={jest.fn()}
                    onResendCode={jest.fn()}
                    onSign={withToken}
                />
            </>,
        );

        /* ── the eleven states ─────────────────────────────────────────────────────────────── */

        const bodies = new Set<string>();
        for (const state of STATES) {
            expect(screen.getByTestId(`state-${state}-badge`)).toBeTruthy();
            bodies.add(String(screen.getByTestId(`state-${state}-body`).props.children));
        }
        // Eleven distinct bodies: `approved` must not read as `agreement_pending`, and `declined`
        // must not read as `withdrawn`. A shared string here would be the panel's worst lie.
        expect(bodies.size).toBe(STATES.length);

        /* ── reviewer requests link at what they are about ─────────────────────────────────── */

        const requests = withRequests.reviewerRequests;
        fireEvent.press(
            screen.getByTestId(`requests-request-${requests[0]?.id ?? ''}-section-trade_terms`),
        );
        fireEvent.press(
            screen.getByTestId(
                `requests-request-${requests[1]?.id ?? ''}-document-signatory_identification`,
            ),
        );
        // One names a section and one names a document kind; each links at its own thing.
        expect(opened).toEqual(['trade-terms', 'documents']);

        /* ── signing, before and after the step-up ─────────────────────────────────────────── */

        // The honesty block sits above the controls, not as a footnote under them.
        expect(screen.getByTestId('open-honesty')).toHaveTextContent(
            /not a qualified or certified electronic signature/i,
        );
        expect(screen.getByTestId('open-consent-statement')).toHaveTextContent(
            /record of my acceptance/i,
        );
        expect(screen.getByTestId('open-verify-first')).toBeTruthy();

        // Everything typed and the authority ticked, but no code verified: still refused.
        fireEvent.changeText(screen.getByTestId('open-typed-name-input'), 'Layla Haddad');
        fireEvent.changeText(screen.getByTestId('open-signatory-title-input'), 'Managing Director');
        fireEvent.press(screen.getByTestId('open-authority-control'));
        fireEvent.press(screen.getByTestId('open-submit'));
        await waitFor(() => {
            expect(withoutToken).not.toHaveBeenCalled();
        });

        // The same three answers, with a verified code behind them.
        fireEvent.changeText(screen.getByTestId('stepped-typed-name-input'), 'Layla Haddad');
        fireEvent.changeText(
            screen.getByTestId('stepped-signatory-title-input'),
            'Managing Director',
        );
        fireEvent.press(screen.getByTestId('stepped-authority-control'));

        // Retried: the control opens on the commit that lands the third answer, and pressing it on
        // the frame before that is pressing a disabled button.
        await waitFor(() => {
            fireEvent.press(screen.getByTestId('stepped-submit'));
            // Three separate claims, and the acceptance carries all three.
            expect(withToken).toHaveBeenCalledWith({
                typedName: 'Layla Haddad',
                signatoryTitle: 'Managing Director',
                authorityConfirmed: true,
            });
        });
    });
});
