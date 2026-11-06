import { Icon, MeterBar, cx } from '@healthy360/design-system';

import { EntityImage } from '../../../media/entity-image.tsx';
import type {
    MealSlot,
    PlanSitting,
    PlanVariant,
    SubscriptionPlan,
} from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, Text as RNText, View } from 'react-native';

import { StaffReturnButton } from '../../marketplace/staff-return-button.tsx';

import { usePlanQuery } from '../../../data/catalogue-hooks.ts';
import { usePlanAvailabilityQuery } from '../../../data/commerce-hooks.ts';
import { BackPill } from '../../../ui/back-pill.tsx';
import { ShopStateButton, ShopStateCard } from '../../../ui/shop-state.tsx';
import { toDeliveryAddress } from '../../commerce/address.ts';
import {
    estimatedTotal,
    initialConfiguratorState,
    toConfiguration,
} from '../../commerce/configurator.ts';
import { earliestStartDate } from '../../commerce/dates.ts';
import { useSittingLabel } from '../../commerce/plan-meal-picker.tsx';
import { SegChoice } from '../../commerce/plan-setup-frame.tsx';
import { configuratorHref } from '../../commerce/configurator-draft.ts';
import { variantName } from '../../commerce/configurator-steps.tsx';
import { PlanAllergyNotice } from '../../commerce/my-allergens.tsx';
import { useKitchenQuery, useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth, useNavigateUp } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { formatMoney, weekdayKey } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { useShopViewOnly } from '../../marketplace/shop-view-only.tsx';
import { listDayPrice } from '../plan-balance.ts';
import { durationWithBalance } from '../plan-duration-label.ts';
import { isLiveSubscription, weekdayName } from '../plan-subscription.ts';
import { TINT_FILL, TINT_INK } from '../shelf-tints.ts';
import type { ShelfTint } from '../shelf-tints.ts';

/**
 * `/plans/{plan}` — one subscription plan.
 *
 * ## The accepted board
 *
 * "Weekly plans" back, then the plan in cards on the left — the overview (picture, name, kitchen,
 * facts), "Each day" (a tile per sitting and the weekdays it is delivered), "Calorie band" (the band on
 * a kcal scale, the bands to choose from, the macros it publishes), "Plan rules" with the way to how
 * plans work, and the reader's allergy list — and beside them the price card that stays in view: a day
 * on the canopy, the lengths, Set up plan, Add to compare (the list with this plan ticked) and the two
 * promises. The delivery weekdays and the cut-off come from the quote, which only a verified session
 * may read, so anybody else sees the page without them.
 *
 * ## Marketing above, transaction below, and never interleaved
 *
 * Doc 17, IA-13 records the reference product merging the two on one page, so that somebody
 * re-configuring a plan scrolls through testimonials to reach the price. Here the order is fixed:
 * what the plan is, then the band, then the macros, then the composition, then the durations and
 * the price, then the call to action. Nothing marketing-shaped appears below the configuration.
 *
 * ## Ranges, drawn as relative bars
 *
 * A macro range is not progress toward anything, so a meter that filled to 100 % would be a lie
 * with a nice gradient. The bars here share one scale — the largest macro figure in the band — so
 * their *lengths* compare the three macronutrients against each other, while the text next to each
 * one carries the actual range. Doc 09, RBN-03 and IMP-01: a rotating menu has no single true
 * protein figure, and a point value would be false precision.
 *
 * ## The call to action
 *
 * A signed-in press goes straight to `/customer/subscriptions/new`, carrying both the plan and the
 * variant the person was looking at — so the configurator opens on the calorie band they chose here
 * rather than resetting to the advertised one. An anonymous visitor goes to sign-in with that same
 * configurator URL as `?returnTo=`, so signing in lands on the set-up for this plan and band rather
 * than on `/discover` (browse-08). While the session is still being restored the button waits — it
 * used to read a not-yet-loaded session as "signed out" and send a signed-in person to sign in
 * (AUTH-09).
 *
 * Somebody who already holds a live subscription to this plan is offered "Manage plan" first — the
 * same action the plan's card on `/plans` offers — and setting up a second one only after it
 * (plans-12).
 *
 * ## The price is a day, and a run
 *
 * The headline is the per-day price, because a plan is a balance of delivery days and that is the
 * figure captured at purchase. Under it, the shortest run at its total. It used to headline "a
 * week" — seven times the daily price — on plans that sold five-day runs (plans-20).
 *
 * ## Allergies, before anybody subscribes
 *
 * A signed-in reader sees their allergy list against the plan's sample week: which dishes cross
 * it, and the way to change the list. The kitchen reads that list at generation, so this is the
 * question "can I eat this plan?" answered where it is asked.
 *
 * ## The band is in the URL
 *
 * `?variant=`, written with `setParams`, so the band survives the kitchen link and Back, a refresh,
 * and the sign-in round trip. The page follows the URL when it changes underneath it.
 *
 * Until the commerce wave landed, this control opened a prototype dialog naming the endpoint it was
 * waiting on. Replacing it was the whole handoff: one branch, and the notice is gone.
 */
