import { throwFailure, validationFailure } from '@healthy360/api-client/contracts';
import type {
    AdminEntityMeta,
    DeliveryWindow,
    DeliveryZoneAdmin,
    ServiceArea,
} from '@healthy360/api-client/contracts';
import {
    DeliveryWindowId,
    DeliveryZoneId,
    KitchenBranchId,
    KitchenId,
    ServiceAreaId,
} from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import {
    TEST_BRANCH_ID,
    kitchenManagerSession,
    testBranch,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { page } from '../../testing/stub-repositories.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { DeliveryZoneEditScreen } from './screens/delivery-zone-edit-screen.tsx';

/*
 * The delivery-zone editor's way through, for a reader who is led rather than left to explore:
 * Save is in the header on every step, a refused save opens the step that holds the problem and
 * says it under the field, the step's tab counts it, and Cancel steps back like the browser does.
 */

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
    __esModule: true,
    default: () => ({ width: 1280, height: 900, scale: 1, fontScale: 1 }),
}));

jest.mock('expo-router', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        back: jest.fn(),
        canGoBack: jest.fn(() => true),
        dismissTo: jest.fn(),
        setParams: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        __esModule: true,
        useRouter: () => router,
        usePathname: () => '/kitchen/delivery-zones',
        useLocalSearchParams: () => ({}),
        Redirect: () => null,
        Link: ({ children }: { children: ReactNode }) => children,
        Slot: () => null,
        Stack: () => null,
        __router: router,
    };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __router: router } = require('expo-router') as {
    __router: {
        push: jest.Mock;
        replace: jest.Mock;
        back: jest.Mock;
        canGoBack: jest.Mock;
        dismissTo: jest.Mock;
    };
};

beforeEach(() => {
    router.push.mockClear();
    router.replace.mockClear();
    router.back.mockClear();
    router.dismissTo.mockClear();
    router.canGoBack.mockReset();
    router.canGoBack.mockReturnValue(true);
});

function untilVisible(testID: string) {
    return waitFor(
        () => {
            expect(screen.getByTestId(testID)).toBeTruthy();
        },
        { timeout: 20_000 },
    );
}

/** A step tab's red count. Hidden from assistive technology: the tab's own name says it. */
function pill(tabTestID: string) {
    return screen.getByTestId(`${tabTestID}-issues`, { includeHiddenElements: true });
}

