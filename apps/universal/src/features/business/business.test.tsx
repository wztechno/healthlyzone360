import { createMemoryTokenStore } from '@healthy360/api-client';
import { MOCK_SCENARIOS, createMockRepositories } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import type {
    CatalogueItem,
    CorporateProgramme,
    Quotation,
} from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { validateDraft } from './draft.ts';
import type { DraftContact } from './draft.ts';
import {
    CONTRACT_PRICE_TEST_ID_PREFIX,
    contractPriceTestId,
    earliestSupplyDate,
    isMixedCurrency,
    lineValue,
    supplyDates,
    tierForQuantity,
    totalsByCurrency,
} from './format.ts';
import { CatalogueItemScreen } from './screens/catalogue-item-screen.tsx';
import { CorporateCatalogueScreen } from './screens/corporate-catalogue-screen.tsx';
import { CorporateDashboardScreen } from './screens/corporate-dashboard-screen.tsx';
import { PartnerCommitmentsScreen } from './screens/partner-commitments-screen.tsx';
import { PartnerScheduleScreen } from './screens/partner-schedule-screen.tsx';
import { QuotationBuilderScreen } from './screens/quotation-builder-screen.tsx';
import { QuotationsScreen } from './screens/quotations-screen.tsx';

/**
 * The B2B surfaces, against the real mock repositories.
 *
 * Nothing here stubs a hook. Three things this file exists to prove:
 *
 * 1. **A quotation submission genuinely mutates the world.** `requestQuotation` is on the contract
 *    and the store honours it, so the builder is a real form with a real result — the reference it
 *    reports back is the one the quotation list then shows. A prototype notice in its place would
 *    have been a claim about the interface that is not true.
 * 2. **Money is never summed across currencies.** One fixture line is priced in SAR; the totals
 *    helper groups before it adds, so a mixed list produces two totals rather than one wrong one.
 * 3. **The `contract-price-` marker has exactly one owner.** The partner screens render commitments
 *    from the same quotations and carry no marker at all, which is what makes the Playwright privacy
 *    sweep a meaningful assertion rather than a list of exceptions.
 */

const DIETITIAN = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