export interface PlanDetailScreenProps {
    readonly planId: string | undefined;
    /** `?returnTo=` — the kitchen record staff opened this from; see `StaffReturnButton`. */
    readonly returnTo?: string | undefined;
}

/** The three macro ranges of a variant, in label order, with their translation keys. */
function macroRanges(variant: PlanVariant) {
    return [
        { nutrientId: 'protein', range: variant.proteinRange },
        { nutrientId: 'carbohydrate', range: variant.carbohydrateRange },
        { nutrientId: 'fat', range: variant.fatRange },
    ] as const;
}

export function PlanDetailScreen({ planId, returnTo }: PlanDetailScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const navigateUp = useNavigateUp();
    const goToAuth = useGoToAuth();
    const here = useCurrentHref();
    // Read from the session's phase, not from `me`: `me` is also null while a stored session is
    // still being restored, and that is not the same as being signed out.
    const { phase } = useSession();
    const restoring = phase === 'restoring';
    const signedIn = phase !== 'restoring' && phase !== 'anonymous';
    // Staff view the plan and set nothing up (`shop-view-only.tsx`).
    const viewOnly = useShopViewOnly();
    const verified = phase === 'contextPending' || phase === 'ready';

    const parsed = planId === undefined ? null : SubscriptionPlanId.safeParse(planId);
    const plan = usePlanQuery(parsed);
    const item: SubscriptionPlan | undefined = plan.data;

    const kitchen = useKitchenQuery(item?.kitchenId ?? null);

    // The same list `/plans` reads, so it is usually cached: a person's own, asked for only once the
    // session is a verified one (anyone else is answered 401 or 403).
    const subscriptions = useSubscriptionsQuery(verified);
    const held =
        item === undefined
            ? undefined
            : (subscriptions.data?.items ?? []).find(
                  (subscription) =>
                      isLiveSubscription(subscription) &&
                      String(subscription.configuration.planId) === String(item.id),
              );

    // The band follows `?variant=` — the kitchen-profile `?tab` pattern: chosen with `setParams`, and
    // followed during render when the URL changes underneath the page.
    const params = useLocalSearchParams<{ variant?: string | string[] }>();
    const requestedVariant =
        (Array.isArray(params.variant) ? params.variant[0] : params.variant) ?? null;
    const [variantId, setVariantId] = useState<string | null>(requestedVariant);
    const [followedVariant, setFollowedVariant] = useState<string | null>(requestedVariant);
    if (followedVariant !== requestedVariant) {
        setFollowedVariant(requestedVariant);
        setVariantId(requestedVariant);
    }
    const chooseVariant = (next: string) => {
        setVariantId(next);
        router.setParams({ variant: next } as never);
    };

    // The middle variant is the advertised one, so it is what an unopened page should be showing.
    const selected: PlanVariant | undefined =
        item === undefined
            ? undefined
            : (item.variants.find((variant) => String(variant.id) === variantId) ??
              item.variants[Math.floor(item.variants.length / 2)]);

    const browseAction = (
        <ShopStateButton
            testID="plan-detail-browse"
            icon="arrowForward"
            iconAfter
            label={t('catalogue:plan.browseAll')}
            onPress={() => {
                router.push('/plans');
            }}
        />
    );

    // The weekdays the plan delivers on and its change cut-off come from the quote, which only a
    // verified session may read; anybody else sees the page without them.
    const probe = useMemo(() => {
        if (item === undefined || selected === undefined || !verified) return null;
        const seed = initialConfiguratorState({
            plan: item,
            variantId: selected.id,
            startDate: earliestStartDate(),
        });
        return toConfiguration({ ...seed, deliveryWeekdays: [1] }, item, (values) =>
            toDeliveryAddress(values),
        );
    }, [item, selected, verified]);
    const availability = usePlanAvailabilityQuery(probe);
    const weekdays = availability.data?.availableWeekdays ?? null;
    const cutoffHours = availability.data?.changeCutoffHours ?? null;

    const setUp = () => {
        if (item === undefined || selected === undefined) return;
        const href = configuratorHref({ plan: String(item.id), variant: String(selected.id) });
        if (signedIn) {
            router.push(href as never);
            return;
        }
        // The fallback for a sign-in that ends somewhere else in the tab; `returnTo` is the way back.
        recordResumeIntent({
            href: withQuery(`/plans/${String(item.id)}`, { variant: String(selected.id) }),
            labelKey: 'catalogue:nav.plans',
            name: item.name,
        });
        goToAuth('/sign-in', href);
    };

    const notFound = (
        <ShopStateCard
            testID="plan-detail-empty"
            icon="calendarDays"
            title={t('catalogue:plan.notFoundTitle')}
            body={t('catalogue:plan.notFoundBody')}
            actions={browseAction}
        />
    );

    return (
        <View testID="plan-detail-screen" className="w-full flex-col pb-10">
            <StaffReturnButton returnTo={returnTo} testID="plan-detail-staff-return" />
            <View className="items-start pt-1">
                {/* Back to the listing as it was left — its kitchen chip and compare tray. */}
                <BackPill
                    testID="plan-detail-crumb-plans"
                    label={t('marketplace:nav.weeklyPlans')}
                    onPress={() => {
                        navigateUp('/plans');
                    }}
                />
            </View>

            {/* A link carrying something that is not an identifier leaves the query disabled, and
                a disabled query never settles: the not-found answer is rendered directly rather
                than behind a skeleton that would spin for ever. */}
            {parsed === null ? (
                <View className="mt-[18px]">{notFound}</View>
            ) : (
                <View className="mt-[18px]">
                    <QueryStates
                        query={plan}
                        isEmpty={item === undefined}
                        emptyTitle={t('catalogue:plan.notFoundTitle')}
                        emptyBody={t('catalogue:plan.notFoundBody')}
                        emptyActions={browseAction}
                        emptyIcon="calendarDays"
                        // Weekly plans, pin 3: a plan that is gone is "not on the marketplace".
                        treatFailuresAsEmpty={['resource.not_found']}
                        skeletonCount={2}
                        testID="plan-detail"
                    >
                        {item === undefined || selected === undefined ? null : (
                            <View className="flex-col gap-6 lg:flex-row lg:items-start">
                                <View className="min-w-0 flex-1 flex-col gap-4">
                                    <PlanOverview
                                        plan={item}
                                        variant={selected}
                                        kitchenName={kitchen.data?.name}
                                        kitchenImage={kitchen.data?.imagePlaceholderId}
                                        onKitchen={() => {
                                            router.push(
                                                `/kitchens/${String(item.kitchenId)}` as never,
                                            );
                                        }}
                                    />
                                    <EachDay variant={selected} weekdays={weekdays} />
                                    <CalorieBand
                                        plan={item}
                                        variant={selected}
                                        onChoose={chooseVariant}
                                    />
                                    <PlanRules
                                        cutoffHours={cutoffHours}
                                        onHow={() => {
                                            router.push('/plans/how-it-works' as never);
                                        }}
                                    />
                                    {/* A signed-in reader's allergy list. The dishes are chosen at
                                        set-up, where each pick names its clash, so there is nothing
                                        to check against here yet. */}
                                    {/* Weekly plans, pin 1: the card itself, saying the list
                                        is saved on the account and each pick will be checked. */}
                                    {signedIn ? (
                                        <View testID="plan-detail-allergies">
                                            <PlanAllergyNotice
                                                testID="plan-detail-allergy-notice"
                                                meals={[]}
                                                checked
                                                note={t('commerce:myAllergens.savedNote')}
                                                returnTo={here}
                                            />
                                        </View>
                                    ) : null}
                                </View>

                                <View className="flex-col web:sticky web:top-0 lg:w-[380px]">
                                    <PriceCard
                                        plan={item}
                                        variant={selected}
                                        held={held === undefined ? null : String(held.id)}
                                        viewOnly={viewOnly}
                                        signedIn={signedIn}
                                        restoring={restoring}
                                        onSetUp={setUp}
                                        onManage={(id) => {
                                            router.push(`/customer/subscriptions/${id}` as never);
                                        }}
                                        onCompare={() => {
                                            router.push(
                                                withQuery('/plans', {
                                                    compare: String(item.id),
                                                }) as never,
                                            );
                                        }}
                                    />
                                </View>
                            </View>
                        )}
                    </QueryStates>
                </View>
            )}
        </View>
    );
}

