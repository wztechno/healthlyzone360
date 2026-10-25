import {
    Button,
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
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { UseQueryResult } from '@tanstack/react-query';

import { Gate, useCan } from '../../../access/gate.tsx';
import {
    useBranchOperatingQuery,
    useIngredientSummaryQuery,
    useCatalogueDraftCountQuery,
    usePlanSummaryQuery,
    useProductSummaryQuery,
    useRecipeSummaryQuery,
    useReviewQueueQuery,
    useZoneSummaryQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import {
    useConsumptionExceptionCountQuery,
    useLowStockCountQuery,
    useSuppliersQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useOrderDeskShortfallCountQuery } from '../../../data/order-desk-hooks.ts';
import { useAccessState, useSession } from '../../../session/session-provider.tsx';
import { operatingDraftsFrom, summariseOperating } from '../delivery-model.ts';
import {
    CATALOGUE_VIEW_PERMISSION,
    ENTITY_GROUPS,
    ORDER_CREATE_ON_BEHALF_PERMISSION,
    RECIPE_MANAGE_PERMISSION,
    WORKSPACE_PERMISSIONS,
    permittedFamilies,
} from '../entity-registry.ts';
import type { EntityFamily, EntityGroup } from '../entity-registry.ts';
import { buildReviewQueue } from '../review-queue.ts';

/**
 * `/kitchen` — the overview: what needs someone today, then every module one press away.
 *
 * Built from the "Option B — compact" board of the overview canvas, top to bottom:
 *
 * 1. **A greeting and the day's actions** — the person's name, the date and branch, and the three
 *    things a kitchen starts most often (a sale, a supply order, a recipe), each only for a role
 *    that may do it.
 * 2. **Five figures**, each its own small card of one size: a label with a status dot and the
 *    number. Amber when it is waiting on someone; a zero is good news and stays plain.
 * 3. **Three panels side by side** — what needs attention (one line per check, its count and the
 *    verb that clears it), how much of the catalogue is on sale, and stock and buying.
 * 4. **Go to** — every module as a small pill, grouped by the rail's sections, in cards of one
 *    size. A pill carries a count only where the count is something to act on.
 *
 * Counts stay honest: a total the server could not give is "Count unavailable", never a zero.
 */

type Tone = 'warning' | 'ok' | 'neutral';

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

const GROUP_LABEL_KEYS: Readonly<Record<EntityGroup, string>> = {
    orderDesk: 'kitchen:nav.groups.orderDesk',
    workbench: 'kitchen:nav.groups.workbench',
    catalogue: 'kitchen:nav.groups.catalogue',
    commercial: 'kitchen:nav.groups.commercial',
    operations: 'kitchen:nav.groups.operations',
    access: 'kitchen:nav.groups.access',
};

const GREETING_KEY = {
    morning: 'access:workspaceSelector.greeting.morning',
    afternoon: 'access:workspaceSelector.greeting.afternoon',
    evening: 'access:workspaceSelector.greeting.evening',
} as const;

/** The workspace page's split: the small hours still say good evening. */
function greetingKey(hour: number): (typeof GREETING_KEY)[keyof typeof GREETING_KEY] {
    if (hour >= 5 && hour < 12) return GREETING_KEY.morning;
    if (hour >= 12 && hour < 18) return GREETING_KEY.afternoon;
    return GREETING_KEY.evening;
}

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
            className={cx('h-6 items-center justify-center rounded px-1.5', COUNT_CLASS[tone].box)}
            style={{ minWidth: 32 }}
        >
            <Text variant="label" className={cx('font-bold', COUNT_CLASS[tone].ink)}>
                {value}
            </Text>
        </View>
    );
}

/**
 * One figure: a label with its status dot, and the number.
 *
 * Each its own card, every one the same width, so the five read as five things rather than one
 * strip — and slim, a label and a number, because the panels under them say what to do about it.
 */
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
                className="gap-1 border-brand-100"
            >
                <Inline space="xs" align="center" wrap={false}>
                    <View className={cx('h-2 w-2 rounded-full', DOT_CLASS[tone])} />
                    <Text variant="caption" tone="secondary" numberOfLines={1}>
                        {label}
                    </Text>
                </Inline>
                {pending ? (
                    <Skeleton
                        testID={`${testID}-loading`}
                        heightClassName="h-6"
                        widthClassName="w-1/3"
                    />
                ) : (
                    <Text
                        testID={`${testID}-value`}
                        variant="display"
                        tone={tone === 'warning' ? 'warning' : 'primary'}
                    >
                        {value}
                    </Text>
                )}
            </Card>
        </View>
    );
}

