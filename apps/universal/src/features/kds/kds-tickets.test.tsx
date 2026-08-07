import { createMemoryTokenStore } from '@healthy360/api-client';
import { createMockRepositories } from '@healthy360/api-client/mock';
import { MOCK_SCENARIOS } from '@healthy360/api-client/mock';
import type { MockRepositories } from '@healthy360/api-client/mock';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { AppProviders } from '../../providers.tsx';
import { TEST_METRICS, createTestQueryClient } from '../../testing/render-screen.tsx';
import { KdsTicketsScreen } from './kds-tickets-screen.tsx';

const KITCHEN_MANAGER = MOCK_SCENARIOS['multi-org-dietitian'].primaryEmail;

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/kds',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Signs the kitchen manager into Verdant Kitchen — same boilerplate as `kitchen-orders.test.tsx`,
 * with one thing worth naming: the `kds` area requires a *branch* as well as an organisation
 * (`permissions/requirements.ts`), and this membership carries exactly one, so `setContext` applies
 * it without a picker. That branch is the one the order fixture world seeds its rows against, which
 * is what makes the board's `branchId` filter return anything at all.
 */
async function signIn(): Promise<{
    readonly repositories: MockRepositories;
    readonly tokenStore: ReturnType<typeof createMemoryTokenStore>;
    /** The branch the context applied — what the board scopes itself to. */
    readonly branchId: string;
}> {
    const tokenStore = createMemoryTokenStore();
    const repositories = createMockRepositories({
        scenario: 'multi-org-dietitian',
        latencyMs: 1,
        tokenStore,
    });
    await repositories.auth.login({ email: KITCHEN_MANAGER, password: 'password' });
    const me = await repositories.session.me();
    const membership = me.memberships.find(
        (candidate) =>
            candidate.organisation.slug === 'verdant-kitchen' && candidate.status === 'active',
    );
    if (membership === undefined) throw new Error('missing membership');
    const context = await repositories.context.setContext({
        organisationId: membership.organisation.id,
    });
    if (context.branchId == null) throw new Error('the fixture world applied no branch');
    return { repositories, tokenStore, branchId: String(context.branchId) };
}

function renderBoard(
    repositories: MockRepositories,
    tokenStore: ReturnType<typeof createMemoryTokenStore>,
) {
    return render(
        <AppProviders
            initialMetrics={TEST_METRICS}
            repositories={repositories}
            tokenStore={tokenStore}
            queryClient={createTestQueryClient()}
            initialOnline
        >
            <KdsTicketsScreen />
        </AppProviders>,
    );
}

function ticketId(orderId: string): string {
    return `kds-ticket-${orderId}`;
}