/* ── the parts ───────────────────────────────────────────────────────────────────────────────── */

const SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
/** The kcal scale the band is drawn on, widened when a band reaches past it. */
const SCALE_LOW = 400;
const SCALE_HIGH = 2200;

/** A sitting's colour and glyph, as the board's "Each day" tiles wear them. */
const SITTING_LOOK: Readonly<
    Record<MealSlot, { tint: ShelfTint; icon: 'sun' | 'plate' | 'moon' | 'leaf' }>
> = {
    breakfast: { tint: 'yellow', icon: 'sun' },
    lunch: { tint: 'green', icon: 'plate' },
    dinner: { tint: 'blue', icon: 'moon' },
    snack: { tint: 'orange', icon: 'leaf' },
};

/** One white card of the page, with the board's small uppercase title. */
function Section({
    testID,
    title,
    children,
}: {
    readonly testID: string;
    readonly title: string;
    readonly children: ReactNode;
}) {
    return (
        <View
            testID={testID}
            className="rounded-3xl border border-stroke-subtle bg-surface-raised px-[22px] py-5"
        >
            <RNText
                role="heading"
                aria-level={2}
                className="mb-3 text-sm font-bold uppercase tracking-wider text-content-secondary text-start"
            >
                {title}
            </RNText>
            {children}
        </View>
    );
}

