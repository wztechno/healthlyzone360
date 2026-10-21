import type {
    CorporateProgramme,
    Quotation,
    QuotationState,
} from '@healthy360/api-client/contracts';
import { CorporateProgrammeId, QuotationId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text as RNText } from 'react-native';

import {
    ORGANISATION_OWNER_PERMISSIONS,
    TEST_ORGANISATION_ID,
    testActiveContext,
    testMeResponse,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import type { RepositoryOverrides } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { TrailLeafProvider, useTrailLeaf } from '../../shell/area-trail.tsx';
import { corporateRoute, useCorporateNavigation, useCorporateTrail } from './corporate-chrome.tsx';

let mockPathname = '/corporate';
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
    usePathname: () => mockPathname,
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The corporate area's rail and trail — the kitchen's desk chrome with the corporate destinations.
 *
 * The rail draws one catalogue per programme, because a negotiated catalogue is scoped to its
 * programme by the contract; and the Quotations badge counts what is waiting on the buyer — the
 * `quoted` state — and nothing else.
 */

const STAFF_ID = CorporateProgrammeId.unsafe('01920001-0000-7000-8000-000000000001');
const WHOLESALE_ID = CorporateProgrammeId.unsafe('01920001-0000-7000-8000-000000000002');

function programme(id: CorporateProgrammeId, name: string): CorporateProgramme {
    return {
        id,
        organisationId: TEST_ORGANISATION_ID,
        name,
        summary: `${name} summary`,
        kitchenIds: [],
        deliveryLocations: [],
        headcount: 10,
        employeeSubsidy: null,
        startsAt: '2026-01-01',
        endsAt: null,
        accountManagerName: null,
        isActive: true,
    };
}

function quotation(ordinal: number, state: QuotationState): Quotation {
    return {
        id: QuotationId.unsafe(`01920002-0000-7000-8000-${String(ordinal).padStart(12, '0')}`),
        programmeId: STAFF_ID,
        state,
        reference: `H360-Q-${String(ordinal)}`,
        lines: [],
        requestedTotal: null,
        requestedDeliveryDate: null,
        recurring: false,
        note: null,
        requestedAt: '2026-09-01T09:00:00Z' as Quotation['requestedAt'],
        respondedAt: null,
        expiresAt: null,
        contactName: null,
        contactEmail: null,
        declineReason: null,
        lockVersion: 0,
        orderId: null,
        orderNumber: null,
        orders: [],
    };
}

/** A buyer signed into their organisation: every `/b2b/*` read waits until one is known. */
function buyerSession() {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext({ permissions: ORGANISATION_OWNER_PERMISSIONS }),
    });
}

const overrides: RepositoryOverrides = {
    business: {
        listCorporateProgrammes: async () => [
            programme(STAFF_ID, 'Cedar Clinic staff meals'),
            programme(WHOLESALE_ID, 'Harbour wholesale'),
        ],
        listQuotations: async () =>
            page([
                quotation(1, 'submitted'),
                quotation(2, 'quoted'),
                quotation(3, 'quoted'),
                quotation(4, 'accepted'),
            ]),
    },
};

/** Renders the rail's items as text, so the list can be asserted without a shell. */
function RailProbe() {
    const navigation = useCorporateNavigation();
    return (
        <>
            {navigation.map((item) => (
                <RNText key={item.key} testID={`probe-${item.key}`}>
                    {`${item.group ?? '(ungrouped)'}|${item.label}|${
                        item.active === true ? 'active' : ''
                    }`}
                </RNText>
            ))}
            {navigation.find((item) => item.key === 'corporate-quotations')?.badge}
        </>
    );
}

/** Renders the trail as text, and names a leaf the way a record page does. */
function TrailProbe({
    leaf,
    onBack,
}: {
    readonly leaf?: string;
    readonly onBack?: (() => void) | undefined;
}) {
    return (
        <TrailLeafProvider>
            <Leaf leaf={leaf ?? null} onBack={onBack} />
            <Crumbs />
        </TrailLeafProvider>
    );
}

function Leaf({
    leaf,
    onBack,
}: {
    readonly leaf: string | null;
    readonly onBack?: (() => void) | undefined;
}) {
    useTrailLeaf(leaf, onBack);
    return null;
}