describe('kds ticket board', () => {
    it('shows this branch and unattributed work, and nothing else', async () => {
        const { repositories, tokenStore, branchId } = await signIn();
        await renderBoard(repositories, tokenStore);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const orders = repositories.kitchenOrdersStore.orders();
        const unattributed = orders.find(
            (order) => order.status === 'placed' && order.branchId === null,
        );
        const otherBranch = orders.find(
            (order) =>
                order.status === 'placed' &&
                order.branchId !== null &&
                String(order.branchId) !== branchId,
        );
        const confirmed = orders.find((order) => order.status === 'confirmed');
        const cancelled = orders.find((order) => order.status === 'cancelled');
        if (
            unattributed === undefined ||
            otherBranch === undefined ||
            confirmed === undefined ||
            cancelled === undefined
        ) {
            throw new Error('the fixture world no longer spans the branch attributions under test');
        }

        // The whole point of the client-side rule: an order delivered through an organisation-wide
        // zone names no kitchen, and it is still food somebody has to cook.
        expect(screen.getByTestId(ticketId(String(unattributed.id)))).toBeTruthy();
        // This branch's own confirmed work is on the board too.
        expect(String(confirmed.branchId)).toBe(branchId);
        expect(screen.getByTestId(ticketId(String(confirmed.id)))).toBeTruthy();
        // A ticket another kitchen has been given belongs on that kitchen's wall, not this one.
        expect(screen.queryByTestId(ticketId(String(otherBranch.id)))).toBeNull();
        // A cancelled order is work nobody is doing — it belongs in the order book, not on a wall.
        expect(screen.queryByTestId(ticketId(String(cancelled.id)))).toBeNull();

        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('1');
        expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('1');

        // The Ready column is today's own work, by `fulfilledAt`: the seeded fulfilled order was
        // bumped on a previous day, so it is off the board rather than lingering forever.
        expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('0');
        expect(screen.getByTestId('kds-column-done-empty')).toBeTruthy();
    });

    it('starts an unattributed ticket, which moves it into preparation', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderBoard(repositories, tokenStore);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The one placed ticket on this board is the branchless one — so this also proves that
        // unattributed work is not merely visible but actionable.
        const placed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'placed' && order.branchId === null);
        if (placed === undefined) throw new Error('no unattributed placed order in the fixture');

        fireEvent.press(screen.getByTestId(`${ticketId(String(placed.id))}-start`));

        // The mock store enforces the real machine, so this is the transition itself.
        await waitFor(() => {
            const after = repositories.kitchenOrdersStore
                .orders()
                .find((order) => order.id === placed.id);
            expect(after?.status).toBe('confirmed');
            expect(after?.lockVersion).toBe(placed.lockVersion + 1);
        });

        await waitFor(() => {
            expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('2');
        });
        expect(screen.getByTestId('kds-column-incoming-count')).toHaveTextContent('0');
        // Start is gone and Ready has taken its place on the same ticket.
        expect(screen.getByTestId(`${ticketId(String(placed.id))}-ready`)).toBeTruthy();
        expect(screen.queryByTestId(`${ticketId(String(placed.id))}-start`)).toBeNull();
    });

    it('marks a confirmed ticket ready, which lands it in the done column for today', async () => {
        const { repositories, tokenStore } = await signIn();
        await renderBoard(repositories, tokenStore);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-preparing')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const confirmed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'confirmed');
        if (confirmed === undefined) throw new Error('no confirmed order in the fixture world');

        fireEvent.press(screen.getByTestId(`${ticketId(String(confirmed.id))}-ready`));

        await waitFor(() => {
            const after = repositories.kitchenOrdersStore
                .orders()
                .find((order) => order.id === confirmed.id);
            expect(after?.status).toBe('fulfilled');
        });

        // `fulfilledAt` is stamped now, so the ticket crosses into Ready rather than disappearing —
        // which is the whole reason the done column is bounded by the bump and not by the requested
        // delivery day (the seeded order is cooked for a day that is not today).
        await waitFor(() => {
            expect(screen.getByTestId('kds-column-done-count')).toHaveTextContent('1');
        });
        expect(screen.getByTestId(ticketId(String(confirmed.id)))).toBeTruthy();
        expect(screen.getByTestId('kds-column-preparing-count')).toHaveTextContent('0');
        expect(screen.queryByTestId(`${ticketId(String(confirmed.id))}-ready`)).toBeNull();
    });

    it('shows the tickets but no bump buttons to somebody who may not manage orders', async () => {
        const { repositories, tokenStore } = await signIn();

        // The fixture world has one Verdant role and it holds both order permissions, so the
        // view-only case is built by narrowing what the session reports — the same context payload
        // the server would send a reader, delivered through the same repository the app reads.
        const viewOnly: MockRepositories = {
            ...repositories,
            session: {
                async me() {
                    const me = await repositories.session.me();
                    if (me.activeContext === null) return me;
                    return {
                        ...me,
                        activeContext: {
                            ...me.activeContext,
                            permissions: me.activeContext.permissions.filter(
                                (permission) => permission !== 'order.manage_organisation',
                            ),
                        },
                    };
                },
            },
        };

        await renderBoard(viewOnly, tokenStore);

        await waitFor(
            () => {
                expect(screen.getByTestId('kds-column-incoming')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        const placed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'placed' && order.branchId === null);
        const confirmed = repositories.kitchenOrdersStore
            .orders()
            .find((order) => order.status === 'confirmed');
        if (placed === undefined || confirmed === undefined) {
            throw new Error('the fixture world seeded no open orders');
        }

        // The board still reads — `order.view_organisation` is what the gate asks for — but nothing
        // on it offers a write the server would refuse.
        expect(screen.getByTestId(ticketId(String(placed.id)))).toBeTruthy();
        expect(screen.queryByTestId(`${ticketId(String(placed.id))}-start`)).toBeNull();
        expect(screen.queryByTestId(`${ticketId(String(confirmed.id))}-ready`)).toBeNull();
    });
});