jest.mock('expo-router', () => {
    const push = jest.fn();
    const replace = jest.fn();
    return {
        __esModule: true,
        useRouter: () => ({ push, replace, setParams: jest.fn(), back: jest.fn() }),
        usePathname: () => '/corporate',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __push: push,
        __replace: replace,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as { __push: jest.Mock; __replace: jest.Mock };

beforeEach(() => {
    routerMock.__push.mockClear();
    routerMock.__replace.mockClear();
});

interface Harness {
    readonly repositories: MockRepositories;
}

async function renderBusiness(node: ReactNode): Promise<Harness> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'multi-org-dietitian',
        latencyMs: 5,
        tokenStore,
    });
    await repositories.auth.login({ email: DIETITIAN, password: 'password' });

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
 * Fixture facts come from a throwaway bundle rather than by rendering a tree and scraping it:
 * rendering a second tree inside a test leaves `screen` pointing at one the test then unmounts.
 */
const scratch = createMockRepositories({ scenario: 'multi-org-dietitian', latencyMs: 0 });

let quotations: readonly Quotation[];
let programmes: readonly CorporateProgramme[];
/** The one line priced in SAR — the fixture world's multi-currency proof. */
let sarItem: CatalogueItem;
let aedItem: CatalogueItem;

beforeAll(async () => {
    const page = await scratch.business.listQuotations();
    quotations = page.items;

    const ids = [...new Set(quotations.map((quotation) => quotation.programmeId))];
    programmes = await Promise.all(ids.map((id) => scratch.business.getCorporateProgramme(id)));

    sarItem = await scratch.business.getCatalogueItem('catalogue-wholesale-prepared-pallet');
    aedItem = await scratch.business.getCatalogueItem('catalogue-staff-lunch-box');
});

function aed(amount: number): Money {
    return { amount, currency: 'AED' };
}

function sar(amount: number): Money {
    return { amount, currency: 'SAR' };
}

/* ══ pure: money, tiers and the supply calendar ════════════════════════════════════════════════ */

describe('contract-price marker', () => {
    it('is built from one prefix, so a rename cannot leave half the markers behind', () => {
        expect(contractPriceTestId('anything')).toBe(`${CONTRACT_PRICE_TEST_ID_PREFIX}anything`);
        expect(CONTRACT_PRICE_TEST_ID_PREFIX).toBe('contract-price-');
    });
});

describe('money across currencies', () => {
    it('totals each currency separately rather than producing one wrong number', () => {
        const totals = totalsByCurrency([aed(1000), sar(500), aed(2500)]);

        expect(totals).toEqual([aed(3500), sar(500)]);
        expect(isMixedCurrency([aed(1000), sar(500)])).toBe(true);
        expect(isMixedCurrency([aed(1000), aed(500)])).toBe(false);
    });

    it('answers an empty list with no totals rather than a zero in some arbitrary currency', () => {
        expect(totalsByCurrency([])).toEqual([]);
        expect(isMixedCurrency([])).toBe(false);
    });

    it('keeps the fixture world non-AED line in its own currency', () => {
        expect(sarItem.contractPrice?.currency).toBe('SAR');
        expect(aedItem.contractPrice?.currency).toBe('AED');

        const mixed = [sarItem.contractPrice, aedItem.contractPrice].filter(
            (value): value is Money => value !== null && value !== undefined,
        );
        expect(isMixedCurrency(mixed)).toBe(true);
        expect(totalsByCurrency(mixed)).toHaveLength(2);
    });
});

describe('volume tiers', () => {
    it('resolves a quantity to the tier it earns, and to nothing below the first one', () => {
        expect(tierForQuantity(aedItem.volumeTiers, 1)).toBeNull();
        expect(tierForQuantity(aedItem.volumeTiers, 40)?.minimumQuantity).toBe(40);
        expect(tierForQuantity(aedItem.volumeTiers, 120)?.minimumQuantity).toBe(100);
        // The last tier has no ceiling.
        expect(tierForQuantity(aedItem.volumeTiers, 100_000)?.maximumQuantity).toBeNull();
    });

    it('prices a line at its tier, and refuses to price one below the minimum order', () => {
        expect(lineValue(aedItem, 1)).toBeNull();

        const tier = tierForQuantity(aedItem.volumeTiers, 120);
        const value = lineValue(aedItem, 120);
        expect(value).not.toBeNull();
        expect(value?.currency).toBe(tier?.unitPrice.currency);
        expect(value?.amount).toBe((tier?.unitPrice.amount ?? 0) * 120);
    });
});

describe('the supply calendar', () => {
    it('opens a window at the request date plus the lead time on the line', () => {
        expect(earliestSupplyDate('2026-07-28T07:20:00.000Z', 2)).toBe('2026-07-30');
        expect(earliestSupplyDate('not a date', 2)).toBeNull();
    });

    it('projects that window onto the delivery weekdays agreed for the line', () => {
        const quotation = quotations.find((candidate) =>
            candidate.lines.some((line) => line.catalogueItemId === aedItem.id),
        );
        expect(quotation).toBeDefined();
        if (quotation === undefined) return;

        const dates = supplyDates(quotation, aedItem, 4);
        expect(dates).toHaveLength(4);

        for (const date of dates) {
            const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
            // The staff-lunch line delivers Monday to Friday only.
            expect(weekday).not.toBe(0);
            expect(weekday).not.toBe(6);
            // Nothing before the lead time has elapsed.
            expect(date >= '2026-07-30').toBe(true);
        }
    });

    it('produces nothing for a line with no agreed delivery days', () => {
        const quotation = quotations[0];
        expect(quotation).toBeDefined();
        if (quotation === undefined) return;
        expect(supplyDates(quotation, { ...aedItem, deliveryWeekdays: [] }, 4)).toEqual([]);
    });
});

describe('quotation draft validation', () => {
    const translate = (key: string) => key;
    const contact: DraftContact = {
        name: 'Dana',
        email: 'dana@example.com',
        note: '',
        requestedDeliveryDate: null,
        recurring: false,
    };

    it('refuses an empty draft', () => {
        const errors = validateDraft([aedItem], {}, contact, translate);
        expect(errors.lines).toBe('business:builder.errorNoLines');
    });

    it('refuses a line below its minimum order', () => {
        const errors = validateDraft([aedItem], { [aedItem.id]: 1 }, contact, translate);
        expect(errors.lines).toBe('business:builder.errorBelowMinimum');
    });

    it('requires a contact who can actually be replied to', () => {
        const quantities = { [aedItem.id]: aedItem.minimumOrderQuantity };
        expect(
            validateDraft([aedItem], quantities, { ...contact, name: '  ' }, translate).name,
        ).toBe('errors:validation.required');
        expect(
            validateDraft([aedItem], quantities, { ...contact, email: 'dana' }, translate).email,
        ).toBe('errors:validation.email');
        expect(validateDraft([aedItem], quantities, contact, translate)).toEqual({});
    });
});

/* ══ the corporate dashboard ═══════════════════════════════════════════════════════════════════ */

describe('corporate dashboard', () => {
    it('lists the programmes the quotation history reaches, and says that is why', async () => {
        await renderBusiness(<CorporateDashboardScreen />);

        expect(screen.getByTestId('corporate-programme-source')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('corporate-programme-list')).toBeTruthy();
        });

        for (const programme of programmes) {
            const base = `corporate-programme-${String(programme.id)}`;
            expect(screen.getByTestId(`${base}-name`)).toBeTruthy();
            expect(screen.getByTestId(`${base}-headcount`)).toBeTruthy();
            expect(screen.getByTestId(`${base}-locations`)).toBeTruthy();
        }
    });

    it('marks the per-person subsidy as a contract price, because it is one', async () => {
        await renderBusiness(<CorporateDashboardScreen />);

        const subsidised = programmes.find((programme) => programme.employeeSubsidy !== null);
        expect(subsidised).toBeDefined();
        if (subsidised === undefined) return;

        await waitFor(() => {
            expect(
                screen.getByTestId(contractPriceTestId(`subsidy-${String(subsidised.id)}`)),
            ).toBeTruthy();
        });
    });

    it('summarises the outstanding quotations by reference', async () => {
        await renderBusiness(<CorporateDashboardScreen />);

        const first = quotations[0];
        expect(first).toBeDefined();
        if (first === undefined) return;

        await waitFor(() => {
            expect(screen.getByTestId(`corporate-quotation-${first.reference}`)).toBeTruthy();
        });
    });
});

