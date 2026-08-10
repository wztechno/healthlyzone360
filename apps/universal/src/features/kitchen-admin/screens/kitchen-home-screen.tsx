import {
    Badge,
    Button,
    Card,
    EmptyState,
    FadeIn,
    Heading,
    Icon,
    Inline,
    PageTransition,
    Skeleton,
    Stack,
    Text,
    useAnimatedNumber,
    useMotion,
} from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { UseQueryResult } from '@tanstack/react-query';

import { Gate } from '../../../access/gate.tsx';
import {
    useAllergenClassesQuery,
    useBranchOperatingQuery,
    useIngredientSummaryQuery,
    useMealSummaryQuery,
    usePlanSummaryQuery,
    usePriceListSummaryQuery,
    useProductSummaryQuery,
    useRecipeSummaryQuery,
    useReviewQueueQuery,
    useZoneSummaryQuery,
} from '../../../data/kitchen-admin-hooks.ts';
import type { PublishedFamilySummary } from '../../../data/kitchen-admin-hooks.ts';
import {
    useConsumptionExceptionCountQuery,
    useLowStockCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { BrandGradient } from '../../../ui/brand-gradient.tsx';
import { operatingDraftsFrom, summariseOperating } from '../delivery-model.ts';
import {
    ENTITY_GROUPS,
    WORKSPACE_PERMISSIONS,
    permittedFamilies,
} from '../entity-registry.ts';
import type { EntityFamily, EntityGroup } from '../entity-registry.ts';
import { buildReviewQueue } from '../review-queue.ts';

/**
 * `/kitchen` — mission-control hub (Mood Board Option 02).
 *
 * KPI strip + review insight band + sectioned module tiles. Counts stay honest: null totals stay
 * unavailable rather than inventing a zero.
 */

function FamilyCardShell({
    family,
    testID,
    children,
}: {
    readonly family: EntityFamily;
    readonly testID: string;
    readonly children: ReactNode;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Card testID={testID} padding="md" tone="raised" className="h-full border-brand-100">
            <Stack space="sm">
                <Inline space="sm" align="center">
                    <Icon name={family.icon} size="md" className="text-brand-600" />
                    <Heading level={3} testID={`${testID}-name`} className="text-brand-600">
                        {t(family.nameKey)}
                    </Heading>
                </Inline>

                <Text
                    tone="secondary"
                    variant="caption"
                    testID={`${testID}-description`}
                    numberOfLines={3}
                >
                    {t(family.descriptionKey)}
                </Text>

                {children}

                <Inline space="sm" wrap>
                    <Button
                        testID={`${testID}-open`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:hub.open', { family: t(family.nameKey) })}
                        onPress={() => {
                            router.push(family.href as never);
                        }}
                    />
                </Inline>
            </Stack>
        </Card>
    );
}

function IngredientsCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const summary = useIngredientSummaryQuery();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {summary.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            summary.data?.total === null || summary.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:hub.itemCount', { count: summary.data.total })
                        }
                    />
                    {summary.data?.drafts === null || summary.data === undefined ? null : (
                        <Badge
                            testID={`${testID}-drafts`}
                            tone="info"
                            label={t('kitchen:hub.draftCount', { count: summary.data.drafts })}
                        />
                    )}
                    {summary.data?.quarantined === null ||
                    summary.data === undefined ||
                    summary.data.quarantined === 0 ? null : (
                        <Badge
                            testID={`${testID}-quarantined`}
                            tone="warning"
                            label={t('kitchen:hub.quarantineCount', {
                                count: summary.data.quarantined,
                            })}
                        />
                    )}
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function PublishedFamilyCard({
    family,
    summary,
}: {
    readonly family: EntityFamily;
    readonly summary: UseQueryResult<PublishedFamilySummary>;
}) {
    const { t } = useTranslation();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {summary.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            summary.data?.total === null || summary.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:hub.itemCount', { count: summary.data.total })
                        }
                    />
                    {summary.data?.published === null || summary.data === undefined ? null : (
                        <Badge
                            testID={`${testID}-published`}
                            tone="success"
                            label={t('kitchen:hub.publishedCount', {
                                count: summary.data.published,
                            })}
                        />
                    )}
                    {summary.data?.drafts === null || summary.data === undefined ? null : (
                        <Badge
                            testID={`${testID}-drafts`}
                            tone="info"
                            label={t('kitchen:hub.draftCount', { count: summary.data.drafts })}
                        />
                    )}
                    {summary.data?.quarantined === null ||
                    summary.data === undefined ||
                    summary.data.quarantined === 0 ? null : (
                        <Badge
                            testID={`${testID}-quarantined`}
                            tone="warning"
                            label={t('kitchen:hub.quarantineCount', {
                                count: summary.data.quarantined,
                            })}
                        />
                    )}
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function BranchOperatingCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const access = useAccessState();
    const branchId = access.branch === undefined ? null : KitchenBranchId.unsafe(access.branch.id);
    const operating = useBranchOperatingQuery(branchId);
    const testID = `kitchen-family-${family.key}`;

    const summary =
        operating.data === undefined
            ? null
            : summariseOperating(operatingDraftsFrom(operating.data));

    return (
        <FamilyCardShell family={family} testID={testID}>
            {operating.isPending && branchId !== null ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            summary === null
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:branchHours.openDayCount', {
                                      count: summary.openDays,
                                  })
                        }
                    />
                    {summary === null ? null : (
                        <Badge
                            testID={`${testID}-cut-offs`}
                            tone={summary.withCutOff === 0 ? 'warning' : 'info'}
                            {...(summary.withCutOff === 0 ? { icon: 'warning' as const } : {})}
                            label={t('kitchen:branchHours.cutOffDayCount', {
                                count: summary.withCutOff,
                            })}
                        />
                    )}
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function ReviewCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const sources = useReviewQueueQuery();
    const testID = `kitchen-family-${family.key}`;

    const data = sources.data;
    const queue = useMemo(
        () =>
            data === undefined
                ? null
                : buildReviewQueue({
                      ingredients: data.ingredients,
                      quarantinedRecipes: data.quarantinedRecipes,
                      staleRecipes: data.staleRecipes,
                      products: data.products,
                      meals: data.meals,
                      plans: data.plans,
                      priceLists: data.priceLists,
                  }),
        [data],
    );

    return (
        <FamilyCardShell family={family} testID={testID}>
            {sources.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone={queue === null || queue.total === 0 ? 'success' : 'warning'}
                        icon={queue === null || queue.total === 0 ? 'check' : 'warning'}
                        label={
                            queue === null
                                ? t('kitchen:hub.countUnavailable')
                                : queue.total === 0
                                  ? t('kitchen:review.clearBadge')
                                  : t('kitchen:review.waitingCount', { count: queue.total })
                        }
                    />
                    {queue === null || queue.blocked === 0 ? null : (
                        <Badge
                            testID={`${testID}-blocked`}
                            tone="danger"
                            icon="warning"
                            label={t('kitchen:review.blockedCount', { count: queue.blocked })}
                        />
                    )}
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function AnalyticsCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            <Inline space="xs" wrap testID={`${testID}-counts`}>
                <Badge
                    testID={`${testID}-sample`}
                    tone="info"
                    icon="info"
                    label={t('kitchen:analytics.sampleBadge')}
                />
            </Inline>
        </FamilyCardShell>
    );
}

function ConsumptionExceptionsCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const count = useConsumptionExceptionCountQuery();
    const testID = `kitchen-family-${family.key}`;
    const value = count.data ?? null;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {count.isPending ? (
                <Skeleton testID={`${testID}-loading`} heightClassName="h-6" widthClassName="w-1/2" />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone={value === null || value === 0 ? 'success' : 'warning'}
                        icon={value === null || value === 0 ? 'check' : 'warning'}
                        label={
                            value === null
                                ? t('kitchen:hub.countUnavailable')
                                : value === 0
                                  ? t('kitchen:ops.exceptions.clearBadge')
                                  : t('kitchen:ops.exceptions.unresolvedCount', { count: value })
                        }
                    />
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function AllergenClassesCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const classes = useAllergenClassesQuery();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {classes.isPending ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone="neutral"
                        icon="dot"
                        label={
                            classes.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:classes.count', { count: classes.data.length })
                        }
                    />
                    <Badge
                        testID={`${testID}-reference`}
                        tone="info"
                        label={t('kitchen:hub.referenceOnly')}
                    />
                </Inline>
            )}
        </FamilyCardShell>
    );
}

function renderFamilyCard(
    family: EntityFamily,
    summaries: {
        readonly recipe: UseQueryResult<PublishedFamilySummary>;
        readonly product: UseQueryResult<PublishedFamilySummary>;
        readonly meal: UseQueryResult<PublishedFamilySummary>;
        readonly priceList: UseQueryResult<PublishedFamilySummary>;
        readonly plan: UseQueryResult<PublishedFamilySummary>;
        readonly zone: UseQueryResult<PublishedFamilySummary>;
    },
): ReactNode {
    if (family.key === 'review') return <ReviewCard key={family.key} family={family} />;
    if (family.key === 'consumption-exceptions') {
        return <ConsumptionExceptionsCard key={family.key} family={family} />;
    }
    if (family.key === 'analytics') {
        return <AnalyticsCard key={family.key} family={family} />;
    }
    if (family.key === 'ingredients') return <IngredientsCard key={family.key} family={family} />;
    if (family.key === 'recipes') {
        return <PublishedFamilyCard key={family.key} family={family} summary={summaries.recipe} />;
    }
    if (family.key === 'products') {
        return <PublishedFamilyCard key={family.key} family={family} summary={summaries.product} />;
    }
    if (family.key === 'meals') {
        return <PublishedFamilyCard key={family.key} family={family} summary={summaries.meal} />;
    }
    if (family.key === 'price-lists') {
        return (
            <PublishedFamilyCard key={family.key} family={family} summary={summaries.priceList} />
        );
    }
    if (family.key === 'plans') {
        return <PublishedFamilyCard key={family.key} family={family} summary={summaries.plan} />;
    }
    if (family.key === 'delivery-zones') {
        return <PublishedFamilyCard key={family.key} family={family} summary={summaries.zone} />;
    }
    if (family.key === 'branch-operating') {
        return <BranchOperatingCard key={family.key} family={family} />;
    }
    if (family.key === 'allergen-classes') {
        return <AllergenClassesCard key={family.key} family={family} />;
    }
    return (
        <FamilyCardShell key={family.key} family={family} testID={`kitchen-family-${family.key}`}>
            {null}
        </FamilyCardShell>
    );
}

function KpiTile({
    testID,
    label,
    value,
    hint,
    pending,
}: {
    readonly testID: string;
    readonly label: string;
    readonly value: number | null;
    readonly hint?: string | undefined;
    readonly pending: boolean;
}) {
    const { t } = useTranslation();
    const animated = useAnimatedNumber(value ?? 0);

    return (
        <View
            testID={testID}
            className="min-h-[96px] min-w-[140px] flex-1 basis-[140px] rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-1"
        >
            {pending ? (
                <Skeleton testID={`${testID}-loading`} heightClassName="h-8" widthClassName="w-1/2" />
            ) : (
                <Text
                    testID={`${testID}-value`}
                    className="font-display text-[25px] font-bold text-content-primary"
                >
                    {value === null ? '—' : String(animated)}
                </Text>
            )}
            <Text tone="secondary" variant="caption" className="mt-0.5">
                {label}
            </Text>
            {hint === undefined ? null : (
                <Text
                    testID={`${testID}-hint`}
                    className="mt-1.5 text-[11.5px] font-bold text-brand-600"
                >
                    {hint}
                </Text>
            )}
            {!pending && value === null ? (
                <Text tone="secondary" variant="caption" className="mt-1">
                    {t('kitchen:hub.countUnavailable')}
                </Text>
            ) : null}
        </View>
    );
}

const GROUP_LABEL_KEYS: Readonly<Record<EntityGroup, string>> = {
    workbench: 'kitchen:nav.groups.workbench',
    catalogue: 'kitchen:nav.groups.catalogue',
    commercial: 'kitchen:nav.groups.commercial',
    operations: 'kitchen:nav.groups.operations',
};

export function KitchenHomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const state = useAccessState();
    const { stagger } = useMotion();
    const families = permittedFamilies(state);

    const permitted = new Set(families.map((family) => family.key));
    const recipeSummary = useRecipeSummaryQuery(permitted.has('recipes'));
    const productSummary = useProductSummaryQuery(permitted.has('products'));
    const mealSummary = useMealSummaryQuery(permitted.has('meals'));
    const priceListSummary = usePriceListSummaryQuery(permitted.has('price-lists'));
    const planSummary = usePlanSummaryQuery(permitted.has('plans'));
    const zoneSummary = useZoneSummaryQuery(permitted.has('delivery-zones'));
    const ingredientSummary = useIngredientSummaryQuery(permitted.has('ingredients'));
    const reviewSources = useReviewQueueQuery(permitted.has('review'));
    const lowStock = useLowStockCountQuery(permitted.has('stock'));
    const exceptionsCount = useConsumptionExceptionCountQuery(
        permitted.has('consumption-exceptions'),
    );

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

    const summaries = {
        recipe: recipeSummary,
        product: productSummary,
        meal: mealSummary,
        priceList: priceListSummary,
        plan: planSummary,
        zone: zoneSummary,
    };

    const draftParts: Array<number | null | undefined> = [];
    if (permitted.has('ingredients')) draftParts.push(ingredientSummary.data?.drafts);
    if (permitted.has('recipes')) draftParts.push(recipeSummary.data?.drafts);
    if (permitted.has('products')) draftParts.push(productSummary.data?.drafts);
    if (permitted.has('meals')) draftParts.push(mealSummary.data?.drafts);
    const knownDrafts = draftParts.filter((part): part is number => typeof part === 'number');
    const draftsPending =
        (permitted.has('ingredients') && ingredientSummary.isPending) ||
        (permitted.has('recipes') && recipeSummary.isPending) ||
        (permitted.has('products') && productSummary.isPending) ||
        (permitted.has('meals') && mealSummary.isPending);
    const draftTotal = draftsPending
        ? null
        : draftParts.length === 0
          ? 0
          : knownDrafts.length === 0
            ? null
            : knownDrafts.reduce((sum, part) => sum + part, 0);

    const publishedMeals = mealSummary.isPending
        ? null
        : (mealSummary.data?.published ?? null);
    const zoneTotal = zoneSummary.isPending ? null : (zoneSummary.data?.total ?? null);
    // Low-stock count for the KPI strip (INV1.3): an operational fact computed from
    // records people created — quantities and the reorder points a manager set — so it
    // carries the green/operational tone (Rule 5 keeps violet for machine-generated
    // content). Only shown when the manager can see stock at all.
    //
    // Clean seam for a later phase: when an email/WhatsApp low-stock alert is built, it
    // reads the same `countLowStockLevels` count (or the per-level `isLow`) this tile shows
    // — there is no stored flag and no job to reconcile with. Nothing is notified now.
    const lowStockCount = permitted.has('stock')
        ? lowStock.isPending
            ? null
            : (lowStock.data ?? null)
        : null;

    // Unresolved consumption-exception count for the KPI strip (INV1.5): an
    // operational fact — how many confirmed sales left the stock figures
    // incomplete — computed from records people created, so it carries the green
    // operational tone the low-stock tile does. Only shown when the manager can
    // see the review surface at all.
    const exceptionCount = permitted.has('consumption-exceptions')
        ? exceptionsCount.isPending
            ? null
            : (exceptionsCount.data ?? null)
        : null;

    return (
        <Gate area="kitchen" requirement={{ anyOf: WORKSPACE_PERMISSIONS }} testID="kitchen-home">
            <PageTransition testID="kitchen-home-screen" transitionKey="kitchen-home">
                <Stack space="lg">
                    <FadeIn delayMs={stagger(0)}>
                        <Stack space="xs">
                            <Heading level={1} testID="kitchen-home-title">
                                {t('kitchen:hub.title')}
                            </Heading>
                            <Text tone="secondary" testID="kitchen-home-subtitle">
                                {t('kitchen:hub.subtitle')}
                            </Text>
                        </Stack>
                    </FadeIn>

                    {families.length === 0 ? (
                        <EmptyState
                            testID="kitchen-home-empty"
                            title={t('kitchen:hub.emptyTitle')}
                            body={t('kitchen:hub.emptyBody')}
                        />
                    ) : (
                        <>
                            <FadeIn delayMs={stagger(1)} testID="kitchen-home-kpis">
                                <View className="flex-row flex-wrap gap-3">
                                    <KpiTile
                                        testID="kitchen-kpi-review"
                                        label={t('kitchen:hub.kpi.needsReview')}
                                        value={reviewQueue?.total ?? null}
                                        pending={reviewSources.isPending}
                                        hint={
                                            reviewQueue !== null && reviewQueue.blocked > 0
                                                ? t('kitchen:review.blockedCount', {
                                                      count: reviewQueue.blocked,
                                                  })
                                                : undefined
                                        }
                                    />
                                    <KpiTile
                                        testID="kitchen-kpi-drafts"
                                        label={t('kitchen:hub.kpi.drafts')}
                                        value={draftTotal}
                                        pending={draftsPending}
                                    />
                                    <KpiTile
                                        testID="kitchen-kpi-meals"
                                        label={t('kitchen:hub.kpi.publishedMeals')}
                                        value={publishedMeals}
                                        pending={mealSummary.isPending}
                                    />
                                    <KpiTile
                                        testID="kitchen-kpi-zones"
                                        label={t('kitchen:hub.kpi.deliveryZones')}
                                        value={zoneTotal}
                                        pending={zoneSummary.isPending}
                                    />
                                    {permitted.has('stock') ? (
                                        <KpiTile
                                            testID="kitchen-kpi-low-stock"
                                            label={t('kitchen:hub.kpi.lowStock')}
                                            value={lowStockCount}
                                            pending={lowStock.isPending}
                                            hint={
                                                lowStockCount !== null && lowStockCount > 0
                                                    ? t('kitchen:ops.stock.lowStockCount', {
                                                          count: lowStockCount,
                                                      })
                                                    : undefined
                                            }
                                        />
                                    ) : null}
                                    {permitted.has('consumption-exceptions') ? (
                                        <KpiTile
                                            testID="kitchen-kpi-consumption-exceptions"
                                            label={t('kitchen:hub.kpi.consumptionExceptions')}
                                            value={exceptionCount}
                                            pending={exceptionsCount.isPending}
                                            hint={
                                                exceptionCount !== null && exceptionCount > 0
                                                    ? t('kitchen:ops.exceptions.unresolvedCount', {
                                                          count: exceptionCount,
                                                      })
                                                    : undefined
                                            }
                                        />
                                    ) : null}
                                </View>
                            </FadeIn>

                            {/*
                              * The review band carries the green sweep, not the violet one. It
                              * counts what is waiting in the review queue — operational fact,
                              * computed from records a person created. Rule 5 keeps violet for
                              * machine-generated content, and a queue length is not that.
                              */}
                            <FadeIn delayMs={stagger(2)} testID="kitchen-home-review-band">
                                {reviewQueue !== null && reviewQueue.total > 0 ? (
                                    <BrandGradient
                                        variant="hero"
                                        testID="kitchen-review-insight"
                                        className="p-5"
                                    >
                                        <Stack space="sm">
                                            <Badge
                                                tone="info"
                                                label={t('kitchen:hub.insightTag')}
                                            />
                                            <Heading level={2} tone="inverse">
                                                {t('kitchen:review.summaryTitle', {
                                                    count: reviewQueue.total,
                                                })}
                                            </Heading>
                                            <Text tone="inverse" className="opacity-95">
                                                {reviewQueue.blocked > 0
                                                    ? t('kitchen:review.summaryBlocked', {
                                                          count: reviewQueue.blocked,
                                                      })
                                                    : t('kitchen:review.summaryUnblocked')}
                                            </Text>
                                            <Inline>
                                                <Button
                                                    testID="kitchen-review-insight-open"
                                                    variant="secondary"
                                                    label={t('kitchen:hub.openReview')}
                                                    onPress={() => {
                                                        router.push('/kitchen/review' as never);
                                                    }}
                                                />
                                            </Inline>
                                        </Stack>
                                    </BrandGradient>
                                ) : (
                                    <Card
                                        testID="kitchen-review-clear"
                                        tone="brand"
                                        padding="md"
                                        className="border-brand-100"
                                    >
                                        <Inline space="sm" align="center" justify="between" wrap>
                                            <Stack space="xs" grow>
                                                <Heading level={3}>
                                                    {t('kitchen:review.clearTitle')}
                                                </Heading>
                                                <Text tone="secondary">
                                                    {t('kitchen:review.clearBody')}
                                                </Text>
                                            </Stack>
                                            <Badge
                                                tone="success"
                                                icon="check"
                                                label={t('kitchen:review.clearBadge')}
                                            />
                                        </Inline>
                                    </Card>
                                )}
                            </FadeIn>

                            <Stack space="lg" testID="kitchen-home-grid">
                                {ENTITY_GROUPS.map((group, groupIndex) => {
                                    const groupFamilies = families.filter(
                                        (family) => family.group === group,
                                    );
                                    if (groupFamilies.length === 0) return null;
                                    return (
                                        <FadeIn
                                            key={group}
                                            delayMs={stagger(groupIndex + 3)}
                                            testID={`kitchen-home-section-${group}`}
                                        >
                                            <Stack space="sm">
                                                <Heading level={2} className="text-brand-600">
                                                    {t(GROUP_LABEL_KEYS[group])}
                                                </Heading>
                                                <View className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                                                    {groupFamilies.map((family) => (
                                                        <View key={family.key} className="min-w-0">
                                                            {renderFamilyCard(family, summaries)}
                                                        </View>
                                                    ))}
                                                </View>
                                            </Stack>
                                        </FadeIn>
                                    );
                                })}
                            </Stack>
                        </>
                    )}
                </Stack>
            </PageTransition>
        </Gate>
    );
}
