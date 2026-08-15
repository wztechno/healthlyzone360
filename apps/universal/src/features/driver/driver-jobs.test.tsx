import { ApiError, apiFailure } from '@healthy360/api-client';
import type { DriverJob } from '@healthy360/api-client/contracts';
import type { OrderId } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
    CONSUMER_PERMISSIONS,
    testActiveContext,
    testMeResponse,
    testMembership,
} from '../../testing/session-fixtures.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { DriverJobsScreen } from './driver-jobs-screen.tsx';

jest.mock('expo-router', () => ({
    __esModule: true,
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    usePathname: () => '/driver',
    useLocalSearchParams: () => ({}),
    Redirect: () => null,
    Link: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * The driver's run sheet, against a sheet this file writes.
 *
 * Two things the fixtures have to get right, because the screen's argument rests on them:
 *
 * 1. **The session holds no order permissions at all.** `/driver/jobs` carries no permission code —
 *    `where driver_user_id = me` is the whole isolation — so a run sheet that only rendered for a
 *    kitchen manager would be testing the wrong guard. The session below is a member of the
 *    organisation with the consumer grant and nothing else.
 * 2. **Delivering removes the job from the sheet**, because the endpoint excludes terminal jobs.
 *    That is what makes "the stamp landed" an assertion about the list rather than about a toast.
 */

const JOB_ONE = 'test-0000-delivery-job-0001';
const JOB_TWO = 'test-0000-delivery-job-0002';

function driverJob(overrides: Partial<DriverJob> = {}): DriverJob {
    return {
        id: JOB_ONE,
        orderId: 'test-0000-order-0001' as OrderId,
        status: 'assigned',
        trackingStatus: 'awaiting_assignment',
        ...overrides,
    };
}

function seedJobs(): DriverJob[] {
    return [
        driverJob(),
        driverJob({
            id: JOB_TWO,
            orderId: 'test-0000-order-0002' as OrderId,
            status: 'in_transit',
            trackingStatus: 'en_route',
        }),
    ];
}

interface RunSheet {
    readonly jobs: () => readonly DriverJob[];
    readonly listJobs: () => readonly DriverJob[];
    readonly deliverJob: (jobId: string) => void;
}

/**
 * A mutable run sheet the overrides read and write, enforcing the one rule the endpoint has: a
 * delivered job is no longer live, so it leaves the list.
 */
function createRunSheet(seed: DriverJob[] = seedJobs()): RunSheet {
    let records = seed;

    return {
        jobs: () => records,
        listJobs: () => records,
        deliverJob: (jobId) => {
            if (!records.some((job) => job.id === jobId)) {
                throw new ApiError(apiFailure('resource.not_found'));
            }
            records = records.filter((job) => job.id !== jobId);
        },
    };
}

/**
 * A driver: an organisation member holding the consumer grant and no order code whatsoever.
 *
 * The membership's role key is not what the gate reads — `activeContext.permissions` is — so the
 * absence of a backend `driver` template role costs this fixture nothing.
 */
function driverSession() {
    return testMeResponse({
        memberships: [testMembership()],
        activeContext: testActiveContext({ permissions: CONSUMER_PERMISSIONS }),
    });
}

function renderRunSheet(
    overrides: {
        readonly listJobs?: () => readonly DriverJob[] | Promise<readonly DriverJob[]>;
        readonly deliverJob?: (jobId: string, request?: { notes?: string | undefined }) => void;
    } = {},
) {
    return renderStubScreen(<DriverJobsScreen />, {
        session: driverSession(),
        repositories: {
            driverJobs: {
                ...(overrides.listJobs === undefined
                    ? {}
                    : { listJobs: async () => overrides.listJobs!() }),
                ...(overrides.deliverJob === undefined
                    ? {}
                    : {
                          deliverJob: async (jobId: string, request?: { notes?: string }) => {
                              overrides.deliverJob!(jobId, request);
                          },
                      }),
            },
        },
    });
}

function jobTestId(jobId: string): string {
    return `driver-job-${jobId}`;
}

describe('the driver run sheet ladder', () => {
    it('shows skeletons while the sheet is still being read', async () => {
        // The read is held open rather than merely slow: the session gate resolves on its own tick
        // first, so a fixed latency would race the assertion instead of pinning the frame. It is
        // released before the test ends — a promise left hanging outlives the test and poisons the
        // next one's renders.
        const sheet = createRunSheet();
        let release = (_: readonly DriverJob[]) => {};
        const held = new Promise<readonly DriverJob[]>((resolve) => {
            release = resolve;
        });

        await renderRunSheet({ listJobs: () => held });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-loading')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('driver-jobs-list')).toBeNull();
        expect(screen.queryByTestId('driver-jobs-empty')).toBeNull();

        release(sheet.listJobs());
        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-list')).toBeTruthy();
            },
            { timeout: 5000 },
        );
    });

    it('shows the failure with a retry when the sheet cannot be read', async () => {
        await renderRunSheet({
            listJobs: () => {
                throw new ApiError(apiFailure('server'));
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('driver-jobs-list')).toBeNull();
    });

    it('says there is nothing to run rather than showing an empty list', async () => {
        const sheet = createRunSheet([]);
        await renderRunSheet({ listJobs: () => sheet.listJobs() });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-empty')).toBeTruthy();
            },
            { timeout: 5000 },
        );
        expect(screen.queryByTestId('driver-jobs-list')).toBeNull();
    });

    it('lists the caller’s live jobs with both status axes, asking the endpoint for nothing', async () => {
        const sheet = createRunSheet();
        const { repositories } = await renderRunSheet({ listJobs: () => sheet.listJobs() });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-list')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // No filters, no cursor, no driver: the narrowing is who is asking, and there is no call
        // shape here that could ask for somebody else's work.
        expect(repositories.driverJobs.listJobs).toHaveBeenCalledWith();

        expect(screen.getByTestId(jobTestId(JOB_ONE))).toBeTruthy();
        expect(screen.getByTestId(jobTestId(JOB_TWO))).toBeTruthy();

        // The order the driver reads out, from the endpoint — never invented here.
        expect(screen.getByTestId(`${jobTestId(JOB_ONE)}-order`)).toHaveTextContent(
            'test-0000-order-0001',
        );

        // Two axes, because "assigned but not collected" and "collected" are one dispatch state
        // and two different things the customer has been told.
        expect(screen.getByTestId(`${jobTestId(JOB_TWO)}-status`)).toBeTruthy();
        expect(screen.getByTestId(`${jobTestId(JOB_TWO)}-tracking`)).toBeTruthy();
    });
});

describe('delivering a job', () => {
    it('confirms first, sends the notes, and the delivered job leaves the sheet', async () => {
        const sheet = createRunSheet();
        const { repositories } = await renderRunSheet({
            listJobs: () => sheet.listJobs(),
            deliverJob: (jobId) => {
                sheet.deliverJob(jobId);
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-list')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The stamp is irreversible and there is no lock version behind it, so it is never one tap.
        expect(screen.queryByTestId('driver-jobs-deliver-dialog')).toBeNull();
        fireEvent.press(screen.getByTestId(`${jobTestId(JOB_ONE)}-deliver`));

        await waitFor(() => {
            expect(screen.getByTestId('driver-jobs-deliver-dialog')).toBeTruthy();
        });
        // The dialog names the order it is about to close, from the endpoint's own value.
        expect(screen.getByTestId('driver-jobs-deliver-order')).toHaveTextContent(
            'Order test-0000-order-0001',
        );

        // `TextInputField` puts its own testID on the labelled field and `-input` on the control.
        await fireEvent.changeText(
            screen.getByTestId('driver-jobs-deliver-notes-input'),
            'Left with the concierge',
        );
        fireEvent.press(screen.getByTestId('driver-jobs-deliver-confirm'));

        await waitFor(() => {
            expect(repositories.driverJobs.deliverJob).toHaveBeenCalledWith(JOB_ONE, {
                notes: 'Left with the concierge',
            });
        });

        // The confirmation is the sheet itself: the endpoint excludes terminal jobs, so the row
        // goes when the list re-reads. Nothing here claims a success the server did not report.
        await waitFor(
            () => {
                expect(screen.queryByTestId(jobTestId(JOB_ONE))).toBeNull();
            },
            { timeout: 5000 },
        );
        expect(screen.getByTestId(jobTestId(JOB_TWO))).toBeTruthy();
        expect(screen.queryByTestId('driver-jobs-deliver-dialog')).toBeNull();
        expect(sheet.jobs().map((job) => job.id)).toEqual([JOB_TWO]);
    });

    it('sends no notes at all when the driver typed none — the field is replace-or-clear', async () => {
        const sheet = createRunSheet();
        const { repositories } = await renderRunSheet({
            listJobs: () => sheet.listJobs(),
            deliverJob: (jobId) => {
                sheet.deliverJob(jobId);
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-list')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        fireEvent.press(screen.getByTestId(`${jobTestId(JOB_TWO)}-deliver`));
        await waitFor(() => {
            expect(screen.getByTestId('driver-jobs-deliver-dialog')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('driver-jobs-deliver-confirm'));

        await waitFor(() => {
            expect(repositories.driverJobs.deliverJob).toHaveBeenCalledWith(JOB_TWO, {
                notes: undefined,
            });
        });
    });

    it('leaves the job on the sheet and says why when the stamp fails', async () => {
        const sheet = createRunSheet();
        await renderRunSheet({
            listJobs: () => sheet.listJobs(),
            deliverJob: () => {
                throw new ApiError(apiFailure('resource.not_found'));
            },
        });

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-list')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        fireEvent.press(screen.getByTestId(`${jobTestId(JOB_ONE)}-deliver`));
        await waitFor(() => {
            expect(screen.getByTestId('driver-jobs-deliver-dialog')).toBeTruthy();
        });
        fireEvent.press(screen.getByTestId('driver-jobs-deliver-confirm'));

        await waitFor(
            () => {
                expect(screen.getByTestId('driver-jobs-deliver-error')).toBeTruthy();
            },
            { timeout: 5000 },
        );

        // The dialog stays open with the failure in it, and the job is still there to try again.
        expect(screen.getByTestId('driver-jobs-deliver-dialog')).toBeTruthy();
        expect(screen.getByTestId(jobTestId(JOB_ONE))).toBeTruthy();
        expect(sheet.jobs()).toHaveLength(2);
        // Said once, not twice: the screen-level copy is held back while the dialog carries it.
        expect(screen.queryByTestId('driver-jobs-action-error')).toBeNull();

        // Dismissing carries the message out, so nobody walks away from a delivery they believe
        // they closed.
        fireEvent.press(screen.getByTestId('driver-jobs-deliver-dismiss'));
        await waitFor(() => {
            expect(screen.getByTestId('driver-jobs-action-error')).toBeTruthy();
        });
    });
});
