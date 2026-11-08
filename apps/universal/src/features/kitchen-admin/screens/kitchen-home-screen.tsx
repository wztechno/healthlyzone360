import type { KitchenOrder } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    Cascade,
    EmptyState,
    Heading,
    Icon,
    Inline,
    Skeleton,
    Stack,
    Text,
    cx,
    useContentWidth,
    useMotion,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    useBranchOperatingQuery,
    useIngredientSummaryQuery,
    useCatalogueDraftCountQuery,
    usePlanSummaryQuery,
    useProductSummaryQuery,
    useRecipeOnSaleByKindQuery,
    useRecipeSummaryQuery,
    useReviewQueueQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    useConsumptionExceptionCountQuery,
    useDuplicateStockQuery,
    useKitchenSetupQuery,
    useLowStockCountQuery,
    usePurchaseOrdersQuery,
    useSuppliersQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import {
    useConfirmOrderMutation,
    useKitchenDisplayQuery,
} from '../../../data/kitchen-orders-hooks.ts';
import { useOrderDeskShortfallCountQuery } from '../../../data/order-desk-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { operatingDraftsFrom, summariseOperating } from '../delivery-model.ts';
import {
    CATALOGUE_VIEW_PERMISSION,
    ENTITY_GROUPS,
    INVENTORY_MANAGE_PERMISSION,
    ORDER_MANAGE_PERMISSION,
    ORDER_PREPARE_PERMISSION,
    ORDER_VIEW_PERMISSION,
    WORKSPACE_PERMISSIONS,
    permittedFamilies,
} from '../entity-registry.ts';
import type { EntityFamily } from '../entity-registry.ts';
import { formatMoney } from '../format.ts';
import { GROUP_LABEL_KEYS } from '../kitchen-nav.ts';
import { buildReviewQueue } from '../review-queue.ts';

/**
 * `/kitchen` — the overview: what needs someone today, then every module one press away.
 *
 * Built from the "Kitchen — overview" board of the redesign canvas, top to bottom:
 *
 * 1. **The opening:** the date and branch, the title, and the two actions a kitchen starts from.
 * 2. **Five figures** of one size: a status dot, the label and the number on one line. Amber when it
 *    is waiting on someone; a zero is good news and stays plain.
 * 3. **Two rows of two cards:** what needs attention beside how much of the catalogue is on sale, the
 *    orders to confirm beside stock and buying. Each card matches the one beside it, top and bottom.
 * 4. **Stock and buying** is a route rather than a set of tiles: what the kitchen uses, what it needs
 *    to order, the supply order being drafted and who it buys from.
 * 5. **Go to:** every module as a small pill, grouped by the rail's sections. A pill carries a count
 *    only where the count is something to act on; past four, the rest wait behind "+N more".
 *
 * Counts stay honest: a total the server could not give is "Count unavailable", never a zero.
 */

type Tone = 'warning' | 'ok' | 'neutral';

/** How many module pills a Go to card shows before "+N more". */
const GO_TO_PILLS = 4;

/** How many orders the Confirm list carries; All orders has the rest. */
const ORDERS_SHOWN = 5;

const DOT_CLASS: Readonly<Record<Tone, string>> = {
    warning: 'bg-warning-border',
    ok: 'bg-surface-brand',
    neutral: 'bg-stroke-strong',
};

const COUNT_CLASS: Readonly<Record<Tone, { readonly box: string; readonly ink: string }>> = {
    warning: { box: 'bg-warning-subtle', ink: 'text-warning-on-subtle' },
    ok: { box: 'bg-surface-brand-subtle', ink: 'text-content-on-brand-subtle' },
    neutral: { box: 'bg-surface-sunken', ink: 'text-content-secondary' },
};

/** A small count box — amber when it is waiting on someone. */
function CountPill({
    value,
    tone,
    testID,
}: {
    readonly value: string;
    readonly tone: Tone;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className={cx(
                'h-6 items-center justify-center rounded-full px-2',
                COUNT_CLASS[tone].box,
            )}
            style={{ minWidth: 26 }}
        >
            <Text variant="label" className={cx('font-bold', COUNT_CLASS[tone].ink)}>
                {value}
            </Text>
        </View>
    );
}

/** One figure: a status dot, the label and the number, on one line at one size. */
function StatTile({
    testID,
    label,
    value,
    pending,
    tone,
    onPress,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: string;
    readonly pending: boolean;
    readonly tone: Tone;
    readonly onPress?: (() => void) | undefined;
}) {
    return (
        <View style={{ flexGrow: 1, flexBasis: 0, minWidth: 150 }}>
            <Card
                testID={testID}
                padding="sm"
                tone="raised"
                interactive={onPress !== undefined}
                accessibilityLabel={label}
                {...(onPress === undefined ? {} : { onPress })}
                className={
                    tone === 'warning'
                        ? '!border-transparent !bg-warning-subtle'
                        : 'border-stroke-subtle'
                }
            >
                <Inline space="xs" align="center" wrap={false}>
                    <View className={cx('h-2 w-2 rounded-full', DOT_CLASS[tone])} />
                    <Text
                        tone={tone === 'warning' ? 'warning' : 'secondary'}
                        numberOfLines={1}
                        className="min-w-0 flex-1"
                    >
                        {label}
                    </Text>
                    {pending ? (
                        <Skeleton
                            testID={`${testID}-loading`}
                            heightClassName="h-5"
                            widthClassName="w-8"
                        />
                    ) : (
                        <Text
                            testID={`${testID}-value`}
                            variant="bodyStrong"
                            tone={tone === 'warning' ? 'warning' : 'primary'}
                            className="tabular-nums"
                        >
                            {value}
                        </Text>
                    )}
                </Inline>
            </Card>
        </View>
    );
}

