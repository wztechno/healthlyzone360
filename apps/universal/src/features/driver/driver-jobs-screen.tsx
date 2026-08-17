import type { DriverJob, DriverJobDelivery } from '@healthy360/api-client/contracts';
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
import { useFormatter, useLocale } from '@healthy360/i18n';
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
 * ## What a row says
 *
 * The number printed on the bag, both status axes, where the food is going in enough detail to find
 * a door, when the run was handed over, and the number to ring when the building still cannot be
 * found. That is what somebody standing next to a van needs and it is the whole of what the wire
 * carries — no money (a driver collecting cash belongs to the receipts ledger, not to a run sheet)
 * and no `driverUserId` (it would say "you" on every row).
 *
 * **The heading falls back visibly.** `orderNumber` is nullable on the wire, so a job without one
 * shows the order identifier — which is what this screen showed on every row before the number
 * existed. The fallback is made here rather than in the mapper on purpose: "this job carries no
 * number" is a fact worth keeping, and a mapper that substituted the identifier would hand every
 * screen a UUID wearing the name of a reference somebody could read aloud.
 *
 * **The address is drawn from what was recorded and nothing else.** Every part of the snapshot is
 * nullable and the nulls are ordinary — an order placed before the snapshot was widened has no
 * floor, a kitchen that has not named its slots has no window — so an absent part is simply not
 * drawn. A labelled empty line for a floor nobody wrote down is noise on a phone held one-handed in
 * a stairwell. It is also the address **as the order recorded it**, never the customer's address
 * book as it stands now: a customer who moved at eight o'clock has not changed where tonight's food
 * is going.
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

/**
 * The area's name in the reader's own language, or the other one, or nothing.
 *
 * Four lines here rather than `kitchen-admin/format.ts`'s `displayName` for the reason the poll
 * cadence is declared here rather than imported: the `driver` build family compiles this area alone,
 * and that module pulls the catalogue's contracts, the nutrition package and the design system's
 * badge vocabulary in behind it — a large amount of kitchen for one string on a phone.
 *
 * It also answers a different question. `displayName` takes a `LocalisedText` whose two sides are
 * non-null strings and reports whether it fell back, because an admin editing a catalogue row needs
 * to know a translation is missing. Both sides are nullable here and a driver can do nothing about
 * either, so the fallback is silent and `null` means the order recorded no area at all.
 */
function areaNameFor(delivery: DriverJobDelivery, locale: string): string | null {
    const arabic = locale.toLowerCase().startsWith('ar');
    const preferred = arabic ? delivery.areaNameAr : delivery.areaNameEn;
    const other = arabic ? delivery.areaNameEn : delivery.areaNameAr;
    return preferred ?? other;
}

export function DriverJobsScreen() {
    return (
        <Gate area="driver" testID="driver-jobs">
            <DriverJobs />
        </Gate>
    );
}

function DriverJobs() {
    const { t } = useTranslation();
    const { locale } = useLocale();
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
                            locale={locale}
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
                                // The same fallback the card heading makes, so the dialog names the
                                // job in the words the driver just read.
                                reference: delivering.orderNumber ?? String(delivering.orderId),
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
    /** The reader's locale, for the area name. Passed down rather than read again per card. */
    readonly locale: string;
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
function JobCard({ job, locale, disabled, onDeliver }: JobCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const testID = `driver-job-${job.id}`;

    const { delivery } = job;
    const areaName = areaNameFor(delivery, locale);
    /**
     * Building, floor and apartment on one line, in that order.
     *
     * Coarse to fine, which is the order somebody walking up to a block reads them in, and joined
     * with the locale's own list separator so the line does not hard-code a comma into Arabic.
     * Empty when the order recorded none of the three, and the line is then not drawn at all.
     */
    const unitParts = [delivery.building, delivery.floor, delivery.apartment].filter(
        (part): part is string => part !== null && part !== '',
    );

    return (
        <Card padding="md" testID={testID}>
            <Stack space="sm">
                <Text variant="caption" tone="secondary">
                    {t('kitchen:driver.orderLabel')}
                </Text>
                {/*
                 * The number printed on the bag, falling back to the identifier when the job
                 * carries none — see the file header on why the fallback is here.
                 */}
                <Heading level={2} testID={`${testID}-order`}>
                    {job.orderNumber ?? String(job.orderId)}
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

                {/*
                 * Where it is going. Every part is nullable and an absent one is simply not drawn —
                 * a labelled blank for a floor nobody recorded is noise in a stairwell.
                 */}
                {delivery.lineOne === null && areaName === null ? (
                    <Text variant="caption" tone="secondary" testID={`${testID}-no-address`}>
                        {t('kitchen:driver.noAddress')}
                    </Text>
                ) : (
                    <Stack space="none" testID={`${testID}-address`}>
                        {delivery.lineOne === null ? null : (
                            <Text variant="bodyStrong" testID={`${testID}-address-line-one`}>
                                {delivery.lineOne}
                            </Text>
                        )}
                        {unitParts.length === 0 ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${testID}-address-unit`}
                            >
                                {unitParts.join(t('kitchen:common.listSeparator'))}
                            </Text>
                        )}
                        {areaName === null ? null : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                testID={`${testID}-address-area`}
                            >
                                {areaName}
                            </Text>
                        )}
                    </Stack>
                )}

                {delivery.directions === null ? null : (
                    <Text variant="caption" tone="secondary" testID={`${testID}-directions`}>
                        {t('kitchen:driver.directions', { directions: delivery.directions })}
                    </Text>
                )}

                {/*
                 * The number **the order was given**, not the customer's best current one — so a
                 * driver who cannot find the building rings the person who is expecting them. Text
                 * rather than a dialling link: a tappable number inside a card that also holds the
                 * delivery button is a second target for a thumb that is already in a hurry.
                 */}
                {delivery.phone === null ? null : (
                    <Text testID={`${testID}-phone`}>
                        {t('kitchen:driver.phone', { phone: delivery.phone })}
                    </Text>
                )}

                {job.assignedAt === null ? null : (
                    <Text variant="caption" tone="secondary" testID={`${testID}-assigned-at`}>
                        {t('kitchen:driver.assignedAt', {
                            at: formatter.formatDate(job.assignedAt, { timeStyle: 'short' }),
                        })}
                    </Text>
                )}

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
