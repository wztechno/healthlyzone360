import { Icon, Stack, cx } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    Subscription,
    SubscriptionDelivery,
} from '@healthy360/api-client/contracts';
import type { SubscriptionState } from '@healthy360/domain-types';
import { SubscriptionId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ReactNode } from 'react';
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
import { mealsFromPages, useMealsQuery, usePlanQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { useCurrentHref } from '../../../navigation/use-return-to.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { ShopStateButton, ShopStateCard } from '../../../ui/shop-state.tsx';
import {
    ShopDialog,
    ShopDialogButton,
    ShopDialogConsequence,
    ShopDialogDateTile,
    ShopDialogSubject,
} from '../../../ui/shop-dialog.tsx';
import { subscriptionDayPrice } from '../../catalogue/plan-balance.ts';
import { TINT_FILL, TINT_INK } from '../../catalogue/shelf-tints.ts';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { formatAddress, toDeliveryAddress } from '../address.ts';
import { bandLabel, mealsLine, weekdayRun } from '../configurator-steps.tsx';
import { savedAddressValues } from '../configurator.ts';
import { upcomingDeliveryDates } from '../dates.ts';
import { DaysRing } from '../days-ring';
import { deliverySlotsForKitchen } from '../delivery.ts';
import { PlanAllergyNotice } from '../my-allergens.tsx';
import {
    canChangeDelivery,
    canPauseOrSkip,
    canResume,
    isTerminalSubscriptionState,
} from '../state-badge.tsx';
import {
    LEDGER_TABS,
    estimatedEndDate,
    inLedgerTab,
    ledgerTag,
    windowLine,
} from '../subscription-board.ts';
import type { LedgerTab } from '../subscription-board.ts';
import {
    CancelSubscriptionDialog,
    DialogFailure,
    InlineFailure,
    PauseResumeDialog,
    WeekdayEditor,
    shortWeekday,
} from '../subscription-editors.tsx';
import { SubscriptionMeals } from '../subscription-meals.tsx';

/**
 * `/customer/subscriptions/{subscription}` — one subscription, as the accepted Subscription board
 * draws it: what is left of it, what happened to the rest, and the things a person can do to it.
 *
 * ## The board's layout
 *
 * A back pill to the account's Subscriptions, then two rows. The first is three cards: the plan
 * (state, name, kitchen, its band and day price) on its tint, the balance ring (days left beside
 * Bought / Used / Skipped, free / Lasts until about), and the next delivery on the canopy with the
 * actions the state allows — Skip a day and Pause, or Resume, or "Set up this plan again". The second
 * row is "Your plan" — four tiles, each with its own Change that opens an editor inside the tile —
 * beside the Deliveries ledger with its All / Delivered / Skipped tabs. "Pick meals" opens the
 * day-by-day meals and the allergy check under both.
 *
 * ## Every action is a real transition, and guarded
 *
 * Pause, resume, skip a day, the address, the window, the weekdays, a day's meals and cancelling all
 * call the repository and change the world. The repository refuses a transition the state does not
 * allow and answers with a sentence a person can read; those refusals are drawn where the person
 * asked — inside the dialog, or under the tile's editor (`DialogFailure`) — rather than swallowed.
 * Every dialog and editor resets its mutation as it opens, so an old refusal never greets a fresh
 * attempt. The controls a state does not permit are not drawn at all.
 *
 * ## Cancelled and expired are read-only
 *
 * No Change, no Skip, no Cancel. The next-delivery card says there are no more deliveries and offers
 * the same plan again, on the same band (plans-13).
 *
 * ## What arrives in the URL
 *
 * - `?created=1` — the set-up replaced itself with this page once the subscription existed; "Your
 *   plan is set up" is said here, where a refresh still finds it (plans-04). Dismissing it takes the
 *   flag off the entry.
 * - `?dialog=address&address={id}` — the way back from "Add address" in the address editor. The
 *   page is a sibling in the customer `<Slot/>`, so the detour unmounted it; the editor opens again
 *   with the address just saved first among the choices, and both parameters come off the entry.
 * - `?meals=1` and `?skip=1` — the account card's Change meals and Skip a day, which open the
 *   meals or the skip days here.
 *
 * ## The allergy list is shown, not stored
 *
 * A subscription carries no allergen list of its own; the kitchen reads the customer's profile at
 * generation. So the meals section shows that list against the plan's dishes, and the way to change
 * it (plans-16).
 */

export interface SubscriptionDetailScreenProps {
    readonly subscriptionId: string | undefined;
}

type DialogKey = 'pause' | 'resume' | 'skip' | 'cancel';
type EditorKey = 'address' | 'slot' | 'days';

const SUBSCRIPTIONS_HREF = '/customer/account?section=subscriptions';

function single(value: string | string[] | undefined): string | null {
    const first = Array.isArray(value) ? value[0] : value;
    return first === undefined || first === '' ? null : first;
}

/** How many upcoming delivery days "Skip a day" offers — the board's four. */
const SKIP_CHOICES = 4;

/** The state pill's dot: brand while delivering, amber while paused, grey once over. */
function stateDot(state: SubscriptionState): string {
    if (state === 'paused') return 'bg-stage-orange';
    if (isTerminalSubscriptionState(state) || state === 'draft') return 'bg-stroke-strong';
    return 'bg-surface-brand';
}

export function SubscriptionDetailScreen({ subscriptionId }: SubscriptionDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const here = useCurrentHref();
    const formatter = useFormatter();
    const params = useLocalSearchParams<{
        created?: string;
        dialog?: string;
        address?: string;
        meals?: string;
        skip?: string;
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
     * The plan's real availability, in one read — keyed by the plan and the variant, so enabled only
     * once the subscription has landed. It is what the weekday editor offers.
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
    const plan = usePlanQuery(subscription?.configuration.planId ?? null);
    const variant = plan.data?.variants.find(
        (each) => each.id === subscription?.configuration.variantId,
    );
    const kitchen = useKitchenQuery(subscription?.kitchenId ?? null);
    const slots = useMemo(() => deliverySlotsForKitchen(kitchen.data), [kitchen.data]);

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

    const [dialog, setDialog] = useState<DialogKey | null>(null);
    const [editing, setEditing] = useState<EditorKey | null>(null);
    const [skipOpen, setSkipOpen] = useState(() => single(params.skip) === '1');
    const [mealsOpen, setMealsOpen] = useState(() => single(params.meals) === '1');
    const [skipDate, setSkipDate] = useState<string | null>(null);
    const [freshAddress, setFreshAddress] = useState<string | null>(null);
    const [editedWeekdays, setEditedWeekdays] = useState<readonly number[] | null>(null);
    const [tab, setTab] = useState<LedgerTab>('all');

    const addresses = useAddressesQuery(editing === 'address');
    const addressList: readonly CustomerAddress[] = addresses.data ?? [];

    const pause = usePauseSubscriptionMutation();
    const resume = useResumeSubscriptionMutation();
    const skipDay = useSkipDayMutation();
    const changeAddress = useChangeAddressMutation();
    const changeSlot = useChangeSlotMutation();
    const changeWeekdays = useSetSubscriptionWeekdaysMutation();
    const setMealChoices = useSetSubscriptionMealChoicesMutation();
    const cancel = useCancelSubscriptionMutation();

    /** Every dialog opens on a clean slate: its mutation is reset first. */
    const dialogMutations: Readonly<Record<DialogKey, { readonly reset: () => void }>> = {
        pause,
        resume,
        skip: skipDay,
        cancel,
    };
    const openDialog = (next: DialogKey) => {
        dialogMutations[next].reset();
        setDialog(next);
    };
    /** And so does every tile's editor; a second Change on the same tile closes it. */
    const editorMutations: Readonly<Record<EditorKey, { readonly reset: () => void }>> = {
        address: changeAddress,
        slot: changeSlot,
        days: changeWeekdays,
    };
    const toggleEditor = (next: EditorKey) => {
        if (editing === next) {
            setEditing(null);
            return;
        }
        editorMutations[next].reset();
        if (next === 'days' && subscription !== undefined) {
            setEditedWeekdays([...subscription.configuration.deliveryWeekdays]);
        }
        setEditing(next);
    };

    /*
     * `?dialog=address` — back from adding an address — reopens the address editor with the address
     * just saved first, once the subscription is known to still take one. Adjusted during render
     * rather than in an effect, so the page never paints a frame without the editor it was asked
     * for; the parameters then come off the entry, so a refresh or a Back does not open it again.
     */
    const dialogRequest =
        requestedDialog === null ? null : `${requestedDialog}:${requestedAddress ?? ''}`;
    const [handledRequest, setHandledRequest] = useState<string | null>(null);
    if (dialogRequest !== null && dialogRequest !== handledRequest && subscription !== undefined) {
        setHandledRequest(dialogRequest);
        if (canChangeDelivery(subscription.state)) {
            changeAddress.reset();
            setFreshAddress(requestedAddress);
            setEditing('address');
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

    const deliveries = useMemo<readonly SubscriptionDelivery[]>(
        () =>
            [...(deliveriesQuery.data?.items ?? [])].sort((a, b) =>
                a.date === b.date ? 0 : a.date < b.date ? 1 : -1,
            ),
        [deliveriesQuery.data],
    );

    const close = () => {
        setDialog(null);
        // The cancellation dialog reports the memo it produced, so its result is cleared when the
        // dialog closes rather than left to reappear the next time something opens.
        cancel.reset();
    };

    const listAction = (
        <ShopStateButton
            testID="subscription-detail-list"
            kind="secondary"
            label={t('commerce:subscription.backToList')}
            onPress={() => {
                router.dismissTo(SUBSCRIPTIONS_HREF as never);
            }}
        />
    );

    if (parsed === null) {
        return (
            <Stack space="lg" testID="subscription-detail-screen">
                <ShopStateCard
                    testID="subscription-detail-empty"
                    icon="leaf"
                    title={t('commerce:subscription.notFoundTitle')}
                    body={t('commerce:subscription.notFoundBody')}
                    actions={listAction}
                />
            </Stack>
        );
    }

    const readOnly = subscription !== undefined && isTerminalSubscriptionState(subscription.state);
    const live = subscription !== undefined && !readOnly;
    const canChange = subscription !== undefined && canChangeDelivery(subscription.state);

    /** The pop-ups' card: the kitchen, then the next delivery (pause) or the days left (resume). */
    const kitchenName = kitchen.data?.name;
    const remainingDays = balanceQuery.data?.days.remaining;
    const nextLine =
        subscription?.nextDeliveryDate == null
            ? undefined
            : t('commerce:subscription.dialog.nextOn', {
                  date: formatter.formatDate(subscription.nextDeliveryDate, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                  }),
              });
    const daysLeftLine =
        remainingDays === undefined
            ? undefined
            : t('commerce:subscription.dialog.daysLeft', { count: remainingDays });

    return (
        <View testID="subscription-detail-screen" className="flex-col pb-10">
            <View className="items-start pt-1">
                {/* Up to the account's Subscriptions by name — popping to it when it is
                    underneath, never stacking a copy. */}
                <BackPill
                    testID="subscription-detail-crumb-subscriptions"
                    label={t('commerce:subscription.board.back')}
                    onPress={() => {
                        router.dismissTo(SUBSCRIPTIONS_HREF as never);
                    }}
                />
            </View>
            <QueryStates
                query={query}
                isEmpty={subscription === undefined}
                emptyTitle={t('commerce:subscription.notFoundTitle')}
                emptyBody={t('commerce:subscription.notFoundBody')}
                emptyActions={listAction}
                emptyIcon="leaf"
                // Shop · Subscription, pin 13: a subscription that is not there is "could not find",
                // not "something went wrong".
                treatFailuresAsEmpty={['resource.not_found']}
                skeleton="rows"
                skeletonCount={2}
                testID="subscription-detail"
            >
                {subscription === undefined ? null : (
                    <View className="flex-col">
                        {justCreated ? (
                            <View
                                testID="subscription-created"
                                role="status"
                                className="mt-4 flex-row items-center gap-3 rounded-[18px] bg-surface-brand-subtle py-3 pe-3 ps-4"
                            >
                                <View className="h-8 w-8 items-center justify-center rounded-full bg-surface-brand">
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                </View>
                                <RNText className="flex-1 text-base font-semibold text-content-on-brand-subtle text-start">
                                    {t('commerce:subscription.board.created')}
                                </RNText>
                                <Pressable
                                    testID="subscription-created-dismiss"
                                    role="button"
                                    accessibilityRole="button"
                                    accessibilityLabel={t('common:action.dismiss')}
                                    onPress={() => {
                                        router.setParams({ created: undefined } as never);
                                    }}
                                    className="h-9 w-9 items-center justify-center rounded-[10px] hover:bg-surface-brand/20"
                                >
                                    <Icon
                                        name="close"
                                        size="sm"
                                        className="text-content-on-brand-subtle"
                                    />
                                </Pressable>
                            </View>
                        ) : null}

                        {/* ── row 1: the plan, the balance, the next delivery ─────────────── */}
                        <View className="mt-4 flex-col gap-4 lg:flex-row">
                            <View
                                testID="subscription-detail-identity"
                                className={cx(
                                    'relative min-w-0 overflow-hidden rounded-[26px] px-6 py-[22px] lg:flex-[1.25]',
                                    TINT_FILL.green,
                                )}
                            >
                                <View
                                    aria-hidden
                                    className="absolute -end-[50px] -top-[70px] h-[200px] w-[200px] rounded-full bg-surface-raised opacity-35"
                                />
                                <View
                                    testID="subscription-detail-state"
                                    className="h-7 flex-row items-center gap-[7px] self-start rounded-full bg-surface-raised px-3"
                                >
                                    <View
                                        className={cx(
                                            'h-2 w-2 rounded-full',
                                            stateDot(subscription.state),
                                        )}
                                    />
                                    <RNText className="text-xs font-bold text-content-primary">
                                        {t(`commerce:states.${subscription.state}`)}
                                    </RNText>
                                </View>
                                <RNText
                                    testID="subscription-detail-name"
                                    accessibilityRole="header"
                                    aria-level={1}
                                    className="mt-3 font-display text-4xl font-bold leading-[42px] tracking-display text-content-primary text-start"
                                >
                                    {subscription.planName}
                                </RNText>
                                {kitchen.data === undefined ? null : (
                                    <RNText
                                        className={cx(
                                            'mt-1.5 text-sm font-semibold text-start',
                                            TINT_INK.green,
                                        )}
                                    >
                                        {kitchen.data.name}
                                    </RNText>
                                )}
                                <View className="mt-3.5 flex-row flex-wrap gap-1.5">
                                    {variant === undefined ? null : (
                                        <IdChip
                                            label={bandLabel(variant, formatter.formatNumber, t)}
                                        />
                                    )}
                                    {variant === undefined ? null : (
                                        <IdChip
                                            label={mealsLine(variant, formatter.formatNumber, t)}
                                        />
                                    )}
                                    <IdChip
                                        testID="subscription-detail-price"
                                        label={t('commerce:subscriptions.dayPrice', {
                                            price: formatMoney(
                                                formatter,
                                                balanceQuery.data?.perDayPrice ??
                                                    subscriptionDayPrice(subscription),
                                            ),
                                        })}
                                    />
                                </View>
                            </View>

                            <BalanceCard
                                subscription={subscription}
                                skipped={
                                    balanceQuery.data?.skippedDays ??
                                    subscription.skippedDates.length
                                }
                            />

                            <View
                                testID="subscription-detail-manage"
                                className="relative min-w-0 flex-col overflow-hidden rounded-[26px] bg-surface-canopy px-[22px] py-5 lg:flex-[1.15]"
                            >
                                <View
                                    aria-hidden
                                    className="absolute -end-[120px] -top-[150px] h-[360px] w-[360px] rounded-full bg-stage-green opacity-15"
                                />
                                <RNText className="text-xs font-bold uppercase tracking-wider text-content-on-canopy-muted text-start">
                                    {t('commerce:subscription.board.nextDelivery')}
                                </RNText>
                                <RNText
                                    testID="subscription-detail-next"
                                    className="mt-1 font-display text-2xl font-bold text-content-on-canopy text-start"
                                >
                                    {subscription.nextDeliveryDate === null || !live
                                        ? t('commerce:subscription.board.noDate')
                                        : formatter.formatDate(subscription.nextDeliveryDate, {
                                              weekday: 'long',
                                              day: 'numeric',
                                              month: 'short',
                                          })}
                                </RNText>
                                <RNText className="text-sm text-content-on-canopy-muted text-start">
                                    {readOnly
                                        ? t('commerce:subscription.board.noMore')
                                        : subscription.state === 'paused'
                                          ? t('commerce:states.paused')
                                          : [
                                                windowLine(
                                                    slots,
                                                    subscription.configuration.slotCode,
                                                    t,
                                                ),
                                                subscription.configuration.address.label.trim() ===
                                                ''
                                                    ? subscription.configuration.address.area
                                                    : subscription.configuration.address.label,
                                            ]
                                                .filter((part) => part.trim() !== '')
                                                .join(' · ')}
                                </RNText>

                                {live ? (
                                    <View testID="subscription-detail-actions" className="mt-auto">
                                        {canPauseOrSkip(subscription.state) ? (
                                            <View className="flex-row gap-2 pt-3.5">
                                                <CanopyButton
                                                    testID="subscription-skip"
                                                    label={t('commerce:subscription.board.skipDay')}
                                                    on={skipOpen}
                                                    disabled={busy || upcoming.length === 0}
                                                    onPress={() => {
                                                        setSkipOpen((open) => !open);
                                                    }}
                                                />
                                                <CanopyButton
                                                    testID="subscription-pause"
                                                    label={t('commerce:subscription.pause')}
                                                    disabled={busy}
                                                    onPress={() => {
                                                        setSkipOpen(false);
                                                        openDialog('pause');
                                                    }}
                                                />
                                            </View>
                                        ) : null}
                                        {skipOpen && canPauseOrSkip(subscription.state) ? (
                                            <View
                                                testID="subscription-skip-sheet"
                                                className="mt-2.5 flex-row flex-wrap gap-1.5"
                                            >
                                                {upcoming.map((date) => (
                                                    <Pressable
                                                        key={date}
                                                        testID={`subscription-skip-option-${date}`}
                                                        role="button"
                                                        accessibilityRole="button"
                                                        accessibilityLabel={formatter.formatDate(
                                                            date,
                                                            { dateStyle: 'full' },
                                                        )}
                                                        disabled={busy}
                                                        onPress={() => {
                                                            setSkipDate(date);
                                                            openDialog('skip');
                                                        }}
                                                        className="h-9 justify-center rounded-xl border border-content-on-canopy/30 px-3 hover:bg-content-on-canopy/10"
                                                    >
                                                        <RNText className="text-sm font-semibold text-content-on-canopy">
                                                            {formatter.formatDate(date, {
                                                                weekday: 'short',
                                                                day: 'numeric',
                                                            })}
                                                        </RNText>
                                                    </Pressable>
                                                ))}
                                            </View>
                                        ) : null}
                                        {canResume(subscription.state) ? (
                                            <View className="flex-row gap-2 pt-3.5">
                                                <CanopyButton
                                                    testID="subscription-resume"
                                                    label={t('commerce:subscription.board.resume')}
                                                    tone="go"
                                                    disabled={busy}
                                                    onPress={() => {
                                                        openDialog('resume');
                                                    }}
                                                />
                                            </View>
                                        ) : null}
                                    </View>
                                ) : null}

                                {readOnly ? (
                                    // A finished subscription is a place to leave from: the same
                                    // plan again, on the same band.
                                    <View
                                        testID="subscription-detail-read-only"
                                        className="mt-auto flex-row pt-3.5"
                                    >
                                        <Pressable
                                            testID="subscription-detail-plan-again"
                                            role="link"
                                            accessibilityRole="link"
                                            onPress={() => {
                                                router.push(
                                                    withQuery(
                                                        `/plans/${String(subscription.configuration.planId)}`,
                                                        {
                                                            variant: String(
                                                                subscription.configuration
                                                                    .variantId,
                                                            ),
                                                        },
                                                    ) as never,
                                                );
                                            }}
                                            className="h-[50px] flex-1 items-center justify-center rounded-2xl bg-surface-brand hover:opacity-90"
                                        >
                                            <RNText className="text-base font-bold text-content-on-brand">
                                                {t('commerce:subscription.board.again')}
                                            </RNText>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>
                        </View>

                        {/* ── row 2: your plan, and the ledger ────────────────────────────── */}
                        <View className="mt-4 flex-col gap-4 lg:flex-row lg:items-start">
                            <View
                                testID="subscription-detail-configuration"
                                className="min-w-0 rounded-3xl border border-stroke-subtle bg-surface-raised lg:flex-1"
                            >
                                <CardHead title={t('commerce:subscription.board.yourPlan')} />
                                <View className="flex-col gap-2.5 px-4 pb-4 pt-1.5">
                                    <View className="flex-col gap-2.5 sm:flex-row">
                                        <PlanTile
                                            testID="subscription-detail-row-address"
                                            icon="mapPin"
                                            label={t('commerce:subscription.board.address')}
                                            change={
                                                canChange
                                                    ? {
                                                          testID: 'subscription-change-address',
                                                          label: t('commerce:subscription.change'),
                                                          accessibilityLabel: t(
                                                              'commerce:subscription.changeAddress',
                                                          ),
                                                          on: editing === 'address',
                                                          onPress: () => {
                                                              setFreshAddress(null);
                                                              toggleEditor('address');
                                                          },
                                                      }
                                                    : undefined
                                            }
                                        >
                                            <TileValue>
                                                {[
                                                    subscription.configuration.address.label,
                                                    formatAddress(
                                                        subscription.configuration.address,
                                                    ),
                                                ]
                                                    .filter((part) => part.trim() !== '')
                                                    .join(' · ')}
                                            </TileValue>
                                            {editing === 'address' ? (
                                                <TileEditor>
                                                    <View className="flex-row flex-wrap gap-1.5">
                                                        {[...addressList]
                                                            .sort((a, b) =>
                                                                a.id === freshAddress
                                                                    ? -1
                                                                    : b.id === freshAddress
                                                                      ? 1
                                                                      : 0,
                                                            )
                                                            .map((entry) => {
                                                                const on =
                                                                    entry.line1 ===
                                                                        subscription.configuration
                                                                            .address.line1 &&
                                                                    entry.areaName ===
                                                                        subscription.configuration
                                                                            .address.area;
                                                                return (
                                                                    <OptionButton
                                                                        key={entry.id}
                                                                        testID={`subscription-address-option-${entry.id}`}
                                                                        label={
                                                                            entry.label.trim() ===
                                                                            ''
                                                                                ? entry.line1
                                                                                : entry.label
                                                                        }
                                                                        on={on}
                                                                        disabled={busy}
                                                                        onPress={() => {
                                                                            if (on) {
                                                                                setEditing(null);
                                                                                return;
                                                                            }
                                                                            changeAddress.mutate(
                                                                                {
                                                                                    subscriptionId:
                                                                                        subscription.id,
                                                                                    request: {
                                                                                        address:
                                                                                            toDeliveryAddress(
                                                                                                savedAddressValues(
                                                                                                    entry,
                                                                                                ),
                                                                                            ),
                                                                                        addressId:
                                                                                            entry.id,
                                                                                    },
                                                                                },
                                                                                {
                                                                                    onSuccess:
                                                                                        () => {
                                                                                            setEditing(
                                                                                                null,
                                                                                            );
                                                                                        },
                                                                                },
                                                                            );
                                                                        }}
                                                                    />
                                                                );
                                                            })}
                                                        {/*
                                                         * The address that is needed may not be
                                                         * saved yet. The editor saves it and comes
                                                         * back with `?dialog=address&address={id}`,
                                                         * which reopens this editor on it.
                                                         */}
                                                        <OptionButton
                                                            testID="subscription-address-add"
                                                            label={t(
                                                                'commerce:subscription.board.addAddress',
                                                            )}
                                                            icon="plus"
                                                            onPress={() => {
                                                                setEditing(null);
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
                                                    <InlineFailure
                                                        error={changeAddress.error}
                                                        testID="subscription-address-failure"
                                                    />
                                                </TileEditor>
                                            ) : null}
                                        </PlanTile>

                                        <PlanTile
                                            testID="subscription-detail-row-slot"
                                            icon="sun"
                                            label={t('commerce:subscription.board.window')}
                                            change={
                                                canChange
                                                    ? {
                                                          testID: 'subscription-change-slot',
                                                          label: t('commerce:subscription.change'),
                                                          accessibilityLabel: t(
                                                              'commerce:subscription.changeSlot',
                                                          ),
                                                          on: editing === 'slot',
                                                          onPress: () => {
                                                              toggleEditor('slot');
                                                          },
                                                      }
                                                    : undefined
                                            }
                                        >
                                            <TileValue>
                                                {windowLine(
                                                    slots,
                                                    subscription.configuration.slotCode,
                                                    t,
                                                )}
                                            </TileValue>
                                            {editing === 'slot' ? (
                                                <TileEditor>
                                                    <View
                                                        testID="subscription-slot-picker"
                                                        className="flex-row flex-wrap gap-1.5"
                                                    >
                                                        {slots.map((slot) => {
                                                            const on =
                                                                slot.code ===
                                                                subscription.configuration.slotCode;
                                                            return (
                                                                <OptionButton
                                                                    key={slot.code}
                                                                    testID={`subscription-slot-${slot.code}`}
                                                                    label={windowLine(
                                                                        slots,
                                                                        slot.code,
                                                                        t,
                                                                        ' ',
                                                                    )}
                                                                    on={on}
                                                                    disabled={busy}
                                                                    onPress={() => {
                                                                        if (on) {
                                                                            setEditing(null);
                                                                            return;
                                                                        }
                                                                        changeSlot.mutate(
                                                                            {
                                                                                subscriptionId:
                                                                                    subscription.id,
                                                                                request: {
                                                                                    slotCode:
                                                                                        slot.code,
                                                                                },
                                                                            },
                                                                            {
                                                                                onSuccess: () => {
                                                                                    setEditing(
                                                                                        null,
                                                                                    );
                                                                                },
                                                                            },
                                                                        );
                                                                    }}
                                                                />
                                                            );
                                                        })}
                                                    </View>
                                                    <InlineFailure
                                                        error={changeSlot.error}
                                                        testID="subscription-slot-failure"
                                                    />
                                                </TileEditor>
                                            ) : null}
                                        </PlanTile>
                                    </View>

                                    <View className="flex-col gap-2.5 sm:flex-row">
                                        <PlanTile
                                            testID="subscription-detail-row-days"
                                            icon="calendar"
                                            label={t('commerce:subscription.board.days')}
                                            change={
                                                canChange
                                                    ? {
                                                          testID: 'subscription-change-weekdays',
                                                          label: t('commerce:subscription.change'),
                                                          accessibilityLabel:
                                                              t('commerce:weekdays.open'),
                                                          on: editing === 'days',
                                                          onPress: () => {
                                                              toggleEditor('days');
                                                          },
                                                      }
                                                    : undefined
                                            }
                                        >
                                            {editing === 'days' ? (
                                                <WeekdayEditor
                                                    quote={quoteQuery.data}
                                                    balance={balanceQuery.data}
                                                    selected={
                                                        editedWeekdays ??
                                                        subscription.configuration.deliveryWeekdays
                                                    }
                                                    pending={changeWeekdays.isPending}
                                                    error={changeWeekdays.error}
                                                    onChange={setEditedWeekdays}
                                                    onCancel={() => {
                                                        setEditing(null);
                                                    }}
                                                    onConfirm={() => {
                                                        if (editedWeekdays === null) return;
                                                        changeWeekdays.mutate(
                                                            {
                                                                subscriptionId: subscription.id,
                                                                request: {
                                                                    deliveryWeekdays:
                                                                        editedWeekdays,
                                                                },
                                                            },
                                                            {
                                                                onSuccess: () => {
                                                                    setEditing(null);
                                                                },
                                                            },
                                                        );
                                                    }}
                                                />
                                            ) : (
                                                <WeekdayBoxes
                                                    weekdays={
                                                        subscription.configuration.deliveryWeekdays
                                                    }
                                                />
                                            )}
                                        </PlanTile>

                                        <PlanTile
                                            testID="subscription-detail-row-meals"
                                            icon="utensils"
                                            label={t('commerce:subscription.board.meals')}
                                            change={{
                                                testID: 'subscription-pick-meals',
                                                label: live
                                                    ? t('commerce:subscription.board.pickMeals')
                                                    : t('commerce:subscription.board.seeMeals'),
                                                on: mealsOpen,
                                                onPress: () => {
                                                    setMealsOpen((open) => !open);
                                                },
                                            }}
                                        >
                                            <TileValue>
                                                {t('commerce:subscription.board.mealsValue')}
                                            </TileValue>
                                        </PlanTile>
                                    </View>
                                </View>

                                {live ? (
                                    <View className="flex-row flex-wrap items-center justify-between gap-3 border-t border-stroke-subtle px-5 pb-4 pt-3">
                                        <RNText
                                            testID="subscription-balance-cutoff"
                                            className="flex-1 text-xs font-medium text-content-secondary text-start"
                                        >
                                            {t('commerce:subscription.board.changesClose', {
                                                count:
                                                    balanceQuery.data?.changeCutoffHours ??
                                                    quoteQuery.data?.changeCutoffHours ??
                                                    24,
                                            })}
                                        </RNText>
                                        {/*
                                         * Cancellation is last and quiet, and it is offered from
                                         * every non-terminal state — including `paused`, because a
                                         * paused subscription is still somebody's money.
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
                                            className="h-10 items-center justify-center rounded-2xl px-3.5 hover:bg-danger-subtle"
                                        >
                                            <RNText className="text-base font-semibold text-danger-on-subtle">
                                                {t('commerce:subscription.board.cancelPlan')}
                                            </RNText>
                                        </Pressable>
                                    </View>
                                ) : null}
                            </View>

                            <DeliveriesCard
                                deliveries={deliveries}
                                slots={slots}
                                tab={tab}
                                onTab={setTab}
                            />
                        </View>

                        {/* ── the meals, day by day, and the allergy check ────────────────── */}
                        {mealsOpen ? (
                            <View
                                testID="subscription-detail-meals"
                                className="mt-4 flex-col gap-4 lg:flex-row lg:items-start"
                            >
                                <View className="min-w-0 lg:flex-1">
                                    <SubscriptionMeals
                                        days={daysQuery.data}
                                        loading={daysQuery.isLoading}
                                        menu={menu}
                                        menuLoading={!kitchenMeals.isFetched || hasNextPage}
                                        canChange={live}
                                        planName={subscription.planName}
                                        cutoffHours={balanceQuery.data?.changeCutoffHours ?? 24}
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
                                </View>
                                <View
                                    testID="subscription-detail-allergies"
                                    className="lg:w-[360px]"
                                >
                                    <PlanAllergyNotice
                                        testID="subscription-detail-allergy-notice"
                                        meals={chosenMeals}
                                        checked={daysQuery.isFetched && kitchenMeals.isFetched}
                                        whenOf={(meal) => {
                                            const dates = (daysQuery.data?.days ?? [])
                                                .filter((day) =>
                                                    day.meals.some(
                                                        (each) => each.mealId === meal.id,
                                                    ),
                                                )
                                                .map((day) => day.date);
                                            const [first, ...rest] = dates;
                                            if (first === undefined) return undefined;
                                            const date = formatter.formatDate(
                                                `${first}T12:00:00Z`,
                                                {
                                                    weekday: 'short',
                                                    day: 'numeric',
                                                    month: 'short',
                                                },
                                            );
                                            return rest.length === 0
                                                ? date
                                                : t('commerce:myAllergens.pickedOnMore', {
                                                      date,
                                                      count: rest.length,
                                                  });
                                        }}
                                        returnTo={here}
                                    />
                                </View>
                            </View>
                        ) : null}
                    </View>
                )}
            </QueryStates>

            {/* ── pause and resume (Shop · Subscription, pins 8 and 9) ──────────────────────── */}
            {subscription === undefined ? null : (
                <>
                    <PauseResumeDialog
                        kind="pause"
                        testID="subscription-pause"
                        open={dialog === 'pause'}
                        subject={{
                            planName: subscription.planName,
                            state: subscription.state,
                            kitchenName,
                            line: nextLine,
                        }}
                        pending={pause.isPending}
                        error={pause.error}
                        onClose={close}
                        onConfirm={() => {
                            pause.mutate({ subscriptionId: subscription.id }, { onSuccess: close });
                        }}
                    />
                    <PauseResumeDialog
                        kind="resume"
                        testID="subscription-resume"
                        open={dialog === 'resume'}
                        subject={{
                            planName: subscription.planName,
                            state: subscription.state,
                            kitchenName,
                            line: daysLeftLine,
                        }}
                        pending={resume.isPending}
                        error={resume.error}
                        onClose={close}
                        onConfirm={() => {
                            resume.mutate(subscription.id, { onSuccess: close });
                        }}
                    />
                </>
            )}

            {/* ── skip a day (pin 10) ────────────────────────────────────────────────────────── */}
            <ShopDialog
                testID="subscription-skip-dialog"
                open={dialog === 'skip'}
                onClose={close}
                icon="skipForward"
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
                        <ShopDialogButton
                            testID="subscription-skip-cancel"
                            label={t('commerce:common.cancel')}
                            onPress={close}
                        />
                        <ShopDialogButton
                            testID="subscription-skip-confirm"
                            kind="brand"
                            icon="skipForward"
                            label={t('commerce:subscription.skipConfirm')}
                            busy={skipDay.isPending}
                            onPress={() => {
                                if (subscription === undefined || skipDate === null) return;
                                skipDay.mutate(
                                    {
                                        subscriptionId: subscription.id,
                                        request: { date: skipDate },
                                    },
                                    {
                                        onSuccess: () => {
                                            close();
                                            setSkipOpen(false);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                {skipDate === null || subscription === undefined ? null : (
                    <ShopDialogSubject
                        testID="subscription-skip-subject"
                        lead={
                            <ShopDialogDateTile
                                weekday={formatter.formatDate(skipDate, { weekday: 'short' })}
                                day={formatter.formatDate(skipDate, { day: 'numeric' })}
                            />
                        }
                        name={formatter.formatDate(skipDate, { dateStyle: 'full' })}
                        meta={[
                            subscription.planName,
                            windowLine(slots, subscription.configuration.slotCode, t),
                            subscription.configuration.address.label.trim() === ''
                                ? subscription.configuration.address.area
                                : subscription.configuration.address.label,
                        ]
                            .filter((part) => part.trim() !== '')
                            .join(' · ')}
                    />
                )}
                <ShopDialogConsequence
                    testID="subscription-skip-consequence"
                    icon="calendar"
                    title={t('commerce:subscription.skipConsequenceTitle')}
                    body={t('commerce:subscription.skipConsequenceBody')}
                />
                <DialogFailure error={skipDay.error} testID="subscription-skip-failure" />
            </ShopDialog>

            {/* ── cancel (pins 11–12) ──────────────────────────────────────────────────────── */}
            <CancelSubscriptionDialog
                open={dialog === 'cancel'}
                balance={balanceQuery.data}
                cancelled={cancel.data !== undefined}
                kitchenName={kitchenName}
                state={subscription?.state}
                planName={subscription?.planName ?? ''}
                pending={cancel.isPending}
                error={cancel.error}
                onClose={close}
                onConfirm={() => {
                    if (subscription === undefined) return;
                    // No `onSuccess: close`. The dialog stays open to say it happened.
                    cancel.mutate({ subscriptionId: subscription.id });
                }}
            />
        </View>
    );
}

/* ── the pieces ──────────────────────────────────────────────────────────────────────────────── */

/** A chip on the plan card's tint — the band, the meals, the day price. */
function IdChip({ label, testID }: { readonly label: string; readonly testID?: string }) {
    return (
        <View
            testID={testID}
            className="h-[30px] justify-center rounded-full bg-surface-raised px-3"
        >
            <RNText className="text-xs font-semibold tabular-nums text-content-primary">
                {label}
            </RNText>
        </View>
    );
}

/**
 * The balance card: the ring of days left beside what was bought, used and skipped, and when it
 * should run out. The numbers are the subscription's own `days`, which the balance read agrees with.
 */
function BalanceCard({
    subscription,
    skipped,
}: {
    readonly subscription: Subscription;
    readonly skipped: number;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { total, consumed, remaining } = subscription.days;
    const ends = estimatedEndDate(subscription);

    return (
        <View
            testID="subscription-balance"
            className="min-w-0 flex-row items-center gap-[18px] rounded-[26px] border border-stroke-subtle bg-surface-raised px-[22px] py-5 lg:flex-1"
        >
            <DaysRing
                testID="subscription-balance-remaining"
                value={formatter.formatNumber(remaining)}
                label={t('commerce:subscription.board.daysLeft', { count: remaining })}
                share={total === 0 ? 0 : remaining / total}
                accessibilityLabel={t('commerce:balance.remaining', { count: remaining })}
            />
            <View className="min-w-0 flex-1 flex-col gap-2">
                <BalanceLine
                    testID="subscription-balance-total"
                    label={t('commerce:subscription.board.bought')}
                    value={formatter.formatNumber(total)}
                />
                <BalanceLine
                    testID="subscription-balance-used"
                    label={t('commerce:subscription.board.used')}
                    value={formatter.formatNumber(consumed)}
                />
                <BalanceLine
                    testID="subscription-balance-skipped"
                    label={t('commerce:subscription.board.skippedFree')}
                    value={formatter.formatNumber(skipped)}
                />
                {/* The date drops under its label when the card is too narrow for both. */}
                <View className="flex-row flex-wrap items-baseline justify-between gap-x-2 border-t border-dashed border-stroke pt-2">
                    <RNText className="text-sm font-semibold text-content-secondary text-start">
                        {t('commerce:subscription.board.lastsUntil')}
                    </RNText>
                    <RNText
                        testID="subscription-balance-ends"
                        className="shrink-0 text-base font-bold text-content-primary"
                    >
                        {ends === null
                            ? t('commerce:subscription.board.noDate')
                            : formatter.formatDate(ends, {
                                  weekday: 'short',
                                  day: 'numeric',
                                  month: 'short',
                              })}
                    </RNText>
                </View>
            </View>
        </View>
    );
}

function BalanceLine({
    testID,
    label,
    value,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
}) {
    return (
        <View className="flex-row items-baseline justify-between gap-2">
            <RNText className="text-sm font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            <RNText
                testID={testID}
                className="font-display text-lg font-bold tabular-nums text-content-primary"
            >
                {value}
            </RNText>
        </View>
    );
}

/** A button on the canopy: translucent, white on hover; `on` while its row is open; `go` is Resume. */
function CanopyButton({
    testID,
    label,
    on = false,
    tone = 'plain',
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly on?: boolean;
    readonly tone?: 'plain' | 'go';
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            aria-expanded={tone === 'plain' && testID === 'subscription-skip' ? on : undefined}
            disabled={disabled}
            aria-disabled={disabled}
            accessibilityState={{ disabled }}
            onPress={onPress}
            className={cx(
                'h-[46px] flex-1 items-center justify-center rounded-[14px] border',
                tone === 'go'
                    ? 'border-surface-brand bg-surface-brand hover:opacity-90'
                    : on
                      ? 'border-surface-raised bg-surface-raised'
                      : 'border-content-on-canopy/25 bg-content-on-canopy/10 hover:bg-content-on-canopy/20',
                disabled ? 'opacity-50' : '',
            )}
        >
            <RNText
                className={cx(
                    'text-sm font-semibold',
                    tone === 'go'
                        ? 'text-content-on-brand'
                        : on
                          ? 'text-content-primary'
                          : 'text-content-on-canopy',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/** A card's head row: its title, and anything at the end. */
function CardHead({ title, end }: { readonly title: string; readonly end?: ReactNode }) {
    return (
        <View className="flex-row flex-wrap items-center gap-2.5 px-5 pb-1.5 pt-[18px]">
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="text-lg font-bold text-content-primary text-start"
            >
                {title}
            </RNText>
            {end === undefined ? null : <View className="ms-auto">{end}</View>}
        </View>
    );
}

interface TileChange {
    readonly testID: string;
    readonly label: string;
    readonly accessibilityLabel?: string | undefined;
    readonly on: boolean;
    readonly onPress: () => void;
}

/** One of "Your plan"'s four tiles: an icon and its Change, the label, the value, any editor. */
function PlanTile({
    testID,
    icon,
    label,
    change,
    children,
}: {
    readonly testID: string;
    readonly icon: IconName;
    readonly label: string;
    readonly change?: TileChange | undefined;
    readonly children: ReactNode;
}) {
    return (
        <View
            testID={testID}
            className="min-h-[132px] min-w-0 flex-1 flex-col gap-1.5 rounded-[18px] border border-stroke-subtle bg-surface-base p-3.5 hover:border-stroke"
        >
            <View className="flex-row items-center justify-between gap-2">
                <View className="h-9 w-9 items-center justify-center rounded-[13px] bg-surface-brand-subtle">
                    <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
                </View>
                {change === undefined ? null : (
                    <Pressable
                        testID={change.testID}
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={change.accessibilityLabel ?? change.label}
                        aria-expanded={change.on}
                        accessibilityState={{ expanded: change.on }}
                        onPress={change.onPress}
                        className={cx(
                            'h-8 justify-center rounded-full border px-3',
                            change.on
                                ? 'border-content-primary bg-content-primary'
                                : 'border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-xs font-semibold',
                                change.on ? 'text-surface-base' : 'text-content-primary',
                            )}
                        >
                            {change.label}
                        </RNText>
                    </Pressable>
                )}
            </View>
            <RNText className="text-xs font-semibold text-content-secondary text-start">
                {label}
            </RNText>
            {children}
        </View>
    );
}

function TileValue({ children }: { readonly children: string }) {
    return (
        <RNText className="text-base font-bold text-content-primary text-start">{children}</RNText>
    );
}

function TileEditor({ children }: { readonly children: ReactNode }) {
    return <View className="flex-col gap-2 pt-1">{children}</View>;
}

/** A choice inside a tile's editor — a saved address, a window. */
function OptionButton({
    testID,
    label,
    on = false,
    icon,
    disabled = false,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly on?: boolean;
    readonly icon?: IconName | undefined;
    readonly disabled?: boolean;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            aria-checked={on}
            accessibilityState={{ checked: on, disabled }}
            disabled={disabled}
            onPress={onPress}
            className={cx(
                'h-[34px] flex-row items-center gap-1 rounded-xl border-[1.5px] px-2.5',
                on
                    ? 'border-surface-brand bg-surface-brand-subtle'
                    : 'border-stroke bg-surface-raised hover:border-surface-brand',
                disabled ? 'opacity-50' : '',
            )}
        >
            {icon === undefined ? null : (
                <Icon name={icon} size="sm" className="text-content-primary" />
            )}
            <RNText
                className={cx(
                    'text-xs font-semibold',
                    on ? 'text-content-on-brand-subtle' : 'text-content-primary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/** The week as seven small boxes, the delivery days filled — "Mon Tue Wed …". */
function WeekdayBoxes({ weekdays }: { readonly weekdays: readonly number[] }) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (
        <View
            testID="subscription-detail-days"
            accessibilityLabel={weekdayRun(weekdays, t)}
            className="mt-1.5 flex-row gap-1"
        >
            {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                const on = weekdays.includes(weekday);
                return (
                    <View
                        key={weekday}
                        aria-label={t(weekdayKey(weekday))}
                        className={cx(
                            'h-[26px] min-w-0 max-w-10 flex-1 items-center justify-center rounded-lg',
                            on ? 'bg-surface-brand' : 'bg-surface-base',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-xs font-bold',
                                on ? 'text-content-on-brand' : 'text-content-secondary',
                            )}
                        >
                            {shortWeekday(weekday, formatter.formatDate)}
                        </RNText>
                    </View>
                );
            })}
        </View>
    );
}

/**
 * The Deliveries card: every day of the balance and what became of it, newest first, with the
 * board's All / Delivered / Skipped tabs. The tag says whether the day cost anything — the skipped
 * rows marked Free are how "a skip is free" becomes checkable rather than merely stated.
 */
function DeliveriesCard({
    deliveries,
    slots,
    tab,
    onTab,
}: {
    readonly deliveries: readonly SubscriptionDelivery[];
    readonly slots: Parameters<typeof windowLine>[0];
    readonly tab: LedgerTab;
    readonly onTab: (tab: LedgerTab) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const shown = deliveries.filter((delivery) => inLedgerTab(delivery, tab));

    return (
        <View
            testID="subscription-deliveries"
            className="min-w-0 rounded-3xl border border-stroke-subtle bg-surface-raised lg:flex-1"
        >
            <CardHead
                title={t('commerce:subscription.board.deliveries')}
                end={
                    deliveries.length === 0 ? undefined : (
                        <View
                            role="tablist"
                            className="flex-row gap-1 rounded-xl bg-surface-base p-[3px]"
                        >
                            {LEDGER_TABS.map((each) => {
                                const on = each === tab;
                                return (
                                    <Pressable
                                        key={each}
                                        testID={`subscription-deliveries-tab-${each}`}
                                        role="tab"
                                        aria-selected={on}
                                        accessibilityState={{ selected: on }}
                                        onPress={() => {
                                            onTab(each);
                                        }}
                                        className={cx(
                                            'h-8 justify-center rounded-[9px] px-3',
                                            on ? 'bg-surface-raised shadow-elevation-1' : '',
                                        )}
                                    >
                                        <RNText
                                            className={cx(
                                                'text-sm font-semibold',
                                                on
                                                    ? 'text-content-primary'
                                                    : 'text-content-secondary',
                                            )}
                                        >
                                            {t(`commerce:subscription.board.tabs.${each}`)}
                                        </RNText>
                                    </Pressable>
                                );
                            })}
                        </View>
                    )
                }
            />
            {shown.length === 0 ? (
                <RNText
                    testID="subscription-deliveries-empty"
                    className="px-5 pb-5 pt-2 text-sm text-content-secondary text-start"
                >
                    {t('commerce:deliveries.empty')}
                </RNText>
            ) : (
                <View testID="subscription-deliveries-table" className="flex-col px-3 pb-3 pt-1">
                    {shown.map((delivery) => {
                        const tag = ledgerTag(delivery);
                        const where = [
                            formatter.formatDate(delivery.date, { month: 'long' }),
                            windowLine(slots, delivery.slotCode, t, ' '),
                        ].join(' · ');
                        return (
                            <View
                                key={delivery.id}
                                testID={`subscription-deliveries-row-${delivery.date}`}
                                className="flex-row items-center gap-3 rounded-[14px] px-2 py-2.5 hover:bg-surface-base"
                            >
                                <View className="h-14 w-14 items-center justify-center rounded-2xl bg-surface-base">
                                    <RNText className="text-xs font-bold uppercase text-content-secondary">
                                        {formatter.formatDate(delivery.date, { weekday: 'short' })}
                                    </RNText>
                                    <RNText className="font-display text-xl font-bold tabular-nums text-content-primary">
                                        {formatter.formatDate(delivery.date, { day: 'numeric' })}
                                    </RNText>
                                </View>
                                <View className="min-w-0 flex-1">
                                    <RNText
                                        testID={`subscription-deliveries-status-${delivery.date}`}
                                        className="text-base font-bold text-content-primary text-start"
                                    >
                                        {t(`commerce:deliveries.statuses.${delivery.status}`)}
                                    </RNText>
                                    <RNText className="text-sm font-medium text-content-secondary text-start">
                                        {tag === 'free'
                                            ? `${t('commerce:subscription.board.noDayUsed')} · ${where}`
                                            : where}
                                    </RNText>
                                </View>
                                <View
                                    className={cx(
                                        'h-7 justify-center rounded-full px-2.5',
                                        tag === 'used'
                                            ? 'bg-surface-brand'
                                            : tag === 'free'
                                              ? 'bg-surface-brand-subtle'
                                              : 'border border-dashed border-stroke bg-surface-base',
                                    )}
                                >
                                    <RNText
                                        className={cx(
                                            'text-xs font-bold',
                                            tag === 'used'
                                                ? 'text-content-on-brand'
                                                : tag === 'free'
                                                  ? 'text-content-on-brand-subtle'
                                                  : 'text-content-primary',
                                        )}
                                    >
                                        {t(`commerce:subscription.board.tag.${tag}`)}
                                    </RNText>
                                </View>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
}