function PlanOverview({
    plan,
    variant,
    kitchenName,
    kitchenImage,
    onKitchen,
}: {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant;
    readonly kitchenName: string | undefined;
    readonly kitchenImage: string | undefined;
    readonly onKitchen: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (
        <View
            testID="plan-detail-overview"
            className="flex-col gap-[22px] rounded-3xl border border-stroke-subtle bg-surface-raised p-[18px] md:flex-row"
        >
            <View className="h-[220px] overflow-hidden rounded-[20px] md:w-[260px]">
                <EntityImage
                    testID="plan-detail-image"
                    assetId={plan.imagePlaceholderId}
                    variant="card"
                    seed={plan.slug}
                    label={t('catalogue:plan.imageLabel', { plan: plan.name })}
                    flush
                    className="h-full w-full"
                />
            </View>
            <View className="min-w-0 flex-1 items-start">
                <View
                    className={cx('h-[26px] justify-center rounded-full px-2.5', TINT_FILL.green)}
                >
                    <RNText className={cx('text-xs font-bold', TINT_INK.green)}>
                        {t('catalogue:plan.weeklyPlanTag')}
                    </RNText>
                </View>
                <RNText
                    testID="plan-detail-name"
                    role="heading"
                    aria-level={1}
                    className="mt-2.5 font-display text-4xl font-bold leading-[46px] tracking-display text-content-primary text-start"
                >
                    {plan.name}
                </RNText>
                {plan.summary === '' ? null : (
                    <RNText className="mt-1.5 text-base font-medium text-content-secondary text-start">
                        {plan.summary}
                    </RNText>
                )}
                {plan.description === '' ? null : (
                    <RNText className="mt-1.5 text-sm text-content-secondary text-start">
                        {plan.description}
                    </RNText>
                )}
                {kitchenName === undefined ? null : (
                    <Pressable
                        testID="plan-detail-kitchen"
                        role="link"
                        accessibilityRole="link"
                        onPress={onKitchen}
                        className="mt-3.5 flex-row items-center gap-2"
                    >
                        <View className="h-7 w-7 overflow-hidden rounded-[9px]">
                            <EntityImage
                                assetId={kitchenImage}
                                seed={`kitchen-${String(plan.kitchenId)}`}
                                label={kitchenName}
                                decorative
                                flush
                                className="h-7 w-7"
                            />
                        </View>
                        <RNText className="text-sm font-semibold text-content-primary hover:text-content-on-brand-subtle">
                            {t('catalogue:plan.byKitchen', { kitchen: kitchenName })}
                        </RNText>
                    </Pressable>
                )}
                <View testID="plan-detail-combination" className="mt-4 flex-row flex-wrap gap-2">
                    <Fact icon="plate" label={mealsFact(variant, t)} />
                    <Fact
                        icon="leaf"
                        label={t('catalogue:plan.kcalBand', {
                            min: formatter.formatNumber(variant.energyRange.min),
                            max: formatter.formatNumber(variant.energyRange.max),
                        })}
                    />
                    {plan.rating === null ? null : (
                        <Fact
                            icon="star"
                            label={t('catalogue:plan.ratingFact', {
                                rating: formatter.formatNumber(plan.rating, {
                                    maximumFractionDigits: 1,
                                }),
                                count: plan.ratingCount,
                            })}
                        />
                    )}
                    {plan.dietClassifications.map((diet) => (
                        <Fact key={diet} icon="check" label={t(`marketplace:diets.${diet}`)} />
                    ))}
                </View>
            </View>
        </View>
    );
}

/** "3 main meals · 1 snack", or "· No snacks". */
function mealsFact(variant: PlanVariant, t: TFunction): string {
    return `${t('catalogue:plan.combinationMeals', { count: variant.mealsPerDay })} · ${
        variant.snacksPerDay === 0
            ? t('catalogue:plan.combinationNoSnacksShort')
            : t('catalogue:plan.combinationSnacks', { count: variant.snacksPerDay })
    }`;
}

function Fact({
    icon,
    label,
}: {
    readonly icon: 'plate' | 'leaf' | 'star' | 'check' | 'calendar';
    readonly label: string;
}) {
    return (
        <View className="h-[34px] flex-row items-center gap-1.5 rounded-full border border-stroke-subtle bg-surface-base px-3">
            <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
            <RNText className="text-sm font-semibold tabular-nums text-content-primary">
                {label}
            </RNText>
        </View>
    );
}

/** "Each day" — how many dishes arrive, a tile per sitting, and the days it is delivered. */
function EachDay({
    variant,
    weekdays,
}: {
    readonly variant: PlanVariant;
    readonly weekdays: readonly number[] | null;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const sittingLabel = useSittingLabel();
    const sittings: readonly PlanSitting[] =
        variant.sittings.length > 0
            ? [...variant.sittings].sort(
                  (a, b) =>
                      SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) ||
                      a.sequence - b.sequence,
              )
            : [];
    const count =
        sittings.length === 0 ? variant.mealsPerDay + variant.snacksPerDay : sittings.length;

    return (
        <View
            testID="plan-detail-each-day"
            className="rounded-3xl border border-stroke-subtle bg-surface-raised px-6 py-[22px]"
        >
            <View className="flex-row flex-wrap items-end justify-between gap-3">
                <View>
                    <RNText
                        role="heading"
                        aria-level={2}
                        className="text-sm font-bold uppercase tracking-wider text-content-secondary text-start"
                    >
                        {t('catalogue:plan.eachDay')}
                    </RNText>
                    <View className="mt-1.5 flex-row items-baseline gap-1.5">
                        <RNText className="font-display text-4xl font-bold tabular-nums text-content-primary">
                            {formatter.formatNumber(count)}
                        </RNText>
                        <RNText className="text-base font-semibold text-content-secondary">
                            {t('catalogue:plan.itemsADay', { count })}
                        </RNText>
                    </View>
                </View>
                <View className="h-8 flex-row items-center gap-1.5 rounded-full bg-surface-brand-subtle px-3">
                    <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                        {t('catalogue:plan.youChoose')}
                    </RNText>
                </View>
            </View>

            {sittings.length === 0 ? null : (
                <View className="mt-4 flex-row flex-wrap gap-2.5">
                    {sittings.map((sitting) => {
                        const look = SITTING_LOOK[sitting.slot];
                        return (
                            <View
                                key={`${sitting.slot}-${String(sitting.sequence)}`}
                                testID={`plan-detail-sitting-${sitting.slot}-${String(sitting.sequence)}`}
                                className={cx(
                                    'relative min-w-[130px] flex-1 flex-col gap-0.5 overflow-hidden rounded-[18px] p-3.5 transition duration-normal ease-standard hover:-translate-y-1',
                                    TINT_FILL[look.tint],
                                )}
                            >
                                <View
                                    aria-hidden
                                    className="absolute -end-[30px] -top-[30px] h-[90px] w-[90px] rounded-full bg-surface-raised opacity-35"
                                />
                                <View className="mb-2.5 h-[42px] w-[42px] items-center justify-center rounded-[14px] bg-surface-raised shadow-elevation-1">
                                    <Icon
                                        name={look.icon}
                                        size="md"
                                        className={TINT_INK[look.tint]}
                                    />
                                </View>
                                <RNText
                                    className={cx(
                                        'font-display text-base font-bold',
                                        TINT_INK[look.tint],
                                    )}
                                >
                                    {sittingLabel(sitting)}
                                </RNText>
                                <RNText
                                    className={cx(
                                        'text-xs font-semibold opacity-80',
                                        TINT_INK[look.tint],
                                    )}
                                >
                                    {sitting.slot === 'snack'
                                        ? t('catalogue:plan.snackKind')
                                        : t('catalogue:plan.mainMealKind')}
                                </RNText>
                            </View>
                        );
                    })}
                </View>
            )}

            {weekdays === null ? null : (
                <View
                    testID="plan-detail-delivery"
                    className="mt-4 flex-row flex-wrap items-center gap-1.5 border-t border-stroke-subtle pt-4"
                >
                    <View className="me-auto flex-row items-center gap-1.5">
                        <Icon name="calendar" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-sm font-semibold text-content-secondary">
                            {t('catalogue:plan.delivered')}
                        </RNText>
                    </View>
                    {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                        const on = weekdays.includes(weekday);
                        return (
                            <View
                                key={weekday}
                                testID={`plan-detail-delivery-${String(weekday)}`}
                                accessibilityLabel={t(
                                    on ? 'catalogue:plan.deliversOn' : 'catalogue:plan.notOn',
                                    {
                                        day: t(weekdayKey(weekday)),
                                    },
                                )}
                                className={cx(
                                    'h-8 min-w-[52px] flex-row items-center justify-center gap-1 rounded-full px-2.5',
                                    on ? 'bg-surface-brand' : 'border border-dashed border-stroke',
                                )}
                            >
                                {on ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : null}
                                <RNText
                                    className={cx(
                                        'text-xs font-bold',
                                        on ? 'text-content-on-brand' : 'text-content-secondary',
                                    )}
                                >
                                    {weekdayName(formatter, weekday, 'short')}
                                </RNText>
                            </View>
                        );
                    })}
                </View>
            )}
        </View>
    );
}

