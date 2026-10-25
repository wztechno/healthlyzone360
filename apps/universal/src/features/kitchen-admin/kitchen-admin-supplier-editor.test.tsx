import { ApiError, validationFailure } from '@healthy360/api-client';
import type { SupplierContact, SupplierDetail } from '@healthy360/api-client/contracts';
import { SupplierContactId, SupplierId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { kitchenManagerSession } from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { supplierContactRowTestId } from './ops-format.ts';
import { SupplierDetailScreen } from './screens/supplier-detail-screen.tsx';

/*
 * The supplier record's way through, for a reader who is led rather than left to explore: Save is
 * in the header on every step and there is no Previous / Next bar, a refused save opens the step
 * that holds the problem and says it under the field, the step's tab counts it, and Cancel steps
 * back like the browser does.
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
        usePathname: () => '/kitchen/suppliers',
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
        { timeout: 10_000 },
    );
}

async function press(testID: string) {
    await untilVisible(testID);
    await act(async () => {
        fireEvent.press(screen.getByTestId(testID));
    });
}

/** A step tab's red count. Hidden from assistive technology: the tab's own name says it. */
function stepPill(step: 'details' | 'contacts' | 'items') {
    return screen.queryByTestId(`kitchen-supplier-screen-steps-${step}-issues`, {
        includeHiddenElements: true,
    });
}

/* ── the world ────────────────────────────────────────────────────────────────────────────────── */

const SUPPLIER_ID = SupplierId.unsafe('01935f6d-0000-7000-8000-00000000b001');

const CONTACT: SupplierContact = {
    id: SupplierContactId.unsafe('01935f6d-0000-7000-8000-00000000c001'),
    name: 'Samir Haddad',
    roleTitle: null,
    email: null,
    phone: '+961 3 111 222',
    whatsappPhone: null,
    isPrimary: true,
    displayOrder: 0,
};

const GULF: SupplierDetail = {
    id: SUPPLIER_ID,
    code: 'GULF-01',
    name: { en: 'Gulf Fresh Trading', ar: 'الخليج الطازج للتجارة' },
    currencyCode: 'USD',
    contactEmail: null,
    contactPhone: null,
    address: null,
    paymentTerms: 'Net 30',
    leadTimeDays: 2,
    notes: null,
    archivedAt: null,
    contactCount: 1,
    suppliedItemCount: 0,
    primaryContact: { name: 'Samir Haddad', phone: '+961 3 111 222' },
    contacts: [CONTACT],
    suppliedItems: [],
    costsRedacted: false,
};

/* ── the tests ────────────────────────────────────────────────────────────────────────────────── */

describe('the supplier record leads the reader', () => {
    it('draws no step bar, and offers Save on the first step', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(SUPPLIER_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getSupplier: async () => GULF } },
        });
        await untilVisible('kitchen-supplier-details');

        expect(screen.getByTestId('kitchen-supplier-screen-save')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-supplier-screen-steps-nav')).toBeNull();
        expect(screen.queryByTestId('kitchen-supplier-screen-steps-nav-next')).toBeNull();
    });

    it('opens the details when the server refuses a field, and says so under it', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(SUPPLIER_ID)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getSupplier: async () => GULF,
                    updateSupplier: async () => {
                        throw new ApiError(
                            validationFailure({
                                contact_email: ['The email field must be a valid email address.'],
                            }),
                        );
                    },
                },
            },
        });
        await untilVisible('kitchen-supplier-email-input');
        await act(async () => {
            fireEvent.changeText(screen.getByTestId('kitchen-supplier-email-input'), 'nope');
        });
        // Saved from the last step: the refused field is two steps back.
        await press('kitchen-supplier-screen-steps-items');
        await untilVisible('kitchen-supplier-supplied-items');
        await press('kitchen-supplier-screen-save');

        await untilVisible('kitchen-supplier-email-error');
        expect(screen.getByTestId('kitchen-supplier-email-error')).toHaveTextContent(
            'The email field must be a valid email address.',
        );
        expect(screen.getByTestId('kitchen-supplier-details')).toBeTruthy();
        expect(screen.queryByTestId('kitchen-supplier-supplied-items')).toBeNull();
        expect(stepPill('details')).toHaveTextContent('1');
    });

    it('marks the contact card the server refused and counts it on the Contacts step', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(SUPPLIER_ID)} />, {
            session: kitchenManagerSession(),
            repositories: {
                kitchenOps: {
                    getSupplier: async () => GULF,
                    replaceSupplierContacts: async () => {
                        throw new ApiError(
                            validationFailure({
                                'contacts.0.phone': ['That number is not valid.'],
                            }),
                        );
                    },
                },
            },
        });
        await press('kitchen-supplier-screen-steps-contacts');
        const card = supplierContactRowTestId(String(CONTACT.id));
        await untilVisible(`${card}-phone-input`);
        await act(async () => {
            fireEvent.changeText(screen.getByTestId(`${card}-phone-input`), '12');
        });
        await press('kitchen-supplier-contacts-save');

        await untilVisible(`${card}-phone-error`);
        expect(screen.getByTestId(`${card}-phone-error`)).toHaveTextContent(
            'That number is not valid.',
        );
        expect(stepPill('contacts')).toHaveTextContent('1');
        // Placed on the card, so the section's callout has nothing left to say.
        expect(screen.queryByTestId('kitchen-supplier-contacts-error')).toBeNull();
    });

    it('goes back a step on Cancel instead of opening a fresh list', async () => {
        await renderStubScreen(<SupplierDetailScreen supplier={String(SUPPLIER_ID)} />, {
            session: kitchenManagerSession(),
            repositories: { kitchenOps: { getSupplier: async () => GULF } },
        });
        await press('kitchen-supplier-screen-back');

        expect(router.back).toHaveBeenCalledTimes(1);
        expect(router.push).not.toHaveBeenCalled();
    });

    it('opens the list from a broken link when there is nothing to go back to', async () => {
        router.canGoBack.mockReturnValue(false);
        await renderStubScreen(<SupplierDetailScreen supplier="not-a-uuid" />, {
            session: kitchenManagerSession(),
        });
        await press('kitchen-supplier-not-found-back');

        expect(router.back).not.toHaveBeenCalled();
        expect(router.replace).toHaveBeenCalledWith('/kitchen/suppliers');
    });
});