/* ══ the negotiated catalogue ══════════════════════════════════════════════════════════════════ */

describe('corporate catalogue', () => {
    it('renders a contract price, a minimum order and a lead time on every line', async () => {
        await renderBusiness(
            <CorporateCatalogueScreen programmeId={String(aedItem.programmeId)} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${aedItem.id}`)).toBeTruthy();
        });
        expect(screen.getByTestId(contractPriceTestId(aedItem.id))).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${aedItem.id}-minimum`)).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${aedItem.id}-lead-time`)).toBeTruthy();
        expect(screen.getByTestId(`catalogue-item-${aedItem.id}-weekdays`)).toBeTruthy();
        expect(screen.getByTestId('corporate-catalogue-currencies')).toBeTruthy();
    });

    it('shows the SAR line in its own currency rather than converting it', async () => {
        await renderBusiness(
            <CorporateCatalogueScreen programmeId={String(sarItem.programmeId)} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId(contractPriceTestId(sarItem.id))).toBeTruthy();
        });
        expect(screen.getAllByText(/SAR/).length).toBeGreaterThan(0);
    });

    it('filters to a kind, then offers a way back out of an empty result', async () => {
        await renderBusiness(
            <CorporateCatalogueScreen programmeId={String(sarItem.programmeId)} />,
        );

        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${sarItem.id}`)).toBeTruthy();
        });

        // The wholesale programme holds a bulk package and no meals.
        fireEvent.press(screen.getByTestId('corporate-catalogue-kind-meal'));
        await waitFor(() => {
            expect(screen.getByTestId('corporate-catalogue-empty')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('corporate-catalogue-clear'));
        await waitFor(() => {
            expect(screen.getByTestId(`catalogue-item-${sarItem.id}`)).toBeTruthy();
        });
    });

    it('answers a malformed programme address with a not-found rather than a failure', async () => {
        await renderBusiness(<CorporateCatalogueScreen programmeId="not-a-programme" />);
        expect(screen.getByTestId('corporate-catalogue-not-found')).toBeTruthy();
    });
});