function Crumbs() {
    const crumbs = useCorporateTrail();
    return (
        <>
            <RNText testID="probe-trail">{crumbs.map((crumb) => crumb.label).join(' › ')}</RNText>
            {crumbs.map((crumb) =>
                crumb.onPress === undefined ? null : (
                    <Pressable
                        key={crumb.key}
                        testID={`probe-crumb-${crumb.key}`}
                        onPress={crumb.onPress}
                    />
                ),
            )}
        </>
    );
}

beforeEach(() => {
    mockPathname = '/corporate';
    mockPush.mockClear();
});

describe('corporateRoute', () => {
    it('reads the area off the path', () => {
        expect(corporateRoute('/corporate')).toEqual({ kind: 'home' });
        expect(corporateRoute(`/corporate/catalogue/${String(STAFF_ID)}`)).toEqual({
            kind: 'catalogue',
            programmeId: String(STAFF_ID),
        });
        expect(corporateRoute('/corporate/items/catalogue-staff-lunch-box')).toEqual({
            kind: 'item',
        });
        expect(corporateRoute('/corporate/quotations')).toEqual({ kind: 'quotations' });
        expect(corporateRoute('/corporate/quotations/new')).toEqual({ kind: 'new-quotation' });
        expect(corporateRoute('/corporate/account/wind-down')).toEqual({ kind: 'wind-down' });
    });
});

describe('useCorporateNavigation', () => {
    it('draws one catalogue per programme, under Purchasing, and lights the open one', async () => {
        mockPathname = `/corporate/catalogue/${String(WHOLESALE_ID)}`;
        await renderStubScreen(<RailProbe />, {
            session: buyerSession(),
            repositories: overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId(`probe-catalogue-${String(STAFF_ID)}`)).toBeTruthy();
        });
        expect(screen.getByTestId('probe-corporate-overview')).toHaveTextContent(
            /^\(ungrouped\)\|Overview\|$/,
        );
        expect(screen.getByTestId(`probe-catalogue-${String(STAFF_ID)}`)).toHaveTextContent(
            /^Purchasing\|Cedar Clinic staff meals\|$/,
        );
        expect(screen.getByTestId(`probe-catalogue-${String(WHOLESALE_ID)}`)).toHaveTextContent(
            /^Purchasing\|Harbour wholesale\|active$/,
        );
    });

    it('badges Quotations with the count waiting on the buyer, and only that', async () => {
        await renderStubScreen(<RailProbe />, {
            session: buyerSession(),
            repositories: overrides,
        });

        // Two `quoted` of four: the submitted one waits on the account manager, the accepted one
        // on nobody.
        await waitFor(() => {
            expect(screen.getByTestId('nav-corporate-quotations-badge')).toHaveTextContent('2');
        });
    });
});

describe('useCorporateTrail', () => {
    it('draws nothing on the overview, where a trail would only name the page', async () => {
        await renderStubScreen(<TrailProbe />, {
            session: buyerSession(),
            repositories: overrides,
        });

        expect(screen.getByTestId('probe-trail')).toHaveTextContent(/^$/);
    });

    it('names a catalogue by its programme', async () => {
        mockPathname = `/corporate/catalogue/${String(STAFF_ID)}`;
        await renderStubScreen(<TrailProbe />, {
            session: buyerSession(),
            repositories: overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('probe-trail')).toHaveTextContent(
                'Overview › Cedar Clinic staff meals',
            );
        });
    });

    it('grows a leaf for an open record, and makes the crumb above it the way back', async () => {
        mockPathname = '/corporate/quotations';
        const onBack = jest.fn();
        await renderStubScreen(<TrailProbe leaf="H360-Q-2" onBack={onBack} />, {
            session: buyerSession(),
            repositories: overrides,
        });

        await waitFor(() => {
            expect(screen.getByTestId('probe-trail')).toHaveTextContent(
                'Overview › Quotations › H360-Q-2',
            );
        });
        fireEvent.press(screen.getByTestId('probe-crumb-quotations'));
        expect(onBack).toHaveBeenCalledTimes(1);

        fireEvent.press(screen.getByTestId('probe-crumb-home'));
        expect(mockPush).toHaveBeenCalledWith('/corporate');
    });
});
