import {
    ActionSheet,
    Breadcrumbs,
    Button,
    Callout,
    Dialog,
    EmptyState,
    FilterChip,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type {
    Subscription,
    CustomerAddress,
    MarketplaceMeal,
} from '@healthy360/api-client/contracts';
import { SubscriptionId, planDurationDays } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    useCancelSubscriptionMutation,
    useChangeAddressMutation,
    useChangeSlotMutation,
    usePauseSubscriptionMutation,
    useResumeSubscriptionMutation,
    useSetSubscriptionMealChoicesMutation,
    useSetSubscriptionWeekdaysMutation,
    useSkipDayMutation,
    useSubscriptionBalanceQuery,
    useSubscriptionDaysQuery,
    useSubscriptionDeliveriesQuery,
    useSubscriptionQuery,
    useSubscriptionQuoteQuery,
} from '../../../data/commerce-hooks.ts';
import { useAddressesQuery } from '../../../data/account-hooks.ts';
import { mealsFromPages, useMealsQuery } from '../../../data/catalogue-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useCurrentHref } from '../../../navigation/use-return-to.ts';
import { subscriptionDayPrice } from '../../catalogue/plan-balance.ts';
import { durationWithBalance } from '../../catalogue/plan-duration-label.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { weekdayRun } from '../configurator-steps.tsx';
import { savedAddressValues } from '../configurator.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { formatAddress, toDeliveryAddress } from '../address.ts';
import { todayIso, upcomingDeliveryDates } from '../dates.ts';
import { DELIVERY_SLOTS } from '../delivery.ts';
import { PlanAllergyNotice } from '../my-allergens.tsx';
import {
    SubscriptionStateBadge,
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from '../state-badge.tsx';
import { SubscriptionBalanceCard, SubscriptionDeliveries } from '../subscription-balance.tsx';
import { SubscriptionMeals } from '../subscription-meals.tsx';
import { CardPanel, SummaryCard } from '../summary-card.tsx';
import type { SummaryCardRow } from '../summary-card.tsx';
import {
    CancelSubscriptionDialog,
    DialogFailure,
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
 * rejections are rendered rather than swallowed, inside the dialog that asked (`DialogFailure`): the
 * dialogs are modal and stay open on a refusal, so a notice on the page underneath was drawn behind
 * the backdrop (plans-09). The controls a state does not permit are not shown at all, so the
 * rejection path is a safety net rather than the normal route; but the net is real, because a stale
 * screen and a changed subscription is an ordinary Tuesday.
 *
 * ## Cancelled and expired are read-only
 *
 * There is no control on a finished subscription, and the screen says why — and where to go from
 * here: the same plan again, or the list (plans-13). Doc 11, `MGT-06` and `MGT-08` record the
 * reference's own terms drawing the same line between a live package and a finished one.
 *
 * ## What arrives in the URL
 *
 * - `?created=1` — the set-up replaced itself with this page once the subscription existed, and the
 *   confirmation is said here, where a refresh still finds it (plans-04). Dismissing it takes the
 *   flag off the entry.
 * - `?dialog=address&address={id}` — the way back from "Add a new address" in the address dialog.
 *   The page is a sibling in the customer `<Slot/>`, so the detour unmounted it; the dialog opens
 *   again on the address just saved, and both parameters are taken off the entry (plans-06).
 *
 * ## Laid out as cards
 *
 * The opening states the plan, its state, its weekly price and the next delivery. Below it, from
 * `lg`, two columns: "Your plan" (every setting, each changeable one with its own Change beside it)
 * above the deliveries ledger, and beside them the "Manage" card — the balance and the actions —
 * which stays in view while the ledger scrolls. Skipped days are a row of the plan card rather than
 * a separate timeline: `Subscription` publishes no event log, so they are stated as current facts
 * and nothing is inferred about when they happened.
 *
 * ## The allergy list is shown, not stored
 *
 * A subscription carries no allergen list of its own; the kitchen reads the customer's profile at
 * generation. So the plan card shows that list against the plan's dishes, and the way to change it
 * — the row that used to say "Nothing left out" was reading a field nothing ever wrote (plans-16).
 */

export interface SubscriptionDetailScreenProps {
    readonly subscriptionId: string | undefined;
}

type DialogKey =
    'pause' | 'resume' | 'skip' | 'address' | 'slot' | 'weekdays' | 'choices' | 'cancel';
type OpenDialog = DialogKey | null;

const ACCOUNT_HREF = '/customer/account';
const SUBSCRIPTIONS_HREF = '/customer/account?section=subscriptions';

function single(value: string | string[] | undefined): string | null {
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined || first === '' ? null : first;
}

/** How many upcoming delivery days the skip sheet offers. */
const SKIP_CHOICES = 6;

export function SubscriptionDetailScreen({ subscriptionId }: SubscriptionDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const here = useCurrentHref();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{
        created?: string;
        dialog?: string;
        address?: string;
    }>();
    const justCreated = single(params.created) === '1';
    const requestedDialog = single(params.dialog) === 'address' ? 'address' : null;
    const requestedAddress = single(params.address);

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

    // The customer's meals, day by day, and the kitchen's menu they were chosen from — what a day
    // may be changed to, and what the allergy notice checks the chosen dishes against.
    const daysQuery = useSubscriptionDaysQuery(parsed);
    const kitchenMeals = useMealsQuery(
        subscription === undefined
            ? undefined
            : { kitchenIds: [subscription.kitchenId], itemTypes: ['meal'], limit: 50 },
        subscription !== undefined,
    );
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = kitchenMeals;
    useEffect(() => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
    const menu = useMemo(() => mealsFromPages(kitchenMeals.data?.pages), [kitchenMeals.data]);
    const chosenMeals = useMemo<readonly MarketplaceMeal[]>(() => {
        const ids = new Set(
            (daysQuery.data?.days ?? []).flatMap((day) =>
                day.meals.map((meal) => String(meal.mealId)),
            ),
        );
        return menu.filter((meal) => ids.has(String(meal.id)));
    }, [daysQuery.data, menu]);

    const [dialog, setDialog] = useState<OpenDialog>(null);
    const [skipSheetOpen, setSkipSheetOpen] = useState(false);
    const [skipDate, setSkipDate] = useState<string | null>(null);
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
     * Every dialog opens on a clean slate: its mutation is reset first, so the refusal of an earlier
     * attempt is never what greets the next one. The refusal itself is drawn inside the dialog.
     */
    const mutations: Readonly<Record<DialogKey, { readonly reset: () => void }>> = {
        pause,
        resume,
        skip: skipDay,
        address: changeAddress,
        slot: changeSlot,
        weekdays: changeWeekdays,
        choices: setMealChoices,
        cancel,
    };
    const openDialog = (next: DialogKey) => {
        mutations[next].reset();
        setDialog(next);
    };

    /*
     * `?dialog=address` — back from adding an address — reopens the address dialog on the address
     * just saved, once the subscription is known to still take one. Adjusted during render rather
     * than in an effect, so the page never paints a frame without the dialog it was asked for; the
     * parameters then come off the entry, so a refresh or a Back onto it does not open it again.
     */
    const dialogRequest =
        requestedDialog === null ? null : `${requestedDialog}:${requestedAddress ?? ''}`;
    const [handledRequest, setHandledRequest] = useState<string | null>(null);
    if (dialogRequest !== null && dialogRequest !== handledRequest && subscription !== undefined) {
        setHandledRequest(dialogRequest);
        if (canChangeDelivery(subscription.state)) {
            setAddressId(requestedAddress);
            setShowAddressErrors(false);
            setDialog('address');
        }
    }
    const requestHandled = dialogRequest !== null && dialogRequest === handledRequest;
    useEffect(() => {
        if (!requestHandled) return;
        router.setParams({ dialog: undefined, address: undefined } as never);
    }, [requestHandled, router]);

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
            // Up to the list by name — popping to it when it is underneath, never stacking a copy.
            onPress={() => {
                router.dismissTo(SUBSCRIPTIONS_HREF as never);
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

    const separator = t('commerce:common.listSeparator');
    const live = subscription !== undefined && !readOnly;
    const canChange = subscription !== undefined && canChangeDelivery(subscription.state);

    const configurationRows: readonly SummaryCardRow[] =
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
                      value: durationWithBalance(
                          planDurationDays(subscription.configuration.duration),
                          t,
                          formatter.formatNumber,
                      ),
                  },
                  // "Starts" until the first delivery day has come, "Started" after it; the date
                  // is the first delivery, which the server states once one is planned.
                  {
                      key: 'start',
                      label:
                          subscription.configuration.startDate > todayIso()
                              ? t('commerce:subscription.rows.startsOn')
                              : t('commerce:subscription.rows.start'),
                      value:
                          subscription.configuration.startDate === ''
                              ? t('commerce:subscription.rows.startUnknown')
                              : formatter.formatDate(subscription.configuration.startDate, {
                                    dateStyle: 'medium',
                                }),
                  },
                  {
                      key: 'days',
                      label: t('commerce:subscription.rows.days'),
                      value: weekdayRun(subscription.configuration.deliveryWeekdays, t),
                      ...(canChange
                          ? {
                                action: {
                                    label: t('commerce:subscription.change'),
                                    accessibilityLabel: t('commerce:weekdays.open'),
                                    testID: 'subscription-change-weekdays',
                                    onPress: () => {
                                        setEditedWeekdays([
                                            ...subscription.configuration.deliveryWeekdays,
                                        ]);
                                        openDialog('weekdays');
                                    },
                                },
                            }
                          : {}),
                  },
                  {
                      key: 'slot',
                      label: t('commerce:subscription.rows.slot'),
                      value: t(`commerce:slots.${subscription.configuration.slotCode}`, {
                          defaultValue: subscription.configuration.slotCode,
                      }),
                      ...(canChange
                          ? {
                                action: {
                                    label: t('commerce:subscription.change'),
                                    accessibilityLabel: t('commerce:subscription.changeSlot'),
                                    testID: 'subscription-change-slot',
                                    onPress: () => {
                                        setSlotCode(subscription.configuration.slotCode);
                                        setWeekdays([
                                            ...subscription.configuration.deliveryWeekdays,
                                        ]);
                                        openDialog('slot');
                                    },
                                },
                            }
                          : {}),
                  },
                  {
                      key: 'address',
                      label: t('commerce:subscription.rows.address'),
                      value: formatAddress(subscription.configuration.address),
                      ...(canChange
                          ? {
                                action: {
                                    label: t('commerce:subscription.change'),
                                    accessibilityLabel: t('commerce:subscription.changeAddress'),
                                    testID: 'subscription-change-address',
                                    onPress: () => {
                                        setAddressId(null);
                                        openDialog('address');
                                    },
                                },
                            }
                          : {}),
                  },
                  ...(subscription.skippedDates.length === 0
                      ? []
                      : [
                            {
                                key: 'skipped',
                                testID: 'subscription-timeline-skipped',
                                label: t('commerce:subscription.skippedBadge'),
                                value: subscription.skippedDates
                                    .map((date) =>
                                        formatter.formatDate(date, { dateStyle: 'medium' }),
                                    )
                                    .join(separator),
                            },
                        ]),
              ];

    return (
        <View testID="subscription-detail-screen" className="flex-col">
            {/* Each crumb goes up to the page it names, by `dismissTo`: back to that entry when it is
                underneath, a replace otherwise — never a push that makes Back loop. */}
            <Breadcrumbs
                testID="subscription-detail-breadcrumbs"
                items={[
                    {
                        key: 'account',
                        label: t('commerce:subscription.crumbAccount'),
                        testID: 'subscription-detail-crumb-account',
                        onPress: () => {
                            router.dismissTo(ACCOUNT_HREF as never);
                        },
                    },
                    {
                        key: 'subscriptions',
                        label: t('commerce:subscription.crumbSubscriptions'),
                        testID: 'subscription-detail-crumb-subscriptions',
                        onPress: () => {
                            router.dismissTo(SUBSCRIPTIONS_HREF as never);
                        },
                    },
                    // The page itself. A trail's last crumb is drawn as "you are here" and is not
                    // a link, so without it "Subscriptions" was the current page and could not be
                    // pressed.
                    {
                        key: 'subscription',
                        label: subscription?.planName ?? t('commerce:subscription.planTitle'),
                    },
                ]}
            />
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
                    <View className="mt-3 flex-col gap-6">
                        {justCreated ? (
                            <Callout
                                testID="subscription-created"
                                role="status"
                                tone="success"
                                icon="success"
                                title={t('commerce:configurator.successTitle')}
                                body={t('commerce:configurator.successBody', {
                                    plan: subscription.planName,
                                })}
                                actions={
                                    <Button
                                        testID="subscription-created-dismiss"
                                        variant="quiet"
                                        size="sm"
                                        label={t('common:action.dismiss')}
                                        onPress={() => {
                                            router.setParams({ created: undefined } as never);
                                        }}
                                    />
                                }
                            />
                        ) : null}

                        {/* The opening: the plan, its state on the title's line, and the two facts
                            somebody opens this page for — what it costs and when the next one comes. */}
                        <View className="flex-col gap-1.5">
                            <View className="flex-row flex-wrap items-center gap-3">
                                <RNText
                                    testID="subscription-detail-name"
                                    accessibilityRole="header"
                                    aria-level={1}
                                    className="self-start text-4xl leading-[1.05] tracking-display text-content-primary text-start"
                                >
                                    {subscription.planName}
                                </RNText>
                                <SubscriptionStateBadge
                                    state={subscription.state}
                                    testID="subscription-detail-state"
                                />
                            </View>
                            <View className="flex-row flex-wrap items-baseline gap-x-2">
                                <RNText
                                    testID="subscription-detail-price"
                                    className="text-base text-content-primary text-start"
                                >
                                    {t('commerce:subscriptions.dayPrice', {
                                        price: formatMoney(
                                            formatter,
                                            subscriptionDayPrice(subscription),
                                        ),
                                    })}
                                </RNText>
                                <RNText aria-hidden className="text-base text-content-secondary">
                                    ·
                                </RNText>
                                <RNText
                                    testID="subscription-detail-next"
                                    className="text-base text-content-secondary text-start"
                                >
                                    {subscription.nextDeliveryDate === null
                                        ? t('commerce:subscriptions.noNextDelivery')
                                        : t('commerce:subscriptions.nextDelivery', {
                                              date: formatter.formatDate(
                                                  subscription.nextDeliveryDate,
                                                  { dateStyle: 'full' },
                                              ),
                                          })}
                                </RNText>
                            </View>
                        </View>

                        <View className="flex-col gap-4 lg:flex-row lg:items-start lg:gap-6">
                            <View className="min-w-0 flex-col gap-4 lg:flex-1">
                                <SummaryCard
                                    testID="subscription-detail-configuration"
                                    title={t('commerce:subscription.planTitle')}
                                    rows={configurationRows.map((row) => ({
                                        ...row,
                                        testID: row.testID ?? `subscription-detail-row-${row.key}`,
                                    }))}
                                />

                                <SubscriptionMeals
                                    days={daysQuery.data}
                                    loading={daysQuery.isLoading}
                                    menu={menu}
                                    menuLoading={!kitchenMeals.isFetched || hasNextPage}
                                    canChange={live}
                                    busy={busy}
                                    pending={setMealChoices.isPending}
                                    error={setMealChoices.error}
                                    onOpen={() => {
                                        setMealChoices.reset();
                                    }}
                                    onSave={(date, meals, saved) => {
                                        setMealChoices.mutate(
                                            {
                                                subscriptionId: subscription.id,
                                                request: { date, choices: meals },
                                            },
                                            { onSuccess: saved },
                                        );
                                    }}
                                />

                                <SummaryCard
                                    testID="subscription-detail-allergies"
                                    title={t('commerce:subscription.rows.allergens')}
                                >
                                    <PlanAllergyNotice
                                        testID="subscription-detail-allergy-notice"
                                        meals={chosenMeals}
                                        checked={daysQuery.isFetched && kitchenMeals.isFetched}
                                        returnTo={here}
                                    />
                                </SummaryCard>

                                <SubscriptionDeliveries
                                    deliveries={deliveriesQuery.data?.items ?? []}
                                />
                            </View>

                            {/* Beside the plan from `lg`, and in view while it scrolls. */}
                            <View className="flex-col lg:w-[320px] web:lg:sticky web:lg:top-6">
                                <CardPanel testID="subscription-detail-manage">
                                    <RNText
                                        accessibilityRole="header"
                                        aria-level={2}
                                        className="self-start text-base font-semibold text-content-primary text-start"
                                    >
                                        {t('commerce:subscription.manageTitle')}
                                    </RNText>

                                    {balanceQuery.data === undefined ? null : (
                                        <SubscriptionBalanceCard balance={balanceQuery.data} />
                                    )}

                                    {readOnly ? (
                                        <Callout
                                            testID="subscription-detail-read-only"
                                            role="note"
                                            tone="info"
                                            title={t('commerce:subscription.readOnlyTitle')}
                                            body={t(
                                                `commerce:subscription.readOnly.${subscription.state}`,
                                            )}
                                            // A finished subscription is a place to leave from:
                                            // the same plan again, on the same band, or the list.
                                            actions={
                                                <>
                                                    <Button
                                                        testID="subscription-detail-plan-again"
                                                        size="sm"
                                                        label={t(
                                                            'commerce:subscription.choosePlanAgain',
                                                        )}
                                                        onPress={() => {
                                                            router.push(
                                                                withQuery(
                                                                    `/plans/${String(subscription.configuration.planId)}`,
                                                                    {
                                                                        variant: String(
                                                                            subscription
                                                                                .configuration
                                                                                .variantId,
                                                                        ),
                                                                    },
                                                                ) as never,
                                                            );
                                                        }}
                                                    />
                                                    {listAction}
                                                </>
                                            }
                                        />
                                    ) : null}

                                    {live ? (
                                        <View
                                            testID="subscription-detail-actions"
                                            className="flex-col gap-2"
                                        >
                                            {canPauseOrSkip(subscription.state) ? (
                                                <Button
                                                    testID="subscription-skip"
                                                    variant="secondary"
                                                    block
                                                    label={t('commerce:subscription.skip')}
                                                    disabled={busy || upcoming.length === 0}
                                                    onPress={() => {
                                                        setSkipSheetOpen(true);
                                                    }}
                                                />
                                            ) : null}
                                            {canPauseOrSkip(subscription.state) ? (
                                                <Button
                                                    testID="subscription-pause"
                                                    variant="secondary"
                                                    block
                                                    label={t('commerce:subscription.pause')}
                                                    disabled={busy}
                                                    onPress={() => {
                                                        openDialog('pause');
                                                    }}
                                                />
                                            ) : null}
                                            {canResume(subscription.state) ? (
                                                <Button
                                                    testID="subscription-resume"
                                                    block
                                                    label={t('commerce:subscription.resume')}
                                                    disabled={busy}
                                                    onPress={() => {
                                                        openDialog('resume');
                                                    }}
                                                />
                                            ) : null}
                                            {/*
                                             * Cancellation is last and quiet, and it is offered from
                                             * every non-terminal state — including `paused`, because
                                             * a paused subscription is still somebody's money.
                                             */}
                                            <Pressable
                                                testID="subscription-cancel-open"
                                                role="button"
                                                accessibilityRole="button"
                                                disabled={busy}
                                                aria-disabled={busy}
                                                accessibilityState={{ disabled: busy }}
                                                onPress={() => {
                                                    openDialog('cancel');
                                                }}
                                                className="min-h-touch items-center justify-center"
                                            >
                                                <RNText className="text-sm font-semibold text-danger-on-subtle hover:underline">
                                                    {t('commerce:cancel.open')}
                                                </RNText>
                                            </Pressable>
                                        </View>
                                    ) : null}
                                </CardPanel>
                            </View>
                        </View>
                    </View>
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
                        openDialog('skip');
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
                                    { subscriptionId: subscription.id },
                                    { onSuccess: close },
                                );
                            }}
                        />
                    </>
                }
            >
                {/* No "resume on" date: the platform has no scheduled resume, and the field that
                    used to ask for one collected a date nothing acted on. */}
                <Stack space="sm">
                    <Callout
                        testID="subscription-pause-consequence"
                        role="note"
                        tone="warning"
                        icon="info"
                        title={t('commerce:subscription.pauseConsequenceTitle')}
                        body={t('commerce:subscription.pauseConsequenceOpen')}
                    />
                    <DialogFailure error={pause.error} testID="subscription-pause-failure" />
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
            >
                <DialogFailure error={resume.error} testID="subscription-resume-failure" />
            </Dialog>

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
                <Stack space="sm">
                    <Callout
                        testID="subscription-skip-consequence"
                        role="note"
                        tone="warning"
                        icon="info"
                        title={t('commerce:subscription.skipConsequenceTitle')}
                        body={t('commerce:subscription.skipConsequenceBody')}
                    />
                    <DialogFailure error={skipDay.error} testID="subscription-skip-failure" />
                </Stack>
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
                                                    : toDeliveryAddress(
                                                          savedAddressValues(selected),
                                                      ),
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
                <Stack space="sm">
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
                    {/*
                     * The address that is needed may not be saved yet. The editor saves it and comes
                     * back here with `?dialog=address&address={new id}`, which reopens this dialog
                     * on it — rather than ending on the address list, three pages from here.
                     */}
                    <View className="self-start">
                        <Button
                            testID="subscription-address-add"
                            variant="quiet"
                            size="sm"
                            label={t('commerce:subscription.addAddress')}
                            onPress={() => {
                                if (subscription === undefined) return;
                                setDialog(null);
                                router.push(
                                    withReturnTo(
                                        '/customer/account/addresses/new',
                                        withQuery(
                                            `/customer/subscriptions/${String(subscription.id)}`,
                                            { dialog: 'address' },
                                        ),
                                    ) as never,
                                );
                            }}
                        />
                    </View>
                    <DialogFailure
                        error={changeAddress.error}
                        testID="subscription-address-failure"
                    />
                </Stack>
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
                    <DialogFailure error={changeSlot.error} testID="subscription-slot-failure" />
                </Stack>
            </Dialog>
            {/* ── delivery weekdays, from the plan's real availability ───────────────────────── */}
            <WeekdayEditorDialog
                open={dialog === 'weekdays'}
                quote={quoteQuery.data}
                balance={balanceQuery.data}
                selected={editedWeekdays ?? subscription?.configuration.deliveryWeekdays ?? []}
                pending={changeWeekdays.isPending}
                error={changeWeekdays.error}
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

            {/* ── cancel, and the credit memo it records ─────────────────────────────────────── */}
            <CancelSubscriptionDialog
                open={dialog === 'cancel'}
                balance={balanceQuery.data}
                memo={cancel.data === undefined ? undefined : cancel.data.creditMemo}
                pending={cancel.isPending}
                error={cancel.error}
                onClose={close}
                onConfirm={() => {
                    if (subscription === undefined) return;
                    // No `onSuccess: close`. The dialog stays open to report the memo the server
                    // actually wrote — the one number a person needs to take away from this.
                    cancel.mutate({ subscriptionId: subscription.id });
                }}
            />
        </View>
    );
}