describe('catalogue line detail', () => {
    it('prices every volume tier, and marks each one', async () => {
        await renderBusiness(<CatalogueItemScreen itemId={aedItem.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('catalogue-item-name')).toBeTruthy();
        });
        expect(screen.getByTestId(contractPriceTestId(`headline-${aedItem.id}`))).toBeTruthy();
        for (const tier of aedItem.volumeTiers) {
            expect(screen.getByTestId(contractPriceTestId(`tier-${String(tier.id)}`))).toBeTruthy();
        }
    });

    it('answers the standing-order control honestly rather than with a dead button', async () => {
        await renderBusiness(<CatalogueItemScreen itemId={aedItem.id} />);

        await waitFor(() => {
            expect(screen.getByTestId('prototype-action')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('prototype-action'));
        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });

    it('answers an unknown line with an error state rather than a blank screen', async () => {
        await renderBusiness(<CatalogueItemScreen itemId="catalogue-does-not-exist" />);
        await waitFor(() => {
            expect(screen.getByTestId('catalogue-item-detail-error')).toBeTruthy();
        });
    });
});

/* ══ the quotation builder ═════════════════════════════════════════════════════════════════════ */

describe('quotation builder', () => {
    it('states that it asks for a price and orders nothing', async () => {
        await renderBusiness(<QuotationBuilderScreen programmeId={String(aedItem.programmeId)} />);
        expect(screen.getByTestId('quotation-builder-scope')).toBeTruthy();
    });

    it('refuses an empty draft and says which rule it broke', async () => {
        await renderBusiness(<QuotationBuilderScreen programmeId={String(aedItem.programmeId)} />);

        await waitFor(() => {
            expect(screen.getByTestId(`quotation-line-${aedItem.id}`)).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('quotation-builder-submit'));
        await waitFor(() => {
            expect(screen.getByTestId('quotation-builder-lines-error')).toBeTruthy();
        });
    });

    it('seeds the line the catalogue sent it at that minimum order, and values it', async () => {
        await renderBusiness(
            <QuotationBuilderScreen
                programmeId={String(aedItem.programmeId)}
                initialItemId={aedItem.id}
            />,
        );

        await waitFor(() => {
            expect(screen.getByTestId(contractPriceTestId(`line-${aedItem.id}`))).toBeTruthy();
        });
        expect(screen.getByTestId(contractPriceTestId('draft-total-AED'))).toBeTruthy();
    });

    it('really files a quotation, and the store really has one more', async () => {
        const { repositories } = await renderBusiness(
            <QuotationBuilderScreen
                programmeId={String(aedItem.programmeId)}
                initialItemId={aedItem.id}
            />,
        );

        // Read the world through the store rather than the repository: awaiting a repository call
        // while the tree is mounted resolves a promise outside `act`, and React then reports
        // overlapping act scopes for the rest of the file.
        const before = repositories.prototypeStore.quotations().length;

        // The seeded line has to have arrived before the form is worth submitting.
        await waitFor(() => {
            expect(screen.getByTestId(contractPriceTestId(`line-${aedItem.id}`))).toBeTruthy();
        });

        await act(async () => {
            fireEvent.changeText(
                screen.getByTestId('quotation-builder-contact-name-input'),
                'Dana Fakhoury',
            );
            fireEvent.changeText(
                screen.getByTestId('quotation-builder-contact-email-input'),
                'dana@example.com',
            );
        });

        fireEvent.press(screen.getByTestId('quotation-builder-submit'));

        await waitFor(() => {
            expect(screen.getByTestId('quotation-builder-success')).toBeTruthy();
        });

        expect(repositories.prototypeStore.quotations()).toHaveLength(before + 1);
    });

    it('says out loud that a half-composed draft cannot be stored', async () => {
        await renderBusiness(<QuotationBuilderScreen programmeId={String(aedItem.programmeId)} />);

        expect(screen.getByTestId('quotation-builder-draft-note')).toBeTruthy();
        fireEvent.press(screen.getByTestId('prototype-action'));
        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });

    it('answers a malformed programme address with a not-found', async () => {
        await renderBusiness(<QuotationBuilderScreen programmeId="nonsense" />);
        expect(screen.getByTestId('quotation-builder-not-found')).toBeTruthy();
    });
});

/* ══ the quotation list ════════════════════════════════════════════════════════════════════════ */

describe('quotation list', () => {
    it('shows an unpriced request as awaiting a price rather than inventing a total', async () => {
        await renderBusiness(<QuotationsScreen />);

        const submitted = quotations.find((quotation) => quotation.state === 'submitted');
        expect(submitted).toBeDefined();
        if (submitted === undefined) return;
        const line = submitted.lines[0];
        expect(line).toBeDefined();
        if (line === undefined) return;

        await waitFor(() => {
            expect(screen.getByTestId(`quotation-${submitted.reference}`)).toBeTruthy();
        });
        expect(
            screen.getByTestId(
                `quotation-${submitted.reference}-line-${line.catalogueItemId}-unpriced`,
            ),
        ).toBeTruthy();
    });

    it('marks a priced quotation as carrying contract prices', async () => {
        await renderBusiness(<QuotationsScreen />);

        const quoted = quotations.find((quotation) => quotation.state === 'quoted');
        expect(quoted).toBeDefined();
        if (quoted === undefined) return;

        await waitFor(() => {
            expect(
                screen.getByTestId(contractPriceTestId(`quoted-total-${quoted.reference}`)),
            ).toBeTruthy();
        });
    });

    it('filters to a group and back', async () => {
        await renderBusiness(<QuotationsScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('quotations-filter-closed'));
        await waitFor(() => {
            expect(screen.getByTestId('quotations-empty')).toBeTruthy();
        });

        fireEvent.press(screen.getByTestId('quotations-clear-filter'));
        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });
    });

    it('offers accepting and exporting as prototype controls, because neither is on the contract', async () => {
        await renderBusiness(<QuotationsScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('quotations-list')).toBeTruthy();
        });
        const actions = screen.getAllByTestId('prototype-action');
        expect(actions.length).toBeGreaterThanOrEqual(2);

        fireEvent.press(actions[0]!);
        await waitFor(() => {
            expect(screen.getByTestId('prototype-notice')).toBeTruthy();
        });
    });
});

