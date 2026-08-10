import {
    ActionSheet,
    Badge,
    Button,
    Callout,
    DateField,
    Dialog,
    EmptyState,
    FilterChip,
    Heading,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Table,
    Text,
} from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import type { Subscription, CustomerAddress } from '@healthy360/api-client/contracts';
import { SubscriptionId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCancelSubscriptionMutation,
    useChangeAddressMutation,
    useChangeSlotMutation,
    usePauseSubscriptionMutation,
    useResumeSubscriptionMutation,
    useSetSubscriptionMealChoicesMutation,
    useSetSubscriptionWeekdaysMutation,
    useSkipDayMutation,
    useSubscriptionBalanceQuery,
    useSubscriptionDeliveriesQuery,
    useSubscriptionQuery,
    useSubscriptionQuoteQuery,
} from '../../../data/commerce-hooks.ts';
import { useAddressesQuery } from '../../../data/account-hooks.ts';
import { useKitchenMenuQuery } from '../../../data/marketplace-hooks.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { formatAddress } from '../address.ts';
import { earliestStartDate, upcomingDeliveryDates } from '../dates.ts';
import { DELIVERY_SLOTS } from '../delivery.ts';
import {
    SubscriptionStateBadge,
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from '../state-badge.tsx';
import { SubscriptionBalanceCard, SubscriptionDeliveries } from '../subscription-balance.tsx';
import {
    CancelSubscriptionDialog,
    MealChoicesDialog,
    WeekdayEditorDialog,
} from '../subscription-editors.tsx';

/**
 * `/customer/subscriptions/{subscription}` — one subscription: what is left of it, what happened to
 * the rest, and the things a person can do to it.
 *
 * ## S1 turned this from a configuration sheet into an account statement
 *
 * The screen used to answer "what did I order?". It now answers "what do I have left, and where did
 * the rest go?" first — a balance card, then the delivery ledger, then the configuration — because a
 * subscription is a consumable balance of delivery days (semantics §1) and the balance is the thing
 * somebody opens this screen to check. The ledger sits directly beneath it as the evidence: three
 * skipped rows marked as costing nothing is how the promise "a skip is free" becomes checkable
 * rather than merely stated.
 *
 * ## Every action is a real transition
 *
 * Pause, resume, skip a day, change the address and change the delivery slot all call the
 * repository and all change the world. None is a prototype notice, because the prototype store
 * implements all five — and `usePrototypeAction()` is for capabilities that genuinely do not exist,
 * not for capabilities somebody has not wired up.
 *
 * ## Every action is also *guarded*, and the guard is visible
 *
 * The repository refuses a transition the state does not allow — resuming something that was never
 * paused, pausing something cancelled — and answers with a sentence a person can read. Those
 * rejections are rendered rather than swallowed. The controls a state does not permit are not shown
 * at all, so the rejection path is a safety net rather than the normal route; but the net is real,
 * because a stale screen and a changed subscription is an ordinary Tuesday.
 *
 * ## Cancelled and expired are read-only
 *
 * There is no control on a finished subscription, and the screen says why. Doc 11, `MGT-06` and
 * `MGT-08` record the reference's own terms drawing the same line between a live package and a
 * finished one.
 *
 * ## What the timeline can and cannot say
 *
 * `Subscription` publishes `createdAt`, `updatedAt`, the current state, `pausedUntil` and
 * `skippedDates` — and **no event log**. So the timeline reports exactly those facts and says it is
 * reporting the record rather than a history. A real backend should publish
 * `GET /api/v1/subscriptions/{subscription}/events`; inventing "paused on the 14th" from an
 * `updatedAt` would be the interface making something up.
 */

export interface SubscriptionDetailScreenProps {
    readonly subscriptionId: string | undefined;
}

type OpenDialog =
    'pause' | 'resume' | 'skip' | 'address' | 'slot' | 'weekdays' | 'choices' | 'cancel' | null;

/** How many meals the Free Selection picker offers. The kitchen's menu, not the whole catalogue. */
const CHOICE_OPTIONS = 20;

/** How many upcoming delivery days the skip sheet offers. */
const SKIP_CHOICES = 6;

interface ConfigurationRow {
    readonly key: string;
    readonly label: string;
    readonly value: string;
}

export function SubscriptionDetailScreen({ subscriptionId }: SubscriptionDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const parsed = subscriptionId === undefined ? null : SubscriptionId.safeParse(subscriptionId);
    const query = useSubscriptionQuery(parsed);
    const subscription: Subscription | undefined = query.data;

    const balanceQuery = useSubscriptionBalanceQuery(parsed);
    const deliveriesQuery = useSubscriptionDeliveriesQuery(parsed);
    /**
     * The plan's real availability, in one read.
     *
     * Enabled only once the subscription has landed, because the quote is keyed by the plan and the
     * variant and neither is known before then. This is what replaced the seven-preview probe the
     * slot dialog used to run every time it opened.
     */
    const quoteQuery = useSubscriptionQuoteQuery(
        subscription === undefined
            ? null
            : {
                  planId: subscription.configuration.planId,
                  variantId: subscription.configuration.variantId,
                  duration: subscription.configuration.duration,
              },
    );

    const [dialog, setDialog] = useState<OpenDialog>(null);
    const [skipSheetOpen, setSkipSheetOpen] = useState(false);
    const [skipDate, setSkipDate] = useState<string | null>(null);
    const [pauseUntil, setPauseUntil] = useState<string | null>(null);
    const [slotCode, setSlotCode] = useState<string | null>(null);
    const [weekdays, setWeekdays] = useState<readonly number[] | null>(null);
    const [addressId, setAddressId] = useState<string | null>(null);
    const [showAddressErrors, setShowAddressErrors] = useState(false);
    const [editedWeekdays, setEditedWeekdays] = useState<readonly number[] | null>(null);

    const addresses = useAddressesQuery(dialog === 'address');
    const addressList: readonly CustomerAddress[] = addresses.data ?? [];

    const pause = usePauseSubscriptionMutation();
    const resume = useResumeSubscriptionMutation();
    const skipDay = useSkipDayMutation();
    const changeAddress = useChangeAddressMutation();
    const changeSlot = useChangeSlotMutation();
    const changeWeekdays = useSetSubscriptionWeekdaysMutation();
    const setMealChoices = useSetSubscriptionMealChoicesMutation();
    const cancel = useCancelSubscriptionMutation();

    /**
     * Free Selection's options: this kitchen's own menu.
     *
     * Not the whole catalogue. A subscription belongs to one kitchen and only that kitchen can cook
     * the substitute, so offering a meal from another one would be offering something nobody will
     * deliver. Enabled only when the plan actually allows selection — the picker is not merely
     * hidden, the request is not made.
     */
    const freeSelection = quoteQuery.data?.allowsFreeSelection === true;
    const menu = useKitchenMenuQuery(
        freeSelection && subscription !== undefined ? subscription.kitchenId : null,
        { limit: CHOICE_OPTIONS },
    );

    const failure =
        toFailure(pause.error) ??
        toFailure(resume.error) ??
        toFailure(skipDay.error) ??
        toFailure(changeAddress.error) ??
        toFailure(changeSlot.error) ??
        toFailure(changeWeekdays.error) ??
        toFailure(setMealChoices.error) ??
        toFailure(cancel.error);

    const busy =
        pause.isPending ||
        resume.isPending ||
        skipDay.isPending ||
        changeAddress.isPending ||
        changeSlot.isPending ||
        changeWeekdays.isPending ||
        setMealChoices.isPending ||
        cancel.isPending;

    const upcoming = useMemo(() => {
        if (subscription?.nextDeliveryDate == null) return [];
        return upcomingDeliveryDates(
            subscription.nextDeliveryDate,
            subscription.configuration.deliveryWeekdays,
            SKIP_CHOICES,
            { skipped: subscription.skippedDates },
        );
    }, [subscription]);

    const close = () => {
        setDialog(null);
        setShowAddressErrors(false);
        setEditedWeekdays(null);
        // The cancellation dialog reports the memo it produced, so its result is cleared when the
        // dialog closes rather than left to reappear the next time something opens.
        cancel.reset();
    };

    const listAction = (
        <Button
            testID="subscription-detail-list"
            // "Back to list" is navigation, and Rule 4 forbids promoting navigation into the
            // primary slot. The actions that advance this screen's loop — skip a delivery, change
            // a plan, cancel a subscription — are further down and own the emphasis.
            variant="quiet"
            label={t('commerce:subscription.backToList')}
            onPress={() => {
                router.push('/customer/subscriptions' as never);
            }}
        />
    );

    if (parsed === null) {
        return (
            <Stack space="lg" testID="subscription-detail-screen">
                <EmptyState
                    testID="subscription-detail-empty"
                    title={t('commerce:subscription.notFoundTitle')}
                    body={t('commerce:subscription.notFoundBody')}
                    actions={listAction}
                />
            </Stack>
        );
    }

    const readOnly = subscription !== undefined && isTerminalSubscriptionState(subscription.state);

    const configurationRows: readonly ConfigurationRow[] =
        subscription === undefined
            ? []
            : [
                  {
                      key: 'plan',
                      label: t('commerce:subscription.rows.plan'),
                      value: subscription.planName,
                  },
                  {
                      key: 'duration',
                      label: t('commerce:subscription.rows.duration'),
                      value: t(`commerce:durations.${subscription.configuration.duration}`),
                  },
                  {
                      key: 'start',
                      label: t('commerce:subscription.rows.start'),
                      value: formatter.formatDate(subscription.configuration.startDate, {
                          dateStyle: 'medium',
                      }),
                  },
                  {
                      key: 'days',
                      label: t('commerce:subscription.rows.days'),
                      value: subscription.configuration.deliveryWeekdays
                          .map((weekday) => t(weekdayKey(weekday)))
                          .join(t('commerce:common.listSeparator')),
                  },
                  {
                      key: 'slot',
                      label: t('commerce:subscription.rows.slot'),
                      value: t(`commerce:slots.${subscription.configuration.slotCode}`, {
                          defaultValue: subscription.configuration.slotCode,
                      }),
                  },
                  {
                      key: 'address',
                      label: t('commerce:subscription.rows.address'),
                      value: formatAddress(subscription.configuration.address),
                  },
                  {
                      key: 'allergens',
                      label: t('commerce:subscription.rows.allergens'),
                      value:
                          subscription.configuration.excludeAllergens.length === 0
                              ? t('commerce:configurator.checks.noAllergens')
                              : subscription.configuration.excludeAllergens
                                    .map((code) => t(`marketplace:allergens.${code}`))
                                    .join(t('commerce:common.listSeparator')),
                  },
              ];

    // `Table` renders whatever a column returns straight into a `View`, so a bare string would be
    // an invariant violation on native. Every cell is a `Text` node.
    const columns: readonly TableColumn<ConfigurationRow>[] = [
        {
            key: 'label',
            header: t('commerce:subscription.rows.field'),
            rowHeader: true,
            render: (row) => <Text tone="secondary">{row.label}</Text>,
        },
        {
            key: 'value',
            header: t('commerce:subscription.rows.value'),
            render: (row) => <Text>{row.value}</Text>,
        },
    ];

    return (
        <Stack space="lg" testID="subscription-detail-screen">
            <QueryStates
                query={query}
                isEmpty={subscription === undefined}
                emptyTitle={t('commerce:subscription.notFoundTitle')}
                emptyBody={t('commerce:subscription.notFoundBody')}
                emptyActions={listAction}
                skeletonCount={2}
                testID="subscription-detail"
            >
                {subscription === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="xs">
                            <Inline space="sm" align="center" justify="between">
                                <Heading level={1} testID="subscription-detail-name">
                                    {subscription.planName}
                                </Heading>
                                <SubscriptionStateBadge
                                    state={subscription.state}
                                    testID="subscription-detail-state"
                                />
                            </Inline>
                            <Text testID="subscription-detail-price">
                                {t('commerce:subscriptions.weeklyPrice', {
                                    price: formatMoney(formatter, subscription.weeklyPrice),
                                })}
                            </Text>
                            <Text tone="secondary" testID="subscription-detail-next">
                                {subscription.nextDeliveryDate === null
                                    ? t('commerce:subscriptions.noNextDelivery')
                                    : t('commerce:subscriptions.nextDelivery', {
                                          date: formatter.formatDate(
                                              subscription.nextDeliveryDate,
                                              { dateStyle: 'full' },
                                          ),
                                      })}
                            </Text>
                        </Stack>

                        {balanceQuery.data === undefined ? null : (
                            <SubscriptionBalanceCard balance={balanceQuery.data} />
                        )}

                        <SubscriptionDeliveries deliveries={deliveriesQuery.data?.items ?? []} />

                        <SubscriptionTimeline subscription={subscription} />

                        <Stack space="sm" testID="subscription-detail-configuration">
                            <Text variant="label">{t('commerce:subscription.configTitle')}</Text>
                            <Table
                                testID="subscription-detail-config-table"
                                caption={t('commerce:subscription.configCaption')}
                                captionHidden
                                columns={columns}
                                rows={configurationRows}
                                rowKey={(row) => row.key}
                            />
                        </Stack>

                        {failure === null ? null : (
                            <Callout
                                testID="subscription-detail-error"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('commerce:subscription.actionFailedTitle')}
                                body={failure.message}
                            />
                        )}

                        {readOnly ? (
                            <Callout
                                testID="subscription-detail-read-only"
                                role="note"
                                tone="info"
                                title={t('commerce:subscription.readOnlyTitle')}
                                body={t(`commerce:subscription.readOnly.${subscription.state}`)}
                                actions={listAction}
                            />
                        ) : (
                            <Stack space="sm" testID="subscription-detail-actions">
                                <Text variant="label">
                                    {t('commerce:subscription.actionsTitle')}
                                </Text>
                                <Inline space="sm" wrap>
                                    {canPauseOrSkip(subscription.state) ? (
                                        <Button
                                            testID="subscription-pause"
                                            variant="secondary"
                                            label={t('commerce:subscription.pause')}
                                            disabled={busy}
                                            onPress={() => {
                                                setPauseUntil(null);
                                                setDialog('pause');
                                            }}
                                        />
                                    ) : null}
                                    {canResume(subscription.state) ? (
                                        <Button
                                            testID="subscription-resume"
                                            label={t('commerce:subscription.resume')}
                                            disabled={busy}
                                            onPress={() => {
                                                setDialog('resume');
                                            }}
                                        />
                                    ) : null}
                                    {canPauseOrSkip(subscription.state) ? (
                                        <Button
                                            testID="subscription-skip"
                                            variant="quiet"
                                            label={t('commerce:subscription.skip')}
                                            disabled={busy || upcoming.length === 0}
                                            onPress={() => {
                                                setSkipSheetOpen(true);
                                            }}
                                        />
                                    ) : null}
                                    {canChangeDelivery(subscription.state) ? (
                                        <Button
                                            testID="subscription-change-address"
                                            variant="secondary"
                                            label={t('commerce:subscription.changeAddress')}
                                            disabled={busy}
                                            onPress={() => {
                                                setAddressId(null);
                                                setDialog('address');
                                            }}
                                        />
                                    ) : null}
                                    {canChangeDelivery(subscription.state) ? (
                                        <Button
                                            testID="subscription-change-slot"
                                            variant="secondary"
                                            label={t('commerce:subscription.changeSlot')}
                                            disabled={busy}
                                            onPress={() => {
                                                setSlotCode(subscription.configuration.slotCode);
                                                setWeekdays([
                                                    ...subscription.configuration.deliveryWeekdays,
                                                ]);
                                                setDialog('slot');
                                            }}
                                        />
                                    ) : null}
                                    {canChangeDelivery(subscription.state) ? (
                                        <Button
                                            testID="subscription-change-weekdays"
                                            variant="secondary"
                                            label={t('commerce:weekdays.open')}
                                            disabled={busy}
                                            onPress={() => {
                                                setEditedWeekdays([
                                                    ...subscription.configuration.deliveryWeekdays,
                                                ]);
                                                setDialog('weekdays');
                                            }}
                                        />
                                    ) : null}
                                    {/*
                                     * Free Selection, and only when the plan has it. A control that
                                     * appeared for every plan and then refused would teach the
                                     * wrong thing about what a plan is.
                                     */}
                                    {freeSelection && subscription.nextDeliveryDate !== null ? (
                                        <Button
                                            testID="subscription-choose-meals"
                                            variant="secondary"
                                            label={t('commerce:choices.open')}
                                            disabled={busy}
                                            onPress={() => {
                                                setDialog('choices');
                                            }}
                                        />
                                    ) : null}
                                    {/*
                                     * Cancellation is `danger` and last, and it is offered from
                                     * every non-terminal state — including `paused`, because a
                                     * paused subscription is still somebody's money.
                                     */}
                                    <Button
                                        testID="subscription-cancel-open"
                                        variant="danger"
                                        label={t('commerce:cancel.open')}
                                        disabled={busy}
                                        onPress={() => {
                                            setDialog('cancel');
                                        }}
                                    />
                                </Inline>
                                <Text tone="secondary" variant="caption">
                                    {t('commerce:subscription.actionsNote')}
                                </Text>
                            </Stack>
                        )}

                        <Inline space="sm" wrap>
                            {listAction}
                        </Inline>
                    </Stack>
                )}
            </QueryStates>

            {/* ── choosing which delivery to skip ─────────────────────────────────────────────── */}
            <ActionSheet
                testID="subscription-skip-sheet"
                open={skipSheetOpen}
                onClose={() => {
                    setSkipSheetOpen(false);
                }}
                title={t('commerce:subscription.skipSheetTitle')}
                description={t('commerce:subscription.skipSheetBody')}
                cancelLabel={t('commerce:common.cancel')}
                actions={upcoming.map((date) => ({
                    key: date,
                    testID: `subscription-skip-option-${date}`,
                    label: formatter.formatDate(date, { dateStyle: 'full' }),
                    onPress: () => {
                        setSkipSheetOpen(false);
                        setSkipDate(date);
                        setDialog('skip');
                    },
                }))}
            />

            {/* ── pause ──────────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="subscription-pause-dialog"
                open={dialog === 'pause'}
                onClose={close}
                title={t('commerce:subscription.pauseDialogTitle')}
                description={t('commerce:subscription.pauseDialogBody')}
                actions={
                    <>
                        <Button
                            testID="subscription-pause-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="subscription-pause-confirm"
                            label={t('commerce:subscription.pauseConfirm')}
                            loading={pause.isPending}
                            onPress={() => {
                                if (subscription === undefined) return;
                                pause.mutate(
                                    {
                                        subscriptionId: subscription.id,
                                        ...(pauseUntil === null
                                            ? {}
                                            : { request: { until: pauseUntil } }),
                                    },
                                    { onSuccess: close },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <DateField
                        testID="subscription-pause-until"
                        label={t('commerce:subscription.pauseUntilLabel')}
                        hint={t('commerce:subscription.pauseUntilHint')}
                        value={pauseUntil}
                        min={earliestStartDate()}
                        onChange={setPauseUntil}
                    />
                    <Callout
                        testID="subscription-pause-consequence"
                        role="note"
                        tone="warning"
                        icon="info"
                        title={t('commerce:subscription.pauseConsequenceTitle')}
                        body={
                            pauseUntil === null
                                ? t('commerce:subscription.pauseConsequenceOpen')
                                : t('commerce:subscription.pauseConsequenceUntil', {
                                      date: formatter.formatDate(pauseUntil, {
                                          dateStyle: 'full',
                                      }),
                                  })
                        }
                    />
                </Stack>
            </Dialog>

            {/* ── resume ─────────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="subscription-resume-dialog"
                open={dialog === 'resume'}
                onClose={close}
                title={t('commerce:subscription.resumeDialogTitle')}
                description={t('commerce:subscription.resumeDialogBody')}
                actions={
                    <>
                        <Button
                            testID="subscription-resume-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="subscription-resume-confirm"
                            label={t('commerce:subscription.resumeConfirm')}
                            loading={resume.isPending}
                            onPress={() => {
                                if (subscription === undefined) return;
                                resume.mutate(subscription.id, { onSuccess: close });
                            }}
                        />
                    </>
                }
            />

            {/* ── skip a day ─────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="subscription-skip-dialog"
                open={dialog === 'skip'}
                onClose={close}
                title={t('commerce:subscription.skipDialogTitle')}
                description={
                    skipDate === null
                        ? t('commerce:subscription.skipDialogBody')
                        : t('commerce:subscription.skipDialogDated', {
                              date: formatter.formatDate(skipDate, { dateStyle: 'full' }),
                          })
                }
                actions={
                    <>
                        <Button
                            testID="subscription-skip-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="subscription-skip-confirm"
                            label={t('commerce:subscription.skipConfirm')}
                            loading={skipDay.isPending}
                            onPress={() => {
                                if (subscription === undefined || skipDate === null) return;
                                skipDay.mutate(
                                    {
                                        subscriptionId: subscription.id,
                                        request: { date: skipDate },
                                    },
                                    { onSuccess: close },
                                );
                            }}
                        />
                    </>
                }
            >
                <Callout
                    testID="subscription-skip-consequence"
                    role="note"
                    tone="warning"
                    icon="info"
                    title={t('commerce:subscription.skipConsequenceTitle')}
                    body={t('commerce:subscription.skipConsequenceBody')}
                />
            </Dialog>

            {/* ── change address ─────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="subscription-address-dialog"
                open={dialog === 'address'}
                onClose={close}
                title={t('commerce:subscription.addressDialogTitle')}
                description={t('commerce:subscription.addressDialogBody')}
                actions={
                    <>
                        <Button
                            testID="subscription-address-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="subscription-address-confirm"
                            label={t('commerce:subscription.addressConfirm')}
                            loading={changeAddress.isPending}
                            onPress={() => {
                                if (subscription === undefined) return;
                                if (addressId === null) {
                                    setShowAddressErrors(true);
                                    return;
                                }
                                const selected = addressList.find(
                                    (entry) => entry.id === addressId,
                                );
                                changeAddress.mutate(
                                    {
                                        subscriptionId: subscription.id,
                                        request: {
                                            address:
                                                selected === undefined
                                                    ? subscription.configuration.address
                                                    : {
                                                          label: selected.label,
                                                          line1: selected.line1,
                                                          line2: selected.line2,
                                                          area: selected.areaName,
                                                          city: '',
                                                          countryCode: '',
                                                          instructions: selected.notes,
                                                      },
                                            addressId,
                                        },
                                    },
                                    { onSuccess: close },
                                );
                            }}
                        />
                    </>
                }
            >
                <Select
                    testID="subscription-address-picker"
                    label={t('commerce:subscription.addressDialogTitle')}
                    value={addressId}
                    onChange={setAddressId}
                    options={addressList.map((entry) => ({
                        value: entry.id,
                        label: [entry.label, entry.line1, entry.areaName]
                            .filter((part) => part.trim() !== '')
                            .join(' · '),
                    }))}
                    placeholder={t('commerce:subscription.addressDialogTitle')}
                />
                {showAddressErrors && addressId === null ? (
                    <Text tone="danger" variant="caption" testID="subscription-address-error">
                        {t('commerce:validation.required')}
                    </Text>
                ) : null}
            </Dialog>

            {/* ── change slot and delivery days ──────────────────────────────────────────────── */}
            <Dialog
                testID="subscription-slot-dialog"
                open={dialog === 'slot'}
                onClose={close}
                title={t('commerce:subscription.slotDialogTitle')}
                description={t('commerce:subscription.slotDialogBody')}
                actions={
                    <>
                        <Button
                            testID="subscription-slot-cancel"
                            variant="quiet"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <Button
                            testID="subscription-slot-confirm"
                            label={t('commerce:subscription.slotConfirm')}
                            loading={changeSlot.isPending}
                            onPress={() => {
                                if (subscription === undefined || slotCode === null) return;
                                changeSlot.mutate(
                                    {
                                        subscriptionId: subscription.id,
                                        request: {
                                            slotCode,
                                            ...(weekdays === null || weekdays.length === 0
                                                ? {}
                                                : {
                                                      deliveryWeekdays: [...weekdays].sort(
                                                          (left, right) => left - right,
                                                      ),
                                                  }),
                                        },
                                    },
                                    { onSuccess: close },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="md">
                    <SegmentedControl
                        testID="subscription-slot-picker"
                        label={t('commerce:subscription.slotDialogTitle')}
                        block
                        value={slotCode ?? ''}
                        onChange={setSlotCode}
                        items={DELIVERY_SLOTS.map((slot) => ({
                            value: slot.code,
                            label: t(`commerce:slots.${slot.code}`),
                            testID: `subscription-slot-${slot.code}`,
                        }))}
                    />
                    <Stack space="xs">
                        <Text variant="label">{t('commerce:subscription.slotDaysTitle')}</Text>
                        <Inline space="xs" wrap>
                            {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
                                <FilterChip
                                    key={weekday}
                                    testID={`subscription-slot-weekday-${String(weekday)}`}
                                    label={t(weekdayKey(weekday))}
                                    selected={(weekdays ?? []).includes(weekday)}
                                    onChange={(selected) => {
                                        const current = weekdays ?? [];
                                        setWeekdays(
                                            selected
                                                ? [...current, weekday]
                                                : current.filter((value) => value !== weekday),
                                        );
                                    }}
                                />
                            ))}
                        </Inline>
                        <Text tone="secondary" variant="caption">
                            {t('commerce:subscription.slotDaysNote')}
                        </Text>
                    </Stack>
                </Stack>
            </Dialog>
            {/* ── delivery weekdays, from the plan's real availability ───────────────────────── */}
            <WeekdayEditorDialog
                open={dialog === 'weekdays'}
                quote={quoteQuery.data}
                balance={balanceQuery.data}
                selected={editedWeekdays ?? subscription?.configuration.deliveryWeekdays ?? []}
                pending={changeWeekdays.isPending}
                onChange={setEditedWeekdays}
                onClose={close}
                onConfirm={() => {
                    if (subscription === undefined || editedWeekdays === null) return;
                    changeWeekdays.mutate(
                        {
                            subscriptionId: subscription.id,
                            request: { deliveryWeekdays: editedWeekdays },
                        },
                        { onSuccess: close },
                    );
                }}
            />

            {/* ── Free Selection, for the next delivery day ──────────────────────────────────── */}
            <MealChoicesDialog
                open={dialog === 'choices'}
                date={subscription?.nextDeliveryDate ?? null}
                options={(menu.data?.items ?? []).map((meal) => ({
                    id: meal.id,
                    name: meal.name,
                }))}
                current={[]}
                slotCode={subscription?.configuration.slotCode ?? ''}
                pending={setMealChoices.isPending}
                onClose={close}
                onConfirm={(mealId) => {
                    if (subscription?.nextDeliveryDate == null) return;
                    setMealChoices.mutate(
                        {
                            subscriptionId: subscription.id,
                            request: {
                                date: subscription.nextDeliveryDate,
                                choices: [{ slot: subscription.configuration.slotCode, mealId }],
                            },
                        },
                        { onSuccess: close },
                    );
                }}
            />

            {/* ── cancel, and the credit memo it records ─────────────────────────────────────── */}
            <CancelSubscriptionDialog
                open={dialog === 'cancel'}
                balance={balanceQuery.data}
                memo={cancel.data === undefined ? undefined : cancel.data.creditMemo}
                pending={cancel.isPending}
                onClose={close}
                onConfirm={() => {
                    if (subscription === undefined) return;
                    // No `onSuccess: close`. The dialog stays open to report the memo the server
                    // actually wrote — the one number a person needs to take away from this.
                    cancel.mutate({ subscriptionId: subscription.id });
                }}
            />
        </Stack>
    );
}

interface TimelineProps {
    readonly subscription: Subscription;
}

/**
 * What the record shows.
 *
 * Not a history: `Subscription` carries no event log, so this reports the five facts it does carry
 * and labels them as facts about the record. The alternative — inferring "paused on the 14th" from
 * `updatedAt` — would be a plausible sentence the data does not support.
 */
function SubscriptionTimeline({ subscription }: TimelineProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="sm" testID="subscription-detail-timeline">
            <Text variant="label">{t('commerce:subscription.timelineTitle')}</Text>

            <Stack space="xs">
                <Inline space="sm" align="center" testID="subscription-timeline-created">
                    <Badge tone="neutral" icon="dot" label={t('commerce:subscription.created')} />
                    <Text>
                        {formatter.formatDate(subscription.createdAt, { dateStyle: 'medium' })}
                    </Text>
                </Inline>

                <Inline space="sm" align="center" testID="subscription-timeline-state">
                    <SubscriptionStateBadge
                        state={subscription.state}
                        testID="subscription-timeline-state-badge"
                    />
                    <Text>
                        {t('commerce:subscription.stateSince', {
                            date: formatter.formatDate(subscription.updatedAt, {
                                dateStyle: 'medium',
                            }),
                        })}
                    </Text>
                </Inline>

                {subscription.pausedUntil === null ? null : (
                    <Inline space="sm" align="center" testID="subscription-timeline-paused-until">
                        <Badge
                            tone="warning"
                            icon="offline"
                            label={t('commerce:subscription.pausedUntilBadge')}
                        />
                        <Text>
                            {formatter.formatDate(subscription.pausedUntil, {
                                dateStyle: 'medium',
                            })}
                        </Text>
                    </Inline>
                )}

                <Inline space="sm" align="center" wrap testID="subscription-timeline-skipped">
                    <Badge
                        tone="info"
                        icon="info"
                        label={t('commerce:subscription.skippedBadge')}
                    />
                    <Text testID="subscription-timeline-skipped-value">
                        {subscription.skippedDates.length === 0
                            ? t('commerce:subscription.noSkippedDates')
                            : subscription.skippedDates
                                  .map((date) =>
                                      formatter.formatDate(date, { dateStyle: 'medium' }),
                                  )
                                  .join(t('commerce:common.listSeparator'))}
                    </Text>
                </Inline>
            </Stack>

            <Text tone="secondary" variant="caption" testID="subscription-timeline-note">
                {t('commerce:subscription.timelineNote')}
            </Text>
        </Stack>
    );
}