/** A panel: a title, what sits beside it, then its lines. */
function Panel({
    testID,
    title,
    count,
    link,
    grow = false,
    children,
}: {
    readonly testID: string;
    readonly title: string;
    readonly count?: ReactNode;
    readonly link?: { readonly label: string; readonly onPress: () => void } | undefined;
    /** The last card of a column: takes what is left, so the two columns end level. */
    readonly grow?: boolean | undefined;
    readonly children: ReactNode;
}) {
    return (
        <Card
            testID={testID}
            padding="none"
            tone="raised"
            className={cx('min-w-0 border-stroke-subtle p-1.5', grow ? 'flex-1' : '')}
        >
            <Inline space="sm" align="center" wrap={false} className="px-3 pb-2 pt-3">
                <Heading level={2}>{title}</Heading>
                {count}
                {link === undefined ? null : (
                    <Pressable
                        role="link"
                        onPress={link.onPress}
                        className="ms-auto min-h-6 justify-center"
                    >
                        <Text variant="label" tone="brand">
                            {link.label}
                        </Text>
                    </Pressable>
                )}
            </Inline>
            {children}
        </Card>
    );
}

interface AttentionCheck {
    readonly key: string;
    readonly count: number | null;
    readonly pending: boolean;
    /**
     * The line, without its count — "Records to review" — or the check's own all-clear. The count
     * is the number beside it, so the line no longer repeats it.
     */
    readonly text: string;
    /** The line as a screen reader hears it, count included — "4 need review". */
    readonly spoken?: string | undefined;
    readonly tone: Tone;
    readonly actionLabel: string;
    readonly href: string;
    /** The test id of the line's text, kept from the module card it used to live on. */
    readonly textTestID: string;
    readonly extra?: ReactNode;
}

/** One check: the whole line is the target, and the verb on it says what pressing does. */
function AttentionRow({
    check,
    onPress,
}: {
    readonly check: AttentionCheck;
    readonly onPress: () => void;
}) {
    const warning = check.tone === 'warning';
    return (
        <Pressable
            testID={`kitchen-home-attention-${check.key}`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={check.spoken ?? check.text}
            onPress={onPress}
            className="min-h-12 flex-row items-center gap-3 rounded-xl py-1.5 pe-2 ps-3 transition duration-normal ease-standard hover:bg-surface-sunken"
        >
            {check.pending ? (
                <Skeleton heightClassName="h-5" widthClassName="w-1/2" />
            ) : (
                <>
                    <View
                        className={cx(
                            'h-8 w-8 items-center justify-center rounded-full',
                            COUNT_CLASS[check.tone].box,
                        )}
                    >
                        <Icon
                            name={warning ? 'warning' : 'check'}
                            size="sm"
                            className={COUNT_CLASS[check.tone].ink}
                        />
                    </View>
                    <Text testID={check.textTestID} numberOfLines={1} className="min-w-0 flex-1">
                        {check.text}
                    </Text>
                    {check.extra}
                    <Text className="font-display text-base font-bold tabular-nums">
                        {check.count === null ? '—' : String(check.count)}
                    </Text>
                    <View className="h-8 justify-center rounded-full border border-stroke-subtle px-3">
                        <Text variant="label">{check.actionLabel}</Text>
                    </View>
                </>
            )}
        </Pressable>
    );
}

const PAYMENT_KEY = {
    cash_on_delivery: 'kitchen:desk.sale.method.cashOnDelivery',
    cash_at_counter: 'kitchen:desk.sale.method.cashAtCounter',
    wish: 'kitchen:desk.sale.method.wish',
} as const satisfies Readonly<Record<KitchenOrder['paymentMethod'], string>>;

/** One order waiting to be confirmed. */
function ConfirmRow({
    order,
    canConfirm,
    pending,
    disabled,
    onConfirm,
}: {
    readonly order: KitchenOrder;
    readonly canConfirm: boolean;
    readonly pending: boolean;
    readonly disabled: boolean;
    readonly onConfirm: () => void;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const arabic = locale.toLowerCase().startsWith('ar');
    const { delivery } = order;
    const details = [
        arabic ? (delivery.areaNameAr ?? delivery.areaNameEn) : delivery.areaNameEn,
        arabic ? (delivery.windowNameAr ?? delivery.windowNameEn) : delivery.windowNameEn,
        t(PAYMENT_KEY[order.paymentMethod]),
    ].filter((part) => part !== null && part !== undefined);

    return (
        <View
            testID={`kitchen-home-order-${String(order.id)}`}
            className="min-h-12 flex-row items-center gap-3 rounded-xl py-1.5 pe-2 ps-3"
        >
            <View className="h-8 w-8 items-center justify-center rounded-full bg-warning-subtle">
                <Icon name="receipt" size="sm" className="text-warning-on-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <Text variant="bodyStrong" numberOfLines={1} className="tabular-nums">
                    {order.orderNumber}
                </Text>
                <Text variant="caption" tone="secondary" numberOfLines={1}>
                    {details.join(' · ')}
                </Text>
            </View>
            <Text variant="bodyStrong" className="tabular-nums">
                {formatMoney(formatter, order.totalMinor / 100, order.currencyCode)}
            </Text>
            {canConfirm ? (
                <Button
                    testID={`kitchen-home-order-${String(order.id)}-confirm`}
                    size="sm"
                    label={t('kitchen:ops.orders.confirm')}
                    loading={pending}
                    disabled={disabled}
                    onPress={onConfirm}
                />
            ) : null}
        </View>
    );
}

/** One stop on the supply route: a number on the road and what it counts. */
function RouteStop({
    testID,
    countTestID,
    label,
    value,
    pending,
    waiting = false,
    onPress,
}: {
    readonly testID: string;
    readonly countTestID: string;
    readonly label: string;
    readonly value: number | null;
    readonly pending: boolean;
    readonly waiting?: boolean | undefined;
    readonly onPress: () => void;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={onPress}
            className="min-w-0 flex-1 items-center gap-1.5 transition duration-normal ease-standard hover:-translate-y-0.5"
        >
            <View
                className={cx(
                    'h-[50px] min-w-[50px] items-center justify-center rounded-full border-2 px-2',
                    waiting
                        ? 'border-warning-border bg-warning-subtle'
                        : 'border-stroke bg-surface-brand-subtle',
                )}
            >
                {pending ? (
                    <Skeleton heightClassName="h-4" widthClassName="w-6" />
                ) : (
                    <Text
                        testID={countTestID}
                        className={cx(
                            'font-display text-lg font-bold tabular-nums',
                            waiting ? 'text-warning-on-subtle' : 'text-content-on-brand-subtle',
                        )}
                    >
                        {value === null ? '—' : String(value)}
                    </Text>
                )}
            </View>
            <Text
                variant="caption"
                align="center"
                tone={waiting ? 'warning' : 'secondary'}
                className="font-semibold"
            >
                {label}
            </Text>
        </Pressable>
    );
}

/** The van over the road, driving in the once. */
function RouteVan() {
    const { enabled } = useMotion();
    const { locale } = useLocale();
    const [progress] = useState(() => new Animated.Value(enabled ? 0 : 1));
    useEffect(() => {
        if (!enabled) return;
        Animated.timing(progress, {
            toValue: 1,
            duration: 1100,
            delay: 500,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== 'web',
        }).start();
    }, [enabled, progress]);
    const from = locale.toLowerCase().startsWith('ar') ? 90 : -90;
    return (
        <Animated.View
            aria-hidden
            className="absolute start-[37.5%] top-0"
            style={{
                opacity: progress,
                transform: [
                    {
                        translateX: progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: [from, 0],
                        }),
                    },
                ],
            }}
        >
            <Icon name="truck" size="md" className="text-content-on-brand-subtle" />
        </Animated.View>
    );
}

