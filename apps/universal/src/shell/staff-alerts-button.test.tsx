import type { StaffAlert, StaffAlertList } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { queryKeys } from '../data/query-keys.ts';
import { playAlertTone } from '../features/kds/alert-tone.ts';
import { ORDER_SUPERVISE_PERMISSION } from '../features/kitchen-admin/entity-registry.ts';
import type { ExpoRouterMock } from '../testing/expo-router-mock.ts';
import { kitchenManagerSession, testActiveContext } from '../testing/session-fixtures.ts';
import { renderStubScreen } from '../testing/stub-screen.tsx';
import { StaffAlertsButton, freshAlerts } from './staff-alerts-button.tsx';

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/kitchen/stock',
    }),
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

jest.mock('../features/kds/alert-tone.ts', () => ({ playAlertTone: jest.fn() }));

function alert(id: string, overrides: Partial<StaffAlert> = {}): StaffAlert {
    return {
        id,
        type: 'delivery_failed',
        orderId: `order-${id}` as OrderId,
        orderNumber: `H-${id}`,
        severe: false,
        readAt: null,
        createdAt: '2026-11-02T09:00:00Z',
        ...overrides,
    };
}

function list(...alerts: readonly StaffAlert[]): StaffAlertList {
    return { alerts, unreadCount: alerts.filter((row) => row.readAt === null).length };
}

const SUPERVISOR = kitchenManagerSession({
    activeContext: testActiveContext({ permissions: [ORDER_SUPERVISE_PERMISSION] }),
});

/** Renders the bell over a list a test can change, and a way to make the next poll happen. */
async function renderBell(first: StaffAlertList, session = SUPERVISOR) {
    let current = first;
    const harness = await renderStubScreen(<StaffAlertsButton />, {
        session,
        repositories: {
            staffAlerts: {
                listAlerts: async () => current,
                markAlertRead: async () => undefined,
                markAllAlertsRead: async () => undefined,
            },
        },
    });
    return {
        ...harness,
        poll: async (next: StaffAlertList) => {
            current = next;
            await act(async () => {
                await harness.queryClient.refetchQueries({
                    queryKey: queryKeys.staffAlerts.list(),
                });
            });
        },
    };
}

beforeEach(() => {
    routerMock.__reset();
    jest.mocked(playAlertTone).mockClear();
});

describe('the alerts bell', () => {
    it('shows the unread count', async () => {
        await renderBell(
            list(alert('1'), alert('2'), alert('3', { readAt: '2026-11-02T10:00:00Z' })),
        );
        expect(await screen.findByTestId('staff-alerts-count')).toHaveTextContent('2');
    });

    it('shows no count when nothing is unread', async () => {
        await renderBell(list());
        expect(await screen.findByTestId('staff-alerts-button')).toBeTruthy();
        expect(screen.queryByTestId('staff-alerts-count')).toBeNull();
    });

    it('is hidden without the permission, and asks for nothing', async () => {
        const { repositories } = await renderBell(
            list(alert('1')),
            kitchenManagerSession({ activeContext: testActiveContext({ permissions: [] }) }),
        );
        expect(screen.queryByTestId('staff-alerts-button')).toBeNull();
        expect(repositories.staffAlerts.listAlerts).not.toHaveBeenCalled();
    });

    it('words an alert by its type and order number, and calls a severe allergy severe', async () => {
        await renderBell(
            list(
                alert('1', { type: 'allergy_order' }),
                alert('2', { type: 'allergy_order', severe: true }),
            ),
        );
        fireEvent.press(await screen.findByTestId('staff-alerts-button'));
        expect(await screen.findByText('New order H-1 has an allergy on it')).toBeTruthy();
        expect(screen.getByText('New order H-2 has a severe allergy on it')).toBeTruthy();
    });

    it('links an item to its order, marks it read and shuts the panel', async () => {
        const { repositories } = await renderBell(list(alert('1')));
        await screen.findByTestId('staff-alerts-count');
        fireEvent.press(screen.getByTestId('staff-alerts-button'));

        await act(async () => {
            fireEvent.press(await screen.findByTestId('staff-alerts-panel-open'));
        });

        expect(routerMock.__push).toHaveBeenCalledWith('/kitchen/orders?order=order-1');
        expect(repositories.staffAlerts.markAlertRead).toHaveBeenCalledWith('1');
        expect(screen.queryByTestId('staff-alerts-panel')).toBeNull();
    });

    it('marks everything read from the panel', async () => {
        const { repositories } = await renderBell(list(alert('1'), alert('2')));
        await screen.findByTestId('staff-alerts-count');
        fireEvent.press(screen.getByTestId('staff-alerts-button'));

        await act(async () => {
            fireEvent.press(await screen.findByTestId('staff-alerts-mark-all'));
        });

        expect(repositories.staffAlerts.markAllAlertsRead).toHaveBeenCalledTimes(1);
    });

    it('does not sound for rows already unread on load', async () => {
        await renderBell(list(alert('1'), alert('2')));
        await screen.findByTestId('staff-alerts-count');

        expect(playAlertTone).not.toHaveBeenCalled();
        expect(screen.queryByTestId('staff-alerts-toast')).toBeNull();
    });

    it('sounds for a row newer than the last seen', async () => {
        const { poll } = await renderBell(list(alert('1')));
        await screen.findByTestId('staff-alerts-count');

        await poll(list(alert('2'), alert('1')));

        await waitFor(() => {
            expect(playAlertTone).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByTestId('staff-alerts-toast')).toHaveTextContent(
            'Delivery failed for order H-2',
        );
    });

    it('sounds for the first row of a bell that loaded empty', async () => {
        const { poll } = await renderBell(list());
        fireEvent.press(await screen.findByTestId('staff-alerts-button'));
        await screen.findByTestId('staff-alerts-panel-empty');

        await poll(list(alert('1')));

        await waitFor(() => {
            expect(playAlertTone).toHaveBeenCalledTimes(1);
        });
    });

    it('sounds once for several rows in one poll, and not again for the same rows', async () => {
        const { poll } = await renderBell(list(alert('1')));
        await screen.findByTestId('staff-alerts-count');

        const next = list(alert('3'), alert('2'), alert('1'));
        await poll(next);
        await poll({ ...next });

        await waitFor(() => {
            expect(playAlertTone).toHaveBeenCalledTimes(1);
        });
        expect(await screen.findByTestId('staff-alerts-toast')).toHaveTextContent('2 new alerts');
    });
});

describe('freshAlerts', () => {
    it('finds nothing on the first look, which only sets the mark', () => {
        expect(freshAlerts([alert('1')], null)).toEqual([]);
    });

    it('finds a row not seen before, including one created in the same second', () => {
        const old = alert('1');
        const sameSecond = alert('2', { createdAt: old.createdAt });
        expect(freshAlerts([sameSecond, old], new Set(['1']))).toEqual([sameSecond]);
    });

    it('leaves out a new row already read elsewhere', () => {
        const read = alert('2', { readAt: '2026-11-02T10:00:00Z' });
        expect(freshAlerts([read], new Set(['1']))).toEqual([]);
    });
});
