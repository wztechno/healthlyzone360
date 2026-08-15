import type { DriverJob } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Gate } from '../../access/gate.tsx';
import {
    toFailure,
    useDeliverDriverJobMutation,
    useDriverJobsQuery,
} from '../../data/driver-jobs-hooks.ts';
import { useOnlineStatus } from '../../online/online-status.tsx';

/**
 * `/driver` — one driver's run sheet, and the stamp that closes a job.
 *
 * ## Whose jobs these are is not a question this screen asks
 *
 * `GET /driver/jobs` answers the signed-in driver's own live work and nothing else. The narrowing
 * is `where driver_user_id = me`, which is ownership rather than authority, and it is why the two
 * driver routes carry no permission code at all. So there is no filter here, no branch picker and
 * no driver selector — not as a simplification, but because the endpoint has no parameter that
 * could express one. The area gate (auth, verified, an organisation) is the whole guard, and
 * `AreaShell` already applies it; the `Gate` below repeats it so the screen refuses on its own
 * terms when it is rendered outside the shell.
 *
 * ## What a row can say, and what it cannot yet
 *
 * The wire carries four fields — the job, the order, and the two status axes. It does **not** carry
 * the order *number*, which is the thing a driver actually reads out to a kitchen or a customer, so
 * the row shows the order identifier the endpoint sent rather than a friendlier string this screen
 * would have to invent. When the delivery-chain backend widens the row, that value is the one to
 * put in the heading; nothing else here changes.
 *
 * Both statuses are shown because they are two different facts. `status` is where dispatch thinks
 * the job is; `trackingStatus` is what the customer has already been told. "Assigned but not yet
 * collected" and "collected" are one dispatch state and two promises, and a driver deciding what to
 * do next needs the second as much as the first.
 *
 * ## Delivering is a stamp, and the dialog is why it is not a single tap
 *
 * The write is idempotent and irreversible in the same breath: it sets `delivered` over whatever
 * was there, and there is no lock version, no conflict and no undo. A bare button on a phone in a
 * pocket would close jobs by accident, so the action opens a confirmation — which is also the only
 * place the optional proof-of-delivery note can be typed. The note is replace-or-clear on the wire;
 * leaving the field empty is the same request with `null` in it, which is what an empty field
 * honestly means here.
 *
 * After a successful stamp the run sheet re-reads and the job leaves the list, because the endpoint
 * excludes terminal jobs. That is the confirmation — no toast claims something the server did not.
 *
 * ## Phone first
 *
 * One column at every width. This is the only screen in the application whose device is known: it
 * is used one-handed, outdoors, while somebody is holding a bag. So every row is a card with a
 * full-width action rather than a table with a row menu, and the card itself is **not** pressable —
 * a card that takes `onPress` around a button is an axe `nested-interactive` violation and, worse,
 * a target that closes a delivery when a thumb misses the button.
 *
 * ## Live-ness
 *
 * The list polls every {@link DRIVER_POLL_MS} while the screen is mounted and the device is online,
 * so a job assigned to a driver who is already out appears without them thinking to pull it down.
 * The interval stops while offline for the reason the kitchen display's does — an interval firing
 * into a dead network is retries nobody asked for — and this is the surface that meets a dead
 * network most.
 */

/**
 * Poll cadence for the run sheet.
 *
 * The same fifteen seconds as `features/kds/kds-tickets-screen.tsx`'s `KDS_POLL_MS`, and the same
 * argument: short enough that new work reaches the person before anybody wonders, long enough that
 * a device left on all day is not making six requests a minute.
 *
 * Declared here rather than imported from that module on purpose. The `driver` build family
 * compiles the driver area alone (`MODE_ROUTE_AREAS.driver`), and importing a constant out of the
 * kitchen display's screen file would pull that screen — and the order book, formatters and
 * entity registry behind it — into a phone bundle that has no use for any of it.
 */
export const DRIVER_POLL_MS = 15_000;

export function DriverJobsScreen() {
    return (
        <Gate area="driver" testID="driver-jobs">
            <DriverJobs />
        </Gate>
    );
}