/** "Calorie band" — the band on a kcal scale, the bands to choose from, and the macros it publishes. */
function CalorieBand({
    plan,
    variant,
    onChoose,
}: {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant;
    readonly onChoose: (id: string) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const low = Math.min(SCALE_LOW, ...plan.variants.map((each) => each.energyRange.min));
    const high = Math.max(SCALE_HIGH, ...plan.variants.map((each) => each.energyRange.max));
    const before = Math.max(0, variant.energyRange.min - low);
    const band = Math.max(1, variant.energyRange.max - variant.energyRange.min);
    const after = Math.max(0, high - variant.energyRange.max);
    const macros = macroRanges(variant);
    const macroScale = Math.max(1, ...macros.map((entry) => entry.range?.max ?? 0));
    const name = variantName(variant, formatter.formatNumber, t);
    const bandText = t('catalogue:plan.kcalBand', {
        min: formatter.formatNumber(variant.energyRange.min),
        max: formatter.formatNumber(variant.energyRange.max),
    });

    return (
        <Section testID="plan-detail-variants" title={t('catalogue:plan.variantsTitle')}>
            {/* One band is an answer, not a choice: a lone segment asks a question nobody can answer
                differently. */}
            {plan.variants.length > 1 ? (
                <View className="mb-2">
                    <SegChoice
                        testID="plan-detail-variant-picker"
                        label={t('catalogue:plan.variantsTitle')}
                        value={String(variant.id)}
                        onChange={onChoose}
                        options={plan.variants.map((each) => ({
                            value: String(each.id),
                            title: variantName(each, formatter.formatNumber, t),
                            testID: `plan-detail-variant-${String(each.id)}`,
                        }))}
                    />
                </View>
            ) : null}
            {/* The band on the scale: three flexed parts, so the range sits right in either direction. */}
            <View className="mx-1 mt-3 flex-row">
                <View style={{ flex: before }} />
                <View style={{ flex: band }} className="items-center">
                    {/* Wider than the band itself, so a narrow band still names itself whole. */}
                    <View className="-mx-32 items-center">
                        <RNText
                            testID="plan-detail-variant-band"
                            className="text-center text-sm font-bold tabular-nums text-content-primary"
                        >
                            {name === bandText ? bandText : `${name} · ${bandText}`}
                        </RNText>
                    </View>
                </View>
                <View style={{ flex: after }} />
            </View>
            <View
                aria-hidden
                className="mx-1 mb-2 mt-2 h-3.5 flex-row items-center rounded-full bg-surface-brand-subtle"
            >
                <View style={{ flex: before }} />
                <View
                    style={{ flex: band }}
                    className="-my-1 h-[22px] rounded-full bg-surface-brand shadow-elevation-1 transition-all duration-normal ease-standard"
                />
                <View style={{ flex: after }} />
            </View>
            <View aria-hidden className="flex-row justify-between">
                {[low, Math.round((low + high) / 2 / 100) * 100, high].map((value, index) => (
                    <RNText
                        key={index}
                        className="text-xs font-semibold tabular-nums text-content-secondary"
                    >
                        {index === 2
                            ? t('catalogue:plan.kcalValue', { kcal: formatter.formatNumber(value) })
                            : formatter.formatNumber(value)}
                    </RNText>
                ))}
            </View>

            {/* Only when the band publishes a figure: a row of nothing but its own caveat says less
                than leaving it out. */}
            {macros.every((entry) => entry.range === null) ? null : (
                <View
                    testID="plan-detail-macros"
                    className="mt-4 flex-col gap-2 border-t border-stroke-subtle pt-4"
                >
                    <RNText className="text-sm font-bold uppercase tracking-wider text-content-secondary text-start">
                        {t('catalogue:plan.macrosTitle')}
                    </RNText>
                    {macros.map((entry) =>
                        entry.range === null ? null : (
                            <MeterBar
                                key={entry.nutrientId}
                                testID={`plan-detail-macro-${entry.nutrientId}`}
                                label={t('catalogue:plan.macroBandLabel', {
                                    nutrient: t(`marketplace:nutrients.${entry.nutrientId}`),
                                    variant: variantName(variant, formatter.formatNumber, t),
                                })}
                                value={(entry.range.min + entry.range.max) / 2}
                                target={macroScale}
                                valueText={t('catalogue:plan.macroRange', {
                                    min: formatter.formatNumber(entry.range.min),
                                    max: formatter.formatNumber(entry.range.max),
                                })}
                            />
                        ),
                    )}
                </View>
            )}
        </Section>
    );
}

/** "Plan rules" — skip, pause, changes — and the way to how plans work. */
function PlanRules({
    cutoffHours,
    onHow,
}: {
    readonly cutoffHours: number | null;
    readonly onHow: () => void;
}) {
    const { t } = useTranslation();
    const rules = [
        {
            key: 'skip',
            icon: 'chevronForward' as const,
            title: t('catalogue:plan.ruleSkip'),
            sub: t('catalogue:plan.ruleSkipSub'),
        },
        {
            key: 'pause',
            icon: 'minus' as const,
            title: t('catalogue:plan.rulePause'),
            sub: t('catalogue:plan.rulePauseSub'),
        },
        {
            key: 'changes',
            icon: 'clock' as const,
            title: t('catalogue:plan.ruleChanges'),
            sub:
                cutoffHours === null
                    ? t('catalogue:plan.ruleChangesSub')
                    : t('catalogue:plan.ruleChangesHours', { count: cutoffHours }),
        },
    ];
    return (
        <Section testID="plan-detail-rules" title={t('catalogue:plan.rulesTitle')}>
            <View className="flex-row flex-wrap gap-2.5">
                {rules.map((rule) => (
                    <View
                        key={rule.key}
                        testID={`plan-detail-rule-${rule.key}`}
                        className="min-w-[180px] flex-1 flex-row items-center gap-2.5 rounded-2xl bg-surface-base p-3"
                    >
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-brand-subtle">
                            <Icon
                                name={rule.icon}
                                size="sm"
                                className="text-content-on-brand-subtle"
                            />
                        </View>
                        <View className="min-w-0 flex-1">
                            <RNText className="text-sm font-bold text-content-primary text-start">
                                {rule.title}
                            </RNText>
                            <RNText className="text-xs font-medium text-content-secondary text-start">
                                {rule.sub}
                            </RNText>
                        </View>
                    </View>
                ))}
            </View>
            <Pressable
                testID="plan-detail-how"
                role="link"
                accessibilityRole="link"
                onPress={onHow}
                className="mt-4 flex-row items-center gap-3 rounded-[20px] bg-surface-brand-subtle px-[18px] py-4 transition duration-normal ease-standard hover:-translate-y-0.5"
            >
                <Icon name="info" size="md" className="text-content-on-brand-subtle" />
                <RNText className="text-base font-bold text-content-on-brand-subtle">
                    {t('catalogue:plan.howPlansWork')}
                </RNText>
                <View className="ms-auto h-9 w-9 items-center justify-center rounded-full bg-surface-raised">
                    <Icon
                        name="chevronForward"
                        size="sm"
                        className="text-content-on-brand-subtle"
                    />
                </View>
            </Pressable>
        </Section>
    );
}

/** The price card beside the plan: a day on the canopy, the lengths, and the ways on. */
function PriceCard({
    plan,
    variant,
    held,
    viewOnly,
    signedIn,
    restoring,
    onSetUp,
    onManage,
    onCompare,
}: {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant;
    readonly held: string | null;
    readonly viewOnly: boolean;
    readonly signedIn: boolean;
    readonly restoring: boolean;
    readonly onSetUp: () => void;
    readonly onManage: (id: string) => void;
    readonly onCompare: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    // The server states one figure only when every configuration agrees; otherwise the total is the
    // selected variant's, derived from numbers the kitchen did quote.
    const totalOf = (option: SubscriptionPlan['durations'][number]) => {
        const total = estimatedTotal(variant, option);
        return total === null ? '—' : formatMoney(formatter, total);
    };
    const shortest = plan.durations[0];
    const single = plan.durations.length === 1;

    return (
        <View
            testID="plan-detail-commerce"
            className="overflow-hidden rounded-3xl border border-stroke-subtle bg-surface-raised"
        >
            <View className="relative overflow-hidden bg-surface-canopy px-[22px] py-5">
                <View
                    aria-hidden
                    pointerEvents="none"
                    className="absolute -end-20 -top-24 h-60 w-60 rounded-full bg-stage-green opacity-15"
                />
                <RNText className="text-xs font-bold uppercase tracking-wider text-content-on-canopy-muted">
                    {t('catalogue:plan.priceTitle')}
                </RNText>
                <View
                    testID="plan-detail-price"
                    accessibilityLabel={t('catalogue:plan.pricePerDay', {
                        price: formatMoney(formatter, listDayPrice(variant)),
                    })}
                    className="mt-1.5 flex-row items-baseline gap-1.5"
                >
                    <RNText className="font-display text-5xl font-bold tabular-nums tracking-display text-content-on-canopy">
                        {formatMoney(formatter, listDayPrice(variant))}
                    </RNText>
                    <RNText className="text-base font-semibold text-content-on-canopy-muted">
                        {t('catalogue:plans.aDay')}
                    </RNText>
                </View>
                <RNText
                    testID="plan-detail-price-run"
                    className="mt-2 text-sm font-medium text-content-on-canopy-muted"
                >
                    {shortest === undefined
                        ? t('catalogue:plan.noDurations')
                        : t('catalogue:plan.priceForRun', {
                              run: durationWithBalance(shortest.days, t, formatter.formatNumber),
                              price: totalOf(shortest),
                          })}
                </RNText>
            </View>

            <View className="flex-col gap-3 px-[22px] pb-[22px] pt-[18px]">
                <RNText className="text-sm font-bold uppercase tracking-wider text-content-secondary">
                    {t('catalogue:plan.durationsTitle')}
                </RNText>
                {plan.durations.length === 0 ? (
                    <RNText
                        testID="plan-detail-durations-none"
                        className="text-sm text-content-secondary"
                    >
                        {t('catalogue:plan.noDurations')}
                    </RNText>
                ) : (
                    <View testID="plan-detail-durations" className="flex-row flex-wrap gap-2">
                        {plan.durations.map((option) => (
                            <View
                                key={option.duration}
                                testID={`plan-detail-duration-${option.duration}`}
                                className={cx(
                                    'min-h-14 min-w-[96px] flex-1 items-center justify-center rounded-[14px] border-[1.5px] px-2 py-1.5',
                                    single
                                        ? 'border-surface-brand bg-surface-brand-subtle'
                                        : 'border-stroke-subtle bg-surface-base',
                                )}
                            >
                                <RNText
                                    className={cx(
                                        'text-base font-bold tabular-nums',
                                        single
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-primary',
                                    )}
                                >
                                    {t('catalogue:plans.finderDaysValue', { count: option.days })}
                                </RNText>
                                <RNText
                                    className={cx(
                                        'text-xs font-medium tabular-nums',
                                        single
                                            ? 'text-content-on-brand-subtle'
                                            : 'text-content-secondary',
                                    )}
                                >
                                    {t('catalogue:plan.durationTotal', { total: totalOf(option) })}
                                </RNText>
                                {option.discountPercent > 0 ? (
                                    <RNText className="text-xs font-bold text-content-on-brand-subtle">
                                        {t('catalogue:plan.durationDiscount', {
                                            discount: formatter.formatNumber(
                                                option.discountPercent,
                                            ),
                                        })}
                                    </RNText>
                                ) : null}
                            </View>
                        ))}
                    </View>
                )}

                {held === null ? null : (
                    <Pressable
                        testID="plan-detail-manage"
                        role="button"
                        accessibilityRole="button"
                        accessibilityLabel={t('catalogue:plans.managePlanNamed', {
                            plan: plan.name,
                        })}
                        onPress={() => {
                            onManage(held);
                        }}
                        className="h-[54px] flex-row items-center justify-between rounded-2xl bg-surface-brand px-5 hover:bg-surface-canopy"
                    >
                        <RNText className="text-base font-bold text-content-on-brand">
                            {t('catalogue:plans.managePlan')}
                        </RNText>
                        <Icon name="chevronForward" size="md" className="text-content-on-brand" />
                    </Pressable>
                )}
                {viewOnly ? null : (
                    <Pressable
                        testID="plan-detail-configure"
                        role="button"
                        accessibilityRole="button"
                        accessibilityState={{ disabled: restoring, busy: restoring }}
                        disabled={restoring}
                        onPress={onSetUp}
                        className={cx(
                            'group h-[54px] flex-row items-center justify-between rounded-2xl px-5',
                            held === null
                                ? 'bg-surface-brand hover:bg-surface-canopy'
                                : 'border border-stroke bg-surface-raised hover:bg-surface-brand-subtle',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-base font-bold',
                                held === null ? 'text-content-on-brand' : 'text-content-primary',
                            )}
                        >
                            {signedIn || restoring
                                ? t('catalogue:plan.configure')
                                : t('catalogue:plan.configureSignIn')}
                        </RNText>
                        {restoring ? (
                            <ActivityIndicator size="small" />
                        ) : (
                            <View
                                className={cx(
                                    'h-8 w-8 items-center justify-center rounded-full transition duration-normal ease-standard',
                                    held === null
                                        ? 'bg-content-on-brand/20'
                                        : 'bg-surface-brand-subtle',
                                )}
                            >
                                <Icon
                                    name="chevronForward"
                                    size="sm"
                                    className={
                                        held === null
                                            ? 'text-content-on-brand'
                                            : 'text-content-on-brand-subtle'
                                    }
                                />
                            </View>
                        )}
                    </Pressable>
                )}
                <Pressable
                    testID="plan-detail-compare"
                    role="button"
                    accessibilityRole="button"
                    onPress={onCompare}
                    className="h-12 flex-row items-center justify-center gap-2 rounded-[14px] border border-stroke bg-surface-raised px-4 hover:bg-surface-brand-subtle"
                >
                    <Icon name="filter" size="sm" className="text-content-primary" />
                    <RNText className="text-sm font-semibold text-content-primary">
                        {t('catalogue:plan.addToCompare')}
                    </RNText>
                </Pressable>
                <View className="flex-col gap-2 pt-1">
                    <View className="flex-row items-center gap-2">
                        <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-sm font-medium text-content-secondary">
                            {t('catalogue:plan.priceLocked')}
                        </RNText>
                    </View>
                    <View className="flex-row items-center gap-2">
                        <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                        <RNText className="text-sm font-medium text-content-secondary">
                            {t('catalogue:plan.allergenSafe')}
                        </RNText>
                    </View>
                </View>
            </View>
        </View>
    );
}