async function press(testID: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const KITCHEN_ID = KitchenId.unsafe('01935f6d-0000-7000-8000-00000000a001');
const BRANCH_ID = KitchenBranchId.unsafe(String(TEST_BRANCH_ID));

function meta(overrides: Partial<AdminEntityMeta> = {}): AdminEntityMeta {
    return {
        lockVersion: 2,
        status: 'published',
        updatedAt: '2026-08-01T09:00:00.000Z',
        updatedByName: 'Rana Haddad',
        ...overrides,
    };
}

const AREA: ServiceArea = {
    id: ServiceAreaId.unsafe('01935f6d-0000-7000-8000-00000000f001'),
    name: { en: 'District 1', ar: 'حي 1' },
    countryCode: 'AE',
    parentName: { en: 'Dubai', ar: 'دبي' },
    isActive: true,
};

const SECOND_AREA: ServiceArea = {
    ...AREA,
    id: ServiceAreaId.unsafe('01935f6d-0000-7000-8000-00000000f002'),
    name: { en: 'District 2', ar: 'حي 2' },
};

const WINDOW: DeliveryWindow = {
    id: DeliveryWindowId.unsafe('01935f6d-0000-7000-8000-000000010001'),
    code: 'window-1',
    label: { en: 'Morning', ar: 'صباح' },
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    startsAt: '08:00',
    endsAt: '11:00',
    capacity: null,
    isActive: true,
    archivedAt: null,
    zoneIds: [],
};

const ZONE: DeliveryZoneAdmin = {
    id: DeliveryZoneId.unsafe('01935f6d-0000-7000-8000-00000000e001'),
    meta: meta(),
    name: { en: 'Marina ring', ar: 'حلقة المارينا' },
    kitchenId: KITCHEN_ID,
    branchIds: [BRANCH_ID],
    areas: [AREA],
    deliveryFeeMinor: 1500,
    minimumOrderMinor: 5000,
    currency: 'USD',
    estimatedMinutes: 45,
    windowIds: [WINDOW.id],
};

function kitchenSession() {
    return kitchenManagerSession({
        memberships: [testMembership({ branches: [testBranch()] })],
    });
}

function reads() {
    return {
        getZone: async () => ZONE,
        listZones: async () => page([ZONE]),
        listPriceLists: async () => page([]),
        listServiceAreas: async () => page([AREA, SECOND_AREA]),
        listDeliveryWindows: async () => [WINDOW],
    };
}

/* ── the tests ────────────────────────────────────────────────────────────────────────────────── */

describe('the delivery-zone editor leads the reader', () => {
    it('draws no step bar, and offers Save the zone on the first step', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: reads() },
        });
        await untilVisible('kitchen-zone-details');

        expect(screen.getByTestId('kitchen-zone-editor-screen-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-zone-editor-screen-steps-nav')).toBeNull();
        expect(screen.queryByTestId('kitchen-zone-editor-screen-steps-nav-next')).toBeNull();
    });

    it('opens the details again when the server refuses a field, and says so under it', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...reads(),
                    updateZone: () =>
                        throwFailure(
                            validationFailure({ delivery_fee_minor: ['The fee is too large.'] }),
                        ),
                },
            },
        });
        await untilVisible('kitchen-zone-fee-input');

        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-fee-input'), '99999');
        });
        // Saved from the last step, as somebody who walked the whole form would.
        await press('kitchen-zone-editor-screen-steps-windows');
        await untilVisible('kitchen-zone-windows');
        await press('kitchen-zone-editor-screen-save');

        await untilVisible('kitchen-zone-fee-error');
        expect(screen.getByTestId('kitchen-zone-details')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-zone-windows')).toBeNull();
        expect(screen.getByTestId('kitchen-zone-fee-error')).toHaveTextContent(
            'The fee is too large.',
        );
        expect(pill('kitchen-zone-editor-screen-steps-zone')).toHaveTextContent('1');
    });

    it('opens the areas when their write is refused, and counts it on that tab', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...reads(),
                    setZoneAreas: () =>
                        throwFailure(validationFailure({ service_area_ids: ['Not here.'] })),
                },
            },
        });
        await press('kitchen-zone-editor-screen-steps-areas');
        await untilVisible(`kitchen-zone-area-picker-option-${String(SECOND_AREA.id)}-control`);
        await act(async () => {
            fireEvent.press(
                screen.getByTestId(
                    `kitchen-zone-area-picker-option-${String(SECOND_AREA.id)}-control`,
                ),
            );
        });
        // Back on the first step before saving: the refusal is about the areas, not here.
        await press('kitchen-zone-editor-screen-steps-zone');
        await untilVisible('kitchen-zone-details');
        await press('kitchen-zone-editor-screen-save');

        await untilVisible('kitchen-zone-areas-save-error');
        expect(screen.queryByTestId('kitchen-zone-details')).toBeNull();
        expect(pill('kitchen-zone-editor-screen-steps-areas')).toHaveTextContent('1');
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(ZONE.id)} />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: reads() },
        });
        await press('kitchen-zone-editor-screen-back');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('opens the list when there is nothing to go back to', async () => {
        router.canGoBack.mockReturnValue(false);
        await renderStubScreen(<DeliveryZoneEditScreen zone="not-a-uuid" />, {
            session: kitchenSession(),
            repositories: { kitchenAdmin: reads() },
        });
        await press('kitchen-zone-not-found-back');

        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith('/kitchen/delivery-zones');
    });

    it('returns to where the reader came from once the zone is saved', async () => {
        await renderStubScreen(<DeliveryZoneEditScreen zone={String(ZONE.id)} />, {
            session: kitchenSession(),
            repositories: {
                kitchenAdmin: {
                    ...reads(),
                    updateZone: async (_id, request) => ({
                        ...ZONE,
                        estimatedMinutes: request.estimatedMinutes ?? null,
                        meta: meta({ lockVersion: request.lockVersion + 1 }),
                    }),
                },
            },
        });
        await untilVisible('kitchen-zone-estimated-input');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-zone-estimated-input'), '30');
        });
        await press('kitchen-zone-editor-screen-save');

        await waitFor(() => {
            expect(router.back).toHaveBeenCalledTimes(1);
        });
        expect(router.push).not.toHaveBeenCalledWith('/kitchen/delivery-zones');
    });
});