function DriverJobs() {
    const { t } = useTranslation();
    const { online } = useOnlineStatus();

    const jobs = useDriverJobsQuery(true, { refetchInterval: online ? DRIVER_POLL_MS : false });
    const deliver = useDeliverDriverJobMutation();

    /** The job the confirmation is open for. `null` closes the dialog. */
    const [delivering, setDelivering] = useState<DriverJob | null>(null);
    const [notes, setNotes] = useState('');

    const listFailure = toFailure(jobs.error);
    const actionFailure = toFailure(deliver.error);
    const rows = jobs.data ?? [];

    function openDeliver(job: DriverJob) {
        deliver.reset();
        setNotes('');
        setDelivering(job);
    }

    function closeDeliver() {
        setDelivering(null);
        setNotes('');
    }

    function submitDeliver() {
        if (delivering === null) return;
        deliver.mutate(
            { jobId: delivering.id, notes: notes.trim() === '' ? undefined : notes },
            { onSuccess: closeDeliver },
        );
    }

    return (
        <Stack space="md" className="flex-1 p-4" testID="driver-jobs">
            <Stack space="xs">
                <Heading level={1}>{t('kitchen:driver.title')}</Heading>
                <Text tone="secondary" variant="caption">
                    {t('kitchen:driver.subtitle')}
                </Text>
            </Stack>

            {/*
             * A failed stamp is reported in exactly one place at a time: inside the dialog while it
             * is open, and out here once it is dismissed. Both at once would be the same sentence
             * twice, and dropping it on dismissal would let somebody walk away from a delivery they
             * think they closed. `openDeliver` resets it, so a new job never inherits it.
             */}
            {actionFailure === null || delivering !== null ? null : (
                <Text testID="driver-jobs-action-error" tone="danger">
                    {actionFailure.message}
                </Text>
            )}

            {jobs.isPending ? (
                <Stack space="sm" testID="driver-jobs-loading">
                    {Array.from({ length: 3 }, (_, index) => (
                        <Skeleton key={index} heightClassName="h-28" />
                    ))}
                </Stack>
            ) : listFailure !== null ? (
                <ErrorState
                    testID="driver-jobs-error"
                    title={t('kitchen:driver.loadErrorTitle')}
                    failure={listFailure}
                    onRetry={() => {
                        void jobs.refetch();
                    }}
                    retrying={jobs.isFetching}
                />
            ) : rows.length === 0 ? (
                <EmptyState
                    testID="driver-jobs-empty"
                    title={t('kitchen:driver.emptyTitle')}
                    body={t('kitchen:driver.emptyBody')}
                />
            ) : (
                <Stack space="sm" testID="driver-jobs-list">
                    {rows.map((job) => (
                        <JobCard
                            key={job.id}
                            job={job}
                            disabled={deliver.isPending}
                            onDeliver={openDeliver}
                        />
                    ))}
                </Stack>
            )}

            <Dialog
                testID="driver-jobs-deliver-dialog"
                open={delivering !== null}
                onClose={closeDeliver}
                title={t('kitchen:driver.deliverTitle')}
                description={t('kitchen:driver.deliverBody')}
                actions={
                    <>
                        <Button
                            testID="driver-jobs-deliver-dismiss"
                            variant="quiet"
                            label={t('kitchen:driver.deliverDismiss')}
                            onPress={closeDeliver}
                        />
                        <Button
                            testID="driver-jobs-deliver-confirm"
                            label={t('kitchen:driver.deliverConfirm')}
                            loading={deliver.isPending}
                            disabled={deliver.isPending}
                            onPress={submitDeliver}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    {delivering === null ? null : (
                        <Text variant="caption" tone="secondary" testID="driver-jobs-deliver-order">
                            {t('kitchen:driver.orderReference', {
                                reference: String(delivering.orderId),
                            })}
                        </Text>
                    )}
                    <TextInputField
                        testID="driver-jobs-deliver-notes"
                        id="driver-jobs-deliver-notes"
                        label={t('kitchen:driver.notesLabel')}
                        hint={t('kitchen:driver.notesHint')}
                        value={notes}
                        onChangeText={setNotes}
                        multiline
                        maxLength={1000}
                        autoCapitalize="sentences"
                    />
                    {actionFailure === null ? null : (
                        <Text testID="driver-jobs-deliver-error" tone="danger">
                            {actionFailure.message}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </Stack>
    );
}

/**
 * How far along the job is, as a tone.
 *
 * Only the three states a run sheet can actually show are given a colour of their own — the
 * endpoint excludes `delivered` and `cancelled`, and `failed` is a job somebody has to do something
 * about. Everything else is neutral rather than guessed at.
 */
function statusTone(status: DriverJob['status']): BadgeTone {
    switch (status) {
        case 'in_transit':
            return 'info';
        case 'failed':
            return 'danger';
        case 'delivered':
            return 'success';
        default:
            return 'neutral';
    }
}

interface JobCardProps {
    readonly job: DriverJob;
    /** A stamp is in flight for some job — every Deliver button waits for it. */
    readonly disabled: boolean;
    readonly onDeliver: (job: DriverJob) => void;
}

/**
 * One job.
 *
 * The card takes no `onPress`. It holds a button, and a pressable card around a button is both an
 * axe `nested-interactive` violation and a way to deliver an order with a mistimed thumb.
 */
function JobCard({ job, disabled, onDeliver }: JobCardProps) {
    const { t } = useTranslation();
    const testID = `driver-job-${job.id}`;

    return (
        <Card padding="md" testID={testID}>
            <Stack space="sm">
                <Text variant="caption" tone="secondary">
                    {t('kitchen:driver.orderLabel')}
                </Text>
                <Heading level={2} testID={`${testID}-order`}>
                    {String(job.orderId)}
                </Heading>

                <Inline space="xs" wrap testID={`${testID}-statuses`}>
                    <Badge
                        testID={`${testID}-status`}
                        tone={statusTone(job.status)}
                        label={t(`kitchen:driver.status.${job.status}`)}
                    />
                    <Badge
                        testID={`${testID}-tracking`}
                        tone="neutral"
                        icon={null}
                        label={t(`kitchen:driver.tracking.${job.trackingStatus}`)}
                    />
                </Inline>

                <Button
                    testID={`${testID}-deliver`}
                    block
                    label={t('kitchen:driver.deliver')}
                    disabled={disabled}
                    onPress={() => {
                        onDeliver(job);
                    }}
                />
            </Stack>
        </Card>
    );
}