export function KitchenHomeScreen() {
    const { t } = useTranslation();
    const { width: contentWidth } = useContentWidth();
    const router = useRouter();
    const formatter = useFormatter();
    const state = useAccessState();
    const { me } = useSession();
    const families = permittedFamilies(state);

    const permitted = new Set(families.map((family) => family.key));
    const canViewCatalogue = useCan(CATALOGUE_VIEW_PERMISSION);
    // Only a manager can merge or count a shelf, so only a manager pays for the duplicates scan.
    const canManageStock = useCan(INVENTORY_MANAGE_PERMISSION);
    const showDuplicates = permitted.has('stock-duplicates') && canManageStock;
    const branchId = state.branch?.id ?? null;

    // The recipe card counts what is on sale as published — the menu's question, not the recipe's.
    const recipeSummary = useRecipeSummaryQuery(permitted.has('recipes'), canViewCatalogue);
    const productSummary = useProductSummaryQuery(permitted.has('products'));
    /*
     * The Drafts figure still counts sauces, dressings and meals as items. Their families went into
     * the recipe book, so these reads are keyed on the code that lists the items rather than on a
     * family that no longer exists — keyed on the family, they would never load.
     */
    const sauceDrafts = useCatalogueDraftCountQuery('sauce', canViewCatalogue);
    const dressingDrafts = useCatalogueDraftCountQuery('dressing', canViewCatalogue);
    const mealDrafts = useCatalogueDraftCountQuery('meal', canViewCatalogue);
    const planSummary = usePlanSummaryQuery(permitted.has('plans'));
    const ingredientSummary = useIngredientSummaryQuery(permitted.has('ingredients'));
    const reviewSources = useReviewQueueQuery(permitted.has('review'));
    const lowStock = useLowStockCountQuery(permitted.has('stock'));
    const setup = useKitchenSetupQuery(permitted.has('setup'));
    const exceptionsCount = useConsumptionExceptionCountQuery(
        permitted.has('consumption-exceptions'),
    );
    // ponytail: the home reads this list only to count it, and every read is a heavy scan over each
    // shelf; five minutes keeps the home from re-running it on every visit. Add
    // `GET /inventory/duplicates/count` if the scan ever shows up as slow.
    const duplicates = useDuplicateStockQuery(showDuplicates, 5 * 60_000);
    // Asked with the workspace's active branch, which may be null — the endpoint answers with
    // `count: null` for a manager who holds no branch rather than refusing.
    const shortfalls = useOrderDeskShortfallCountQuery(
        branchId,
        permitted.has('order-requirements'),
    );
    // A proposal is for one site: an organisation-wide membership gets no number rather than a sum.
    const supplyNeeds = useSupplyNeedsCountQuery(branchId, permitted.has('supplyOrders'));
    // The live book — the list it opens excludes archived suppliers, so the count does too.
    const suppliers = useSuppliersQuery({}, permitted.has('suppliers'));
    const operatingBranch =
        permitted.has('branch-operating') && branchId !== null
            ? KitchenBranchId.unsafe(branchId)
            : null;
    const operating = useBranchOperatingQuery(operatingBranch);
    const operatingSummary =
        operating.data === undefined
            ? null
            : summariseOperating(operatingDraftsFrom(operating.data));

    const reviewQueue = useMemo(() => {
        const data = reviewSources.data;
        if (data === undefined) return null;
        return buildReviewQueue({
            ingredients: data.ingredients,
            quarantinedRecipes: data.quarantinedRecipes,
            staleRecipes: data.staleRecipes,
            products: data.products,
            meals: data.meals,
            plans: data.plans,
            priceLists: data.priceLists,
        });
    }, [reviewSources.data]);

    const draftParts: Array<number | null | undefined> = [];
    if (permitted.has('ingredients')) draftParts.push(ingredientSummary.data?.drafts);
    if (permitted.has('recipes')) draftParts.push(recipeSummary.data?.drafts);
    if (permitted.has('products')) draftParts.push(productSummary.data?.drafts);
    if (canViewCatalogue) {
        draftParts.push(sauceDrafts.data, dressingDrafts.data, mealDrafts.data);
    }
    const knownDrafts = draftParts.filter((part): part is number => typeof part === 'number');
    const draftsPending =
        (permitted.has('ingredients') && ingredientSummary.isPending) ||
        (permitted.has('recipes') && recipeSummary.isPending) ||
        (permitted.has('products') && productSummary.isPending) ||
        (canViewCatalogue && mealDrafts.isPending);
    const draftTotal = draftsPending
        ? null
        : draftParts.length === 0
          ? 0
          : knownDrafts.length === 0
            ? null
            : knownDrafts.reduce((sum, part) => sum + part, 0);

    const lowStockCount = permitted.has('stock')
        ? lowStock.isPending
            ? null
            : (lowStock.data ?? null)
        : null;
    /*
     * `shortfall_count` is null when no branch is selected: there is no organisation-wide shelf to
     * count against. Not a zero, so a null count shows no figure at all rather than a dash a manager
     * with an organisation-wide membership would see on every visit.
     */
    const shortfallCount = permitted.has('order-requirements')
        ? shortfalls.isPending
            ? null
            : (shortfalls.data?.count ?? null)
        : null;
    const showShortfall =
        permitted.has('order-requirements') && (shortfalls.isPending || shortfallCount !== null);
    const exceptionCount = permitted.has('consumption-exceptions')
        ? exceptionsCount.isPending
            ? null
            : (exceptionsCount.data ?? null)
        : null;
    const duplicateCount = showDuplicates ? (duplicates.data?.length ?? null) : null;

    const open = (href: string) => () => {
        router.push(href as never);
    };
    const figure = (value: number | null) =>
        value === null ? t('kitchen:hub.countUnavailable') : String(value);
    const waitingTone = (value: number | null): Tone =>
        value !== null && value > 0 ? 'warning' : 'ok';

    /* ---------------------------------------------------------------- the five figures */

    const stats: Array<Parameters<typeof StatTile>[0] & { readonly key: string }> = [];
    if (permitted.has('review')) {
        stats.push({
            key: 'review',
            testID: 'kitchen-kpi-review',
            label: t('kitchen:hub.kpi.needsReview'),
            value: figure(reviewQueue?.total ?? null),
            pending: reviewSources.isPending,
            tone: waitingTone(reviewQueue?.total ?? null),
            onPress: open('/kitchen/review'),
        });
    }
    if (permitted.has('consumption-exceptions')) {
        stats.push({
            key: 'consumption-exceptions',
            testID: 'kitchen-kpi-consumption-exceptions',
            label: t('kitchen:hub.kpi.consumptionExceptions'),
            value: figure(exceptionCount),
            pending: exceptionsCount.isPending,
            tone: waitingTone(exceptionCount),
            onPress: open('/kitchen/consumption-exceptions'),
        });
    }
    if (showShortfall) {
        stats.push({
            key: 'requirement-shortfalls',
            testID: 'kitchen-kpi-requirement-shortfalls',
            label: t('kitchen:hub.kpi.requirementShortfalls'),
            value: figure(shortfallCount),
            pending: shortfalls.isPending,
            tone: waitingTone(shortfallCount),
            onPress: open('/kitchen/order-desk/requirements'),
        });
    }
    if (permitted.has('stock')) {
        stats.push({
            key: 'low-stock',
            testID: 'kitchen-kpi-low-stock',
            label: t('kitchen:hub.kpi.lowStock'),
            value: figure(lowStockCount),
            pending: lowStock.isPending,
            tone: waitingTone(lowStockCount),
            onPress: open('/kitchen/stock'),
        });
    }
    stats.push({
        key: 'drafts',
        testID: 'kitchen-kpi-drafts',
        label: t('kitchen:hub.kpi.drafts'),
        value: figure(draftTotal),
        pending: draftsPending,
        tone: 'neutral',
    });

    /* ---------------------------------------------------------------- needs attention */

    const checks: AttentionCheck[] = [];
    if (permitted.has('review')) {
        const total = reviewQueue?.total ?? null;
        checks.push({
            key: 'review',
            count: total,
            pending: reviewSources.isPending,
            text:
                total === null
                    ? t('kitchen:hub.countUnavailable')
                    : total === 0
                      ? t('kitchen:review.clearBadge')
                      : t('kitchen:hub.attention.review'),
            spoken: total === null ? undefined : t('kitchen:review.waitingCount', { count: total }),
            tone: waitingTone(total),
            actionLabel: t('kitchen:hub.action.review'),
            href: '/kitchen/review',
            textTestID: 'kitchen-family-review-total',
            extra:
                reviewQueue === null || reviewQueue.blocked === 0 ? undefined : (
                    <View
                        testID="kitchen-family-review-blocked"
                        className="rounded bg-danger-subtle px-1.5 py-0.5"
                    >
                        <Text variant="micro" tone="danger">
                            {t('kitchen:review.blockedCount', { count: reviewQueue.blocked })}
                        </Text>
                    </View>
                ),
        });
    }
    if (permitted.has('consumption-exceptions')) {
        checks.push({
            key: 'consumption-exceptions',
            count: exceptionCount,
            pending: exceptionsCount.isPending,
            text:
                exceptionCount === null
                    ? t('kitchen:hub.countUnavailable')
                    : exceptionCount === 0
                      ? t('kitchen:ops.exceptions.clearBadge')
                      : t('kitchen:hub.attention.stockGaps'),
            spoken:
                exceptionCount === null
                    ? undefined
                    : t('kitchen:ops.exceptions.unresolvedCount', { count: exceptionCount }),
            tone: waitingTone(exceptionCount),
            actionLabel: t('kitchen:hub.action.fix'),
            href: '/kitchen/consumption-exceptions',
            textTestID: 'kitchen-family-consumption-exceptions-total',
        });
    }
    if (showDuplicates) {
        checks.push({
            key: 'stock-duplicates',
            count: duplicateCount,
            pending: duplicates.isPending,
            text:
                duplicateCount === null
                    ? t('kitchen:hub.countUnavailable')
                    : duplicateCount === 0
                      ? t('kitchen:ops.exceptions.clearBadge')
                      : t('kitchen:hub.attention.duplicates'),
            spoken:
                duplicateCount === null
                    ? undefined
                    : t('kitchen:hub.attention.duplicatesCount', { count: duplicateCount }),
            tone: waitingTone(duplicateCount),
            actionLabel: t('kitchen:hub.action.review'),
            href: '/kitchen/stock-duplicates',
            textTestID: 'kitchen-family-stock-duplicates-total',
        });
    }
    if (showShortfall) {
        checks.push({
            key: 'requirement-shortfalls',
            count: shortfallCount,
            pending: shortfalls.isPending,
            text: t('kitchen:hub.attention.shortfalls'),
            spoken: t('kitchen:ops.requirements.shortfallCount', { count: shortfallCount ?? 0 }),
            tone: waitingTone(shortfallCount),
            actionLabel: t('kitchen:hub.action.plan'),
            href: '/kitchen/order-desk/requirements',
            textTestID: 'kitchen-family-order-requirements-total',
        });
    }
    if (operatingBranch !== null) {
        const withCutOff = operatingSummary?.withCutOff ?? null;
        checks.push({
            key: 'cut-offs',
            count: withCutOff,
            pending: operating.isPending,
            text:
                withCutOff === null
                    ? t('kitchen:hub.countUnavailable')
                    : t('kitchen:hub.attention.cutOffs'),
            spoken:
                withCutOff === null
                    ? undefined
                    : t('kitchen:branchHours.cutOffDayCount', { count: withCutOff }),
            // No cut-off on any open day is the thing to fix; any number of them is fine.
            tone: withCutOff === 0 ? 'warning' : 'ok',
            actionLabel: t('kitchen:hub.action.set'),
            href: '/kitchen/branch-operating',
            textTestID: 'kitchen-family-branch-operating-cut-offs',
        });
    }
    const waitingChecks = checks.filter((check) => check.tone === 'warning').length;

    /* ---------------------------------------------------------------- on sale */

    const onSaleKinds = useRecipeOnSaleByKindQuery(canViewCatalogue);
    const onSaleBar = (
        key: string,
        label: string,
        href: string,
        fill: string,
        counts: { readonly total: number | null; readonly published?: number | null } | undefined,
        pendingBar: boolean,
    ) => ({
        key,
        label,
        href,
        fill,
        total: counts?.total ?? null,
        published: counts?.published ?? null,
        pending: pendingBar,
    });
    const kindCounts = onSaleKinds.data;
    const onSale = [
        ...(canViewCatalogue
            ? [
                  onSaleBar(
                      'meals',
                      t('kitchen:desk.sale.section.meals'),
                      '/kitchen/meals',
                      'bg-tint-green-fill',
                      kindCounts?.meal,
                      onSaleKinds.isPending,
                  ),
              ]
            : []),
        ...(permitted.has('products')
            ? [
                  onSaleBar(
                      'products',
                      t('kitchen:families.products.name'),
                      '/kitchen/products',
                      'bg-tint-teal-fill',
                      productSummary.data,
                      productSummary.isPending,
                  ),
              ]
            : []),
        ...(canViewCatalogue
            ? [
                  onSaleBar(
                      'sauces',
                      t('kitchen:desk.sale.section.sauces'),
                      '/kitchen/sauces',
                      'bg-tint-orange-fill',
                      kindCounts?.sauce,
                      onSaleKinds.isPending,
                  ),
                  onSaleBar(
                      'dressings',
                      t('kitchen:desk.sale.section.dressings'),
                      '/kitchen/dressings',
                      'bg-tint-yellow-fill',
                      kindCounts?.dressing,
                      onSaleKinds.isPending,
                  ),
                  onSaleBar(
                      'frozen',
                      t('kitchen:desk.sale.section.frozenMeals'),
                      '/kitchen/frozen-meals',
                      'bg-tint-blue-fill',
                      kindCounts?.frozen_meal,
                      onSaleKinds.isPending,
                  ),
              ]
            : []),
        ...(permitted.has('plans')
            ? [
                  onSaleBar(
                      'plans',
                      t('kitchen:families.plans.name'),
                      '/kitchen/plans',
                      'bg-tint-violet-fill',
                      planSummary.data,
                      planSummary.isPending,
                  ),
              ]
            : []),
    ];

    /* ---------------------------------------------------------------- orders to confirm */

    const canReadOrders = useCan([ORDER_VIEW_PERMISSION, ORDER_PREPARE_PERMISSION], 'any');
    const canConfirm = useCan(ORDER_MANAGE_PERMISSION);
    const display = useKitchenDisplayQuery(canReadOrders && branchId !== null, false);
    const confirmOrder = useConfirmOrderMutation();
    const confirmFailure = toFailure(confirmOrder.error);
    const toConfirm = useMemo(
        () =>
            (display.data?.orders ?? [])
                .filter(
                    (order) =>
                        order.status === 'placed' &&
                        (order.branchId === null || order.branchId === branchId),
                )
                .sort((left, right) =>
                    (left.dueAt ?? left.placedAt).localeCompare(right.dueAt ?? right.placedAt),
                ),
        [display.data, branchId],
    );

    /* ---------------------------------------------------------------- stock and buying */

    const draftOrders = usePurchaseOrdersQuery(
        { status: 'draft' },
        permitted.has('supplyOrders') && branchId !== null,
    );
    const supplyNeedCount = supplyNeeds.data?.count ?? null;
    const showStock =
        permitted.has('ingredients') || permitted.has('supplyOrders') || permitted.has('suppliers');

    /* ---------------------------------------------------------------- go to */

    /** Counts a pill carries: only the ones that are something to act on. */
    const pillCount = (key: string): number | null => {
        if (key === 'review') return reviewQueue?.total ?? null;
        if (key === 'consumption-exceptions') return exceptionCount;
        if (key === 'stock-duplicates') return duplicateCount;
        if (key === 'order-requirements') return shortfallCount;
        return null;
    };
    const wide = contentWidth >= 900;
    // Two rows rather than two columns, so each card lines up with the one beside it.
    const panelRow = wide ? 'flex-row items-stretch gap-3' : 'gap-3';
    const panelStart = wide ? 'min-w-0 flex-[1.3]' : '';
    const panelEnd = wide ? 'min-w-0 flex-1' : '';
    const goToGrid =
        contentWidth >= 1000 ? 'grid-cols-5' : contentWidth >= 640 ? 'grid-cols-3' : 'grid-cols-1';
    const todayDate = formatter.formatDate(new Date(), { dateStyle: 'full' });
    const branchName = me?.memberships
        .flatMap((membership) => membership.branches)
        .find((candidate) => candidate.id === branchId)?.name;
    const today =
        branchName === undefined
            ? todayDate
            : t('kitchen:hub.dateLine', { date: todayDate, branch: branchName });

    return (
        <Gate area="kitchen" requirement={{ anyOf: WORKSPACE_PERMISSIONS }} testID="kitchen-home">
            <Cascade space="md" testID="kitchen-home-screen">
                {setup.data?.isLive === false ? (
                    <Callout
                        testID="kitchen-home-not-open"
                        tone="warning"
                        icon="warning"
                        title={t('kitchen:setup.notOpenTitle')}
                        body={t('kitchen:setup.notOpenBody')}
                        actions={
                            <Button
                                testID="kitchen-home-open-setup"
                                size="sm"
                                label={t('kitchen:families.setup.name')}
                                onPress={open('/kitchen/setup')}
                            />
                        }
                    />
                ) : null}

                {families.length === 0 ? (
                    <EmptyState
                        testID="kitchen-home-empty"
                        title={t('kitchen:hub.emptyTitle')}
                        body={t('kitchen:hub.emptyBody')}
                    />
                ) : (
                    <>
                        <Inline space="sm" align="end" justify="between" wrap>
                            <Stack space="xs" className="min-w-0">
                                <Text tone="secondary" testID="kitchen-home-date">
                                    {today}
                                </Text>
                                <Heading level={1} className="!text-3xl">
                                    {t('kitchen:hub.title')}
                                </Heading>
                            </Stack>
                            <Inline space="xs" align="center">
                                {permitted.has('supplyOrders') ? (
                                    <Button
                                        testID="kitchen-home-order-supplies"
                                        variant="secondary"
                                        iconStart={
                                            <Icon
                                                name="truck"
                                                size="sm"
                                                className="text-content-primary"
                                            />
                                        }
                                        label={t('kitchen:hub.orderSupplies')}
                                        onPress={open('/kitchen/supply-orders/new')}
                                    />
                                ) : null}
                                {permitted.has('order-desk') ? (
                                    <Button
                                        testID="kitchen-home-new-order"
                                        label={t('kitchen:hub.newSale')}
                                        onPress={open('/kitchen/order-desk/sale')}
                                    />
                                ) : null}
                            </Inline>
                        </Inline>

                        <View testID="kitchen-home-kpis" className="flex-row flex-wrap gap-3">
                            {stats.map(({ key, ...tile }) => (
                                <StatTile key={key} {...tile} />
                            ))}
                        </View>

                        <View testID="kitchen-home-panels" className="gap-3">
                            <View className={panelRow}>
                                <View className={panelStart}>
                                    {checks.length === 0 ? null : (
                                        <Panel
                                            testID="kitchen-home-attention"
                                            grow={wide}
                                            title={t('kitchen:hub.attentionTitle')}
                                            count={
                                                <CountPill
                                                    testID="kitchen-home-attention-count"
                                                    value={String(waitingChecks)}
                                                    tone={waitingChecks > 0 ? 'warning' : 'ok'}
                                                />
                                            }
                                        >
                                            {checks.map((check) => (
                                                <AttentionRow
                                                    key={check.key}
                                                    check={check}
                                                    onPress={open(check.href)}
                                                />
                                            ))}
                                        </Panel>
                                    )}
                                </View>
                                <View className={panelEnd}>
                                    {onSale.length === 0 ? null : (
                                        <Panel
                                            testID="kitchen-home-catalogue"
                                            grow={wide}
                                            title={t('kitchen:hub.onSale')}
                                            link={{
                                                label: t('kitchen:nav.groups.catalogue'),
                                                onPress: open('/kitchen/recipes'),
                                            }}
                                        >
                                            {onSale.map((bar) => {
                                                const share =
                                                    bar.total === null ||
                                                    bar.published === null ||
                                                    bar.total === 0
                                                        ? 0
                                                        : Math.min(1, bar.published / bar.total);
                                                return (
                                                    <Pressable
                                                        key={bar.key}
                                                        testID={`kitchen-home-catalogue-${bar.key}`}
                                                        role="button"
                                                        accessibilityRole="button"
                                                        accessibilityLabel={bar.label}
                                                        onPress={open(bar.href)}
                                                        className={cx(
                                                            'min-h-9 flex-row items-center gap-3 rounded-xl px-3 hover:bg-surface-sunken',
                                                            wide ? 'flex-1' : '',
                                                        )}
                                                    >
                                                        <View style={{ width: 96 }}>
                                                            <Text numberOfLines={1}>
                                                                {bar.label}
                                                            </Text>
                                                        </View>
                                                        <View className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                                                            <View
                                                                className={cx(
                                                                    'h-full rounded-full',
                                                                    bar.fill,
                                                                )}
                                                                style={{
                                                                    width: `${Math.round(share * 100)}%`,
                                                                }}
                                                            />
                                                        </View>
                                                        {bar.pending ? (
                                                            <Skeleton
                                                                heightClassName="h-4"
                                                                widthClassName="w-12"
                                                            />
                                                        ) : (
                                                            <View
                                                                style={{ minWidth: 56 }}
                                                                className="items-end"
                                                            >
                                                                <Text
                                                                    testID={`kitchen-family-${bar.key}-total`}
                                                                    variant="bodyStrong"
                                                                    className="tabular-nums"
                                                                >
                                                                    {bar.total === null
                                                                        ? t(
                                                                              'kitchen:hub.countUnavailable',
                                                                          )
                                                                        : bar.published === null
                                                                          ? String(bar.total)
                                                                          : `${String(bar.published)} / ${String(bar.total)}`}
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </Pressable>
                                                );
                                            })}
                                        </Panel>
                                    )}
                                </View>
                            </View>
                            <View className={panelRow}>
                                <View className={panelStart}>
                                    {!canReadOrders ? null : (
                                        <Panel
                                            testID="kitchen-home-orders"
                                            title={t('kitchen:hub.ordersToConfirm')}
                                            grow={wide}
                                            count={
                                                display.isPending ? null : (
                                                    <CountPill
                                                        testID="kitchen-home-orders-count"
                                                        value={String(toConfirm.length)}
                                                        tone={
                                                            toConfirm.length > 0 ? 'warning' : 'ok'
                                                        }
                                                    />
                                                )
                                            }
                                            link={{
                                                label: t('kitchen:hub.allOrders'),
                                                onPress: open('/kitchen/orders'),
                                            }}
                                        >
                                            {confirmFailure === null ? null : (
                                                <View className="px-3 pb-2">
                                                    <Text
                                                        testID="kitchen-home-orders-error"
                                                        tone="danger"
                                                    >
                                                        {confirmFailure.message}
                                                    </Text>
                                                </View>
                                            )}
                                            {display.isPending ? (
                                                <View className="gap-2 px-3 pb-2">
                                                    <Skeleton heightClassName="h-10" />
                                                    <Skeleton heightClassName="h-10" />
                                                </View>
                                            ) : toConfirm.length === 0 ? (
                                                <EmptyState
                                                    testID="kitchen-home-orders-empty"
                                                    icon="receipt"
                                                    shape="row"
                                                    title={t('kitchen:hub.noOrdersToConfirm')}
                                                />
                                            ) : (
                                                toConfirm.slice(0, ORDERS_SHOWN).map((order) => (
                                                    <ConfirmRow
                                                        key={String(order.id)}
                                                        order={order}
                                                        canConfirm={canConfirm}
                                                        pending={
                                                            confirmOrder.isPending &&
                                                            confirmOrder.variables.id === order.id
                                                        }
                                                        disabled={confirmOrder.isPending}
                                                        onConfirm={() => {
                                                            confirmOrder.mutate({
                                                                id: order.id,
                                                                lockVersion: order.lockVersion,
                                                            });
                                                        }}
                                                    />
                                                ))
                                            )}
                                        </Panel>
                                    )}
                                </View>
                                <View className={panelEnd}>
                                    {!showStock ? null : (
                                        <Panel
                                            testID="kitchen-home-buying"
                                            title={t('kitchen:hub.buyingTitle')}
                                            grow={wide}
                                        >
                                            <View className="my-auto">
                                                <View className="relative flex-row items-start gap-0.5 px-1.5 pb-2 pt-6">
                                                    <View
                                                        aria-hidden
                                                        className="absolute end-4 start-4 top-[47px] border-t-4 border-dashed border-stroke"
                                                    />
                                                    <RouteVan />
                                                    {permitted.has('ingredients') ? (
                                                        <RouteStop
                                                            testID="kitchen-home-buying-ingredients"
                                                            countTestID="kitchen-family-ingredients-total"
                                                            label={t(
                                                                'kitchen:families.ingredients.name',
                                                            )}
                                                            value={
                                                                ingredientSummary.data?.total ??
                                                                null
                                                            }
                                                            pending={ingredientSummary.isPending}
                                                            onPress={open('/kitchen/ingredients')}
                                                        />
                                                    ) : null}
                                                    {permitted.has('supplyOrders') ? (
                                                        <>
                                                            <RouteStop
                                                                testID="kitchen-home-buying-to-order"
                                                                countTestID="kitchen-family-supplyOrders-needs"
                                                                label={t(
                                                                    'kitchen:hub.itemsToOrder',
                                                                )}
                                                                value={supplyNeedCount}
                                                                pending={
                                                                    supplyNeeds.isPending &&
                                                                    branchId !== null
                                                                }
                                                                waiting={
                                                                    supplyNeedCount !== null &&
                                                                    supplyNeedCount > 0
                                                                }
                                                                onPress={open(
                                                                    '/kitchen/supply-orders',
                                                                )}
                                                            />
                                                            <RouteStop
                                                                testID="kitchen-home-buying-drafts"
                                                                countTestID="kitchen-family-supplyOrders-drafts"
                                                                label={t(
                                                                    'kitchen:hub.draftSupplyOrders',
                                                                )}
                                                                value={
                                                                    draftOrders.data?.items
                                                                        .length ?? null
                                                                }
                                                                pending={
                                                                    draftOrders.isPending &&
                                                                    branchId !== null
                                                                }
                                                                onPress={open(
                                                                    '/kitchen/supply-orders',
                                                                )}
                                                            />
                                                        </>
                                                    ) : null}
                                                    {permitted.has('suppliers') ? (
                                                        <RouteStop
                                                            testID="kitchen-home-buying-suppliers"
                                                            countTestID="kitchen-family-suppliers-total"
                                                            label={t(
                                                                'kitchen:families.suppliers.name',
                                                            )}
                                                            value={suppliers.data?.length ?? null}
                                                            pending={suppliers.isPending}
                                                            onPress={open('/kitchen/suppliers')}
                                                        />
                                                    ) : null}
                                                </View>
                                            </View>
                                            {permitted.has('supplyOrders') ? (
                                                <View className="px-3 pb-1.5 pt-1">
                                                    <Button
                                                        testID="kitchen-home-buying-order-supplies"
                                                        size="sm"
                                                        variant="secondary"
                                                        iconStart={
                                                            <Icon
                                                                name="truck"
                                                                size="sm"
                                                                className="text-content-primary"
                                                            />
                                                        }
                                                        label={t('kitchen:hub.orderSupplies')}
                                                        onPress={open('/kitchen/supply-orders/new')}
                                                    />
                                                </View>
                                            ) : null}
                                        </Panel>
                                    )}
                                </View>
                            </View>
                        </View>

                        <Stack space="xs">
                            <Heading level={2}>{t('kitchen:hub.goTo')}</Heading>
                            <View testID="kitchen-home-grid" className={`grid gap-3 ${goToGrid}`}>
                                {ENTITY_GROUPS.map((group) => {
                                    // Setup is done once the kitchen is live; the rail drops it too.
                                    const groupFamilies = families.filter(
                                        (family) =>
                                            family.group === group &&
                                            !(
                                                family.key === 'setup' &&
                                                setup.data?.isLive === true
                                            ),
                                    );
                                    const first = groupFamilies[0];
                                    if (first === undefined) return null;
                                    return (
                                        <GoToCard
                                            key={group}
                                            group={group}
                                            icon={first.icon}
                                            families={groupFamilies}
                                            pillCount={pillCount}
                                        />
                                    );
                                })}
                            </View>
                        </Stack>
                    </>
                )}
            </Cascade>
        </Gate>
    );
}

/** A section of Go to: its first four modules, the rest one press away. */
function GoToCard({
    group,
    icon,
    families,
    pillCount,
}: {
    readonly group: (typeof ENTITY_GROUPS)[number];
    readonly icon: IconName;
    readonly families: readonly EntityFamily[];
    readonly pillCount: (key: string) => number | null;
}) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const hidden = families.length - GO_TO_PILLS;
    const shown = expanded || hidden <= 0 ? families : families.slice(0, GO_TO_PILLS);

    return (
        <Card
            testID={`kitchen-home-section-${group}`}
            padding="sm"
            tone="raised"
            className="min-w-0 gap-2 border-stroke-subtle"
        >
            <Inline space="xs" align="center" wrap={false}>
                <View className="h-7 w-7 items-center justify-center rounded-lg bg-surface-brand-subtle">
                    <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
                </View>
                <Text variant="bodyStrong" numberOfLines={1} className="min-w-0 flex-1">
                    {t(GROUP_LABEL_KEYS[group])}
                </Text>
                <Text variant="caption" tone="secondary" className="tabular-nums">
                    {String(families.length)}
                </Text>
            </Inline>
            <View className="flex-row flex-wrap gap-1.5">
                {shown.map((family) => (
                    <ModulePill key={family.key} family={family} count={pillCount(family.key)} />
                ))}
                {hidden <= 0 || expanded ? null : (
                    <Pressable
                        testID={`kitchen-home-section-${group}-more`}
                        role="button"
                        accessibilityRole="button"
                        onPress={() => {
                            setExpanded(true);
                        }}
                        className="h-7 justify-center rounded-full px-1.5 hover:bg-surface-brand-subtle"
                    >
                        <Text variant="caption" tone="brand" className="font-semibold">
                            {t('kitchen:hub.moreCount', { count: hidden })}
                        </Text>
                    </Pressable>
                )}
            </View>
        </Card>
    );
}

/**
 * A module in the Go to list: its name, and a count when the count is something to act on.
 *
 * The outer box keeps `kitchen-family-{key}` for the module and the pressable carries `-open`, the
 * ids the module cards had, so a test that opened a module still finds the same target.
 */
function ModulePill({
    family,
    count,
}: {
    readonly family: EntityFamily;
    readonly count: number | null;
}) {
    const { t } = useTranslation();
    const router = useRouter();
    const name = t(family.nameKey);
    const testID = `kitchen-family-${family.key}`;
    const icon: IconName = family.icon;

    return (
        <View testID={testID}>
            <Pressable
                testID={`${testID}-open`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={name}
                onPress={() => {
                    router.push(family.href as never);
                }}
                className="h-7 flex-row items-center gap-1.5 rounded-full border border-stroke-subtle bg-surface-raised px-2.5 transition duration-normal ease-standard hover:border-surface-brand hover:bg-surface-brand-subtle"
            >
                <Icon name={icon} size="sm" className="text-content-secondary" />
                <Text variant="caption" numberOfLines={1}>
                    {name}
                </Text>
                {count === null || count === 0 ? null : (
                    <View className="rounded-full bg-warning-subtle px-1.5">
                        <Text variant="micro" className="font-bold text-warning-on-subtle">
                            {String(count)}
                        </Text>
                    </View>
                )}
            </Pressable>
        </View>
    );
}