/** A panel: a title, an optional trailing note, then rows divided by hairlines. */
function Panel({
    testID,
    title,
    trailing,
    grow,
    children,
}: {
    readonly testID: string;
    readonly title: string;
    readonly trailing?: ReactNode;
    readonly grow: number;
    readonly children: ReactNode;
}) {
    return (
        <View style={{ flexGrow: grow, flexBasis: 0, minWidth: 260 }}>
            <Card
                testID={testID}
                padding="none"
                tone="raised"
                className="flex-1 overflow-hidden border-brand-100"
            >
                <Inline space="sm" align="center" justify="between" className="px-4 pb-2 pt-3">
                    <Heading level={2}>{title}</Heading>
                    {trailing}
                </Inline>
                {children}
            </Card>
        </View>
    );
}

/** One line of a panel, the whole line one target. */
function PanelRow({
    testID,
    accessibilityLabel,
    onPress,
    children,
}: {
    readonly testID: string;
    readonly accessibilityLabel: string;
    readonly onPress: () => void;
    readonly children: ReactNode;
}) {
    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            onPress={onPress}
            className="flex-row items-center gap-2 border-t border-stroke-subtle px-4 py-2 transition duration-normal ease-standard hover:bg-surface-sunken"
            style={{ minHeight: 40 }}
        >
            {children}
        </Pressable>
    );
}

interface AttentionCheck {
    readonly key: string;
    readonly count: number | null;
    readonly pending: boolean;
    /** The line, with its count — "4 need review", or the check's own all-clear. */
    readonly text: string;
    readonly tone: Tone;
    readonly actionLabel: string;
    readonly href: string;
    /** The test id of the line's text, kept from the module card it used to live on. */
    readonly textTestID: string;
    readonly extra?: ReactNode;
}

interface CatalogueLine {
    readonly family: EntityFamily;
    readonly summary: UseQueryResult<{
        readonly total: number | null;
        readonly published?: number | null;
    }>;
}