/* ══ the partner workspace ═════════════════════════════════════════════════════════════════════ */

describe('partner workspace', () => {
    it('shows quantities and lead times, and no contract price anywhere', async () => {
        await renderBusiness(<PartnerCommitmentsScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('partner-commitment-list')).toBeTruthy();
        });

        expect(screen.getByTestId('partner-price-privacy')).toBeTruthy();
        expect(screen.getByTestId('partner-source-note')).toBeTruthy();
        expect(screen.queryAllByTestId(/^contract-price-/)).toEqual([]);
    });

    it('narrows the commitments to one kitchen and back', async () => {
        await renderBusiness(<PartnerCommitmentsScreen />);

        await waitFor(() => {
            expect(screen.getByTestId('partner-commitment-list')).toBeTruthy();
        });

        const before = screen.queryAllByTestId(/^partner-commitment-.+-quantity$/).length;
        expect(before).toBeGreaterThan(0);

        fireEvent.press(screen.getByTestId(`partner-kitchen-${String(sarItem.kitchenId)}`));
        await waitFor(() => {
            expect(
                screen.queryAllByTestId(/^partner-commitment-.+-quantity$/).length,
            ).toBeLessThanOrEqual(before);
        });

        fireEvent.press(screen.getByTestId('partner-kitchen-all'));
        await waitFor(() => {
            expect(screen.queryAllByTestId(/^partner-commitment-.+-quantity$/)).toHaveLength(
                before,
            );
        });
    });

    it('groups the schedule by date and explains where the dates come from', async () => {
        await renderBusiness(<PartnerScheduleScreen />);

        expect(screen.getByTestId('partner-schedule-derivation')).toBeTruthy();
        await waitFor(() => {
            expect(screen.getByTestId('partner-schedule-days')).toBeTruthy();
        });
        expect(screen.queryAllByTestId(/^contract-price-/)).toEqual([]);
    });
});