export function KitchenHomeScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const { width: contentWidth } = useContentWidth();
    const router = useRouter();
    const state = useAccessState();
    const { me } = useSession();
    const families = permittedFamilies(state);

    const permitted = new Set(families.map((family) => family.key));
    const familyByKey = new Map(families.map((family) => [family.key, family]));
    const canViewCatalogue = useCan(CATALOGUE_VIEW_PERMISSION);
    const canSell = useCan(ORDER_CREATE_ON_BEHALF_PERMISSION);
    const canWriteRecipes = useCan(RECIPE_MANAGE_PERMISSION);
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
    const zoneSummary = useZoneSummaryQuery(permitted.has('delivery-zones'));
    const ingredientSummary = useIngredientSummaryQuery(permitted.has('ingredients'));
    const reviewSources = useReviewQueueQuery(permitted.has('review'));
    const lowStock = useLowStockCountQuery(permitted.has('stock'));
    const exceptionsCount = useConsumptionExceptionCountQuery(
        permitted.has('consumption-exceptions'),
    );
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
    const supplyNeedCount = supplyNeeds.data?.count ?? null;

    const open = (href: string) => () => {
        router.push(href as never);
    };
    const figure = (value: number | null) =>
        value === null ? t('kitchen:hub.countUnavailable') : String(value);
    const waitingTone = (value: number | null): Tone =>
        value !== null && value > 0 ? 'warning' : 'ok';

    /* ---------------------------------------------------------------- the greeting */

    const now = new Date();
    const givenName = me?.profile.givenName?.trim() ?? '';
    const name = givenName === '' ? (me?.profile.displayName ?? '') : givenName;
    const context = me?.activeContext ?? null;
    const branchName = me?.memberships
        .find((membership) => membership.id === context?.membershipId)
        ?.branches.find((branch) => branch.id === context?.branchId)?.name;
    const today = formatter.formatDate(now, { dateStyle: 'full' });
    const dateLine =
        branchName === undefined
            ? today
            : t('kitchen:hub.dateLine', { date: today, branch: branchName });

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
                      : t('kitchen:review.waitingCount', { count: total }),
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
                      : t('kitchen:ops.exceptions.unresolvedCount', { count: exceptionCount }),
            tone: waitingTone(exceptionCount),
            actionLabel: t('kitchen:hub.action.fix'),
            href: '/kitchen/consumption-exceptions',
            textTestID: 'kitchen-family-consumption-exceptions-total',
        });
    }
    if (showShortfall) {
        checks.push({
            key: 'requirement-shortfalls',
            count: shortfallCount,
            pending: shortfalls.isPending,
            text: t('kitchen:ops.requirements.shortfallCount', { count: shortfallCount ?? 0 }),
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
                    : t('kitchen:branchHours.cutOffDayCount', { count: withCutOff }),
            // No cut-off on any open day is the thing to fix; any number of them is fine.
            tone: withCutOff === 0 ? 'warning' : 'ok',
            actionLabel: t('kitchen:hub.action.set'),
            href: '/kitchen/branch-operating',
            textTestID: 'kitchen-family-branch-operating-cut-offs',
        });
    }
    const waitingChecks = checks.filter((check) => check.tone === 'warning').length;

    /* ---------------------------------------------------------------- catalogue and buying */

    const catalogueLines: CatalogueLine[] = [];
    const lineFor = (key: string, summary: CatalogueLine['summary']) => {
        const family = familyByKey.get(key);
        if (family !== undefined) catalogueLines.push({ family, summary });
    };
    lineFor('recipes', recipeSummary);
    lineFor('products', productSummary);
    lineFor('plans', planSummary);
    lineFor('delivery-zones', zoneSummary);
    lineFor('ingredients', ingredientSummary);

    const buyingRows: Array<{
        readonly key: string;
        readonly label: string;
        readonly value: number | null;
        readonly pending: boolean;
        readonly tone: Tone;
        readonly href: string;
        readonly testID: string;
    }> = [];
    if (permitted.has('supplyOrders')) {
        buyingRows.push({
            key: 'to-order',
            label: t('kitchen:hub.itemsToOrder'),
            value: supplyNeedCount,
            pending: supplyNeeds.isPending && branchId !== null,
            // A neutral zero is a fully stocked kitchen; only something to order turns amber.
            tone: supplyNeedCount !== null && supplyNeedCount > 0 ? 'warning' : 'ok',
            href: '/kitchen/supply-orders',
            testID: 'kitchen-family-supplyOrders-needs',
        });
    }
    if (showShortfall) {
        buyingRows.push({
            key: 'short',
            label: t('kitchen:hub.kpi.requirementShortfalls'),
            value: shortfallCount,
            pending: shortfalls.isPending,
            tone: waitingTone(shortfallCount),
            href: '/kitchen/order-desk/requirements',
            testID: 'kitchen-home-buying-short',
        });
    }
    if (permitted.has('suppliers')) {
        buyingRows.push({
            key: 'suppliers',
            label: t('kitchen:families.suppliers.name'),
            value: suppliers.data?.length ?? null,
            pending: suppliers.isPending,
            tone: 'neutral',
            href: '/kitchen/suppliers',
            testID: 'kitchen-family-suppliers-total',
        });
    }
    if (operatingBranch !== null) {
        buyingRows.push({
            key: 'open-days',
            label: t('kitchen:hub.openingDays'),
            value: operatingSummary?.openDays ?? null,
            pending: operating.isPending,
            tone: 'neutral',
            href: '/kitchen/branch-operating',
            testID: 'kitchen-family-branch-operating-total',
        });
    }

    /* ---------------------------------------------------------------- go to */

    /** Counts a pill carries: only the ones that are something to act on. */
    const pillCount = (key: string): number | null => {
        if (key === 'review') return reviewQueue?.total ?? null;
        if (key === 'consumption-exceptions') return exceptionCount;
        if (key === 'order-requirements') return shortfallCount;
        return null;
    };
    const wide = contentWidth >= 1000;
    const groupGrid =
        contentWidth >= 1000 ? 'grid-cols-3' : contentWidth >= 640 ? 'grid-cols-2' : 'grid-cols-1';

    return (
        <Gate area="kitchen" requirement={{ anyOf: WORKSPACE_PERMISSIONS }} testID="kitchen-home">
            <Cascade space="md" testID="kitchen-home-screen">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Inline space="sm" align="center" wrap>
                        <Heading level={1} testID="kitchen-home-title">
                            {name === ''
                                ? t('kitchen:hub.title')
                                : t(greetingKey(now.getHours()), { name })}
                        </Heading>
                        <Text tone="secondary" testID="kitchen-home-date">
                            {dateLine}
                        </Text>
                    </Inline>
                    <Inline space="xs" wrap>
                        {canSell ? (
                            <Button
                                testID="kitchen-home-new-sale"
                                size="sm"
                                label={t('kitchen:hub.newSale')}
                                iconStart={<Icon name="plus" size="sm" />}
                                onPress={open('/kitchen/order-desk/sale')}
                            />
                        ) : null}
                        {permitted.has('supplyOrders') ? (
                            <Button
                                testID="kitchen-home-order-supplies"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:hub.orderSupplies')}
                                onPress={open('/kitchen/supply-orders')}
                            />
                        ) : null}
                        {permitted.has('recipes') && canWriteRecipes ? (
                            <Button
                                testID="kitchen-home-new-recipe"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:recipes.create')}
                                onPress={open('/kitchen/recipes/new?kind=preparation')}
                            />
                        ) : null}
                    </Inline>
                </Inline>

                {families.length === 0 ? (
                    <EmptyState
                        testID="kitchen-home-empty"
                        title={t('kitchen:hub.emptyTitle')}
                        body={t('kitchen:hub.emptyBody')}
                    />
                ) : (
                    <>
                        <View testID="kitchen-home-kpis" className="flex-row flex-wrap gap-3">
                            {stats.map(({ key, ...tile }) => (
                                <StatTile key={key} {...tile} />
                            ))}
                        </View>

                        <View className={cx('gap-3', wide ? 'flex-row items-stretch' : 'flex-col')}>
                            {checks.length === 0 ? null : (
                                <Panel
                                    testID="kitchen-home-attention"
                                    title={t('kitchen:hub.attentionTitle')}
                                    grow={1.3}
                                    trailing={
                                        <CountPill
                                            testID="kitchen-home-attention-count"
                                            value={String(waitingChecks)}
                                            tone={waitingChecks > 0 ? 'warning' : 'ok'}
                                        />
                                    }
                                >
                                    {checks.map((check) => (
                                        <PanelRow
                                            key={check.key}
                                            testID={`kitchen-home-attention-${check.key}`}
                                            accessibilityLabel={check.text}
                                            onPress={open(check.href)}
                                        >
                                            {check.pending ? (
                                                <Skeleton
                                                    heightClassName="h-5"
                                                    widthClassName="w-1/2"
                                                />
                                            ) : (
                                                <>
                                                    <CountPill
                                                        value={
                                                            check.count === null
                                                                ? '—'
                                                                : String(check.count)
                                                        }
                                                        tone={check.tone}
                                                    />
                                                    <Text
                                                        testID={check.textTestID}
                                                        numberOfLines={1}
                                                        className="min-w-0 flex-1"
                                                    >
                                                        {check.text}
                                                    </Text>
                                                    {check.extra}
                                                    <Text variant="label" tone="brand">
                                                        {check.actionLabel}
                                                    </Text>
                                                    <Icon
                                                        name="chevronEnd"
                                                        size="sm"
                                                        className="text-content-on-brand-subtle"
                                                    />
                                                </>
                                            )}
                                        </PanelRow>
                                    ))}
                                </Panel>
                            )}

                            {catalogueLines.length === 0 ? null : (
                                <Panel
                                    testID="kitchen-home-catalogue"
                                    title={t('kitchen:nav.groups.catalogue')}
                                    grow={1}
                                    trailing={
                                        <Text variant="caption" tone="secondary">
                                            {t('kitchen:hub.onSaleOfTotal')}
                                        </Text>
                                    }
                                >
                                    {catalogueLines.map(({ family, summary }) => {
                                        const total = summary.data?.total ?? null;
                                        const published = summary.data?.published ?? null;
                                        const share =
                                            total === null || published === null || total === 0
                                                ? null
                                                : Math.min(1, published / total);
                                        return (
                                            <PanelRow
                                                key={family.key}
                                                testID={`kitchen-home-catalogue-${family.key}`}
                                                accessibilityLabel={t(family.nameKey)}
                                                onPress={open(family.href)}
                                            >
                                                <Text numberOfLines={1} className="min-w-0 flex-1">
                                                    {t(family.nameKey)}
                                                </Text>
                                                {summary.isPending ? (
                                                    <Skeleton
                                                        heightClassName="h-4"
                                                        widthClassName="w-16"
                                                    />
                                                ) : (
                                                    <>
                                                        {share === null ? null : (
                                                            <View className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
                                                                <View
                                                                    className="h-full rounded-full bg-surface-brand"
                                                                    // The track is `w-16`: 64px.
                                                                    style={{
                                                                        width: Math.round(
                                                                            share * 64,
                                                                        ),
                                                                    }}
                                                                />
                                                            </View>
                                                        )}
                                                        <Text
                                                            testID={`kitchen-family-${family.key}-total`}
                                                            variant="bodyStrong"
                                                            className="tabular-nums"
                                                        >
                                                            {total === null
                                                                ? t('kitchen:hub.countUnavailable')
                                                                : published === null
                                                                  ? String(total)
                                                                  : `${String(published)}/${String(total)}`}
                                                        </Text>
                                                    </>
                                                )}
                                            </PanelRow>
                                        );
                                    })}
                                </Panel>
                            )}

                            {buyingRows.length === 0 ? null : (
                                <Panel
                                    testID="kitchen-home-buying"
                                    title={t('kitchen:hub.buyingTitle')}
                                    grow={1}
                                >
                                    {buyingRows.map((row) => (
                                        <PanelRow
                                            key={row.key}
                                            testID={`kitchen-home-buying-${row.key}`}
                                            accessibilityLabel={row.label}
                                            onPress={open(row.href)}
                                        >
                                            <Text numberOfLines={1} className="min-w-0 flex-1">
                                                {row.label}
                                            </Text>
                                            {row.pending ? (
                                                <Skeleton
                                                    heightClassName="h-5"
                                                    widthClassName="w-8"
                                                />
                                            ) : (
                                                <CountPill
                                                    testID={row.testID}
                                                    value={
                                                        row.value === null ? '—' : String(row.value)
                                                    }
                                                    tone={row.tone}
                                                />
                                            )}
                                        </PanelRow>
                                    ))}
                                </Panel>
                            )}
                        </View>

                        <Stack space="xs">
                            <Heading level={2}>{t('kitchen:hub.goTo')}</Heading>
                            <View testID="kitchen-home-grid" className={`grid gap-3 ${groupGrid}`}>
                                {ENTITY_GROUPS.map((group) => {
                                    const groupFamilies = families.filter(
                                        (family) => family.group === group,
                                    );
                                    const first = groupFamilies[0];
                                    if (first === undefined) return null;
                                    return (
                                        <Card
                                            key={group}
                                            testID={`kitchen-home-section-${group}`}
                                            padding="sm"
                                            tone="raised"
                                            className="min-w-0 gap-2 border-brand-100"
                                        >
                                            <Inline space="xs" align="center" wrap={false}>
                                                <View className="h-7 w-7 items-center justify-center rounded bg-surface-brand-subtle">
                                                    <Icon
                                                        name={first.icon}
                                                        size="sm"
                                                        className="text-content-on-brand-subtle"
                                                    />
                                                </View>
                                                <Text variant="bodyStrong">
                                                    {t(GROUP_LABEL_KEYS[group])}
                                                </Text>
                                            </Inline>
                                            <View className="flex-row flex-wrap gap-1.5">
                                                {groupFamilies.map((family) => (
                                                    <ModulePill
                                                        key={family.key}
                                                        family={family}
                                                        count={pillCount(family.key)}
                                                    />
                                                ))}
                                            </View>
                                        </Card>
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
