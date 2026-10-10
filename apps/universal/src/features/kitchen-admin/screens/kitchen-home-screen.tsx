import {
    Badge,
    Button,
    Cascade,
    Card,
    EmptyState,
    Heading,
    Icon,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { KitchenBranchId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { UseQueryResult } from '@tanstack/react-query';

import { Gate, useCan } from '../../../access/gate.tsx';
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
    useSuppliersQuery,
    useSupplyNeedsCountQuery,
} from '../../../data/kitchen-ops-hooks.ts';
import { useOrderDeskShortfallCountQuery } from '../../../data/order-desk-hooks.ts';
import { useAccessState } from '../../../session/session-provider.tsx';
import { operatingDraftsFrom, summariseOperating } from '../delivery-model.ts';
import {
    CATALOGUE_VIEW_PERMISSION,
    ENTITY_GROUPS,
    WORKSPACE_PERMISSIONS,
    permittedFamilies,
} from '../entity-registry.ts';
import type { EntityFamily, EntityGroup } from '../entity-registry.ts';
import { CatalogueStatCards } from '../catalogue/catalogue-stat-cards.tsx';
import type { CatalogueStatCard } from '../catalogue/catalogue-stat-cards.tsx';
import { buildReviewQueue } from '../review-queue.ts';

/**
 * `/kitchen` — the overview: what needs someone today, then every module one press away.
 *
 * Figures as pressable stat cards, a "Needs attention" panel listing only what is waiting, and the
 * modules as compact tiles — icon, name, counts. No descriptions and no "Open …" buttons: the rail
 * names every module already. Counts stay honest: null totals stay unavailable, never a zero.
 */

/**
 * One module on the overview: its icon, its name and its figures, the whole tile one target.
 *
 * No description and no "Open …" button. The rail already names every module, so a tile that
 * explained itself in three lines and then repeated its name on a button was most of the page's
 * text and none of its news. What a tile says is the module and its numbers; pressing it opens it.
 *
 * The outer box keeps `kitchen-family-{key}` for the module and the pressable card carries
 * `-open`, the id the old button had, so a test that opened a module still finds the same target.
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
    const name = t(family.nameKey);

    return (
        <View testID={testID} className="grow flex-col self-stretch">
            <Card
                testID={`${testID}-open`}
                padding="sm"
                tone="raised"
                interactive
                accessibilityLabel={name}
                onPress={() => {
                    router.push(family.href as never);
                }}
                className="grow border-brand-100"
            >
                <Stack space="xs" grow>
                    <Inline space="xs" align="center" wrap={false}>
                        <Icon name={family.icon} size="md" className="text-brand-600" />
                        <Text
                            variant="label"
                            testID={`${testID}-name`}
                            numberOfLines={1}
                            className="min-w-0 flex-1 text-brand-600"
                        >
                            {name}
                        </Text>
                        <Icon name="chevronEnd" size="sm" className="text-content-secondary" />
                    </Inline>
                    {children}
                </Stack>
            </Card>
        </View>
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
                            {...(summary.withCutOff === 0 ? { icon: 'alert' as const } : {})}
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
                        icon={queue === null || queue.total === 0 ? 'circleCheck' : 'alert'}
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
                            icon="alert"
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
                    icon="infoCircle"
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
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-total`}
                        tone={value === null || value === 0 ? 'success' : 'warning'}
                        icon={value === null || value === 0 ? 'circleCheck' : 'alert'}
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

/**
 * The supplier book's card (SUP1) — a plain count of who this kitchen buys from.
 *
 * Counted from the live book rather than the whole table: the list this card leads to excludes
 * archived suppliers by default, and a badge that counted them would disagree with the screen it
 * opens. `useSuppliersQuery()` with no filter is exactly that book.
 */
function SuppliersCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const suppliers = useSuppliersQuery();
    const testID = `kitchen-family-${family.key}`;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {suppliers.isPending ? (
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
                            suppliers.data === undefined
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:ops.suppliers.supplierCount', {
                                      count: suppliers.data.length,
                                  })
                        }
                    />
                </Inline>
            )}
        </FamilyCardShell>
    );
}

/**
 * The supply-orders card (SUP3) — how many shelves are waiting to be ordered.
 *
 * Branch-shaped, unlike every other card on this hub. A proposal is always for one site, so a
 * manager holding an organisation-wide membership gets the card without a number rather than a
 * number that summed three kitchens' shortages into one meaningless total.
 *
 * The badge turns `warning` only when there is something to do. A neutral zero is a fully stocked
 * kitchen and reads as reassurance; a warning zero would train people to ignore the colour.
 */
function SupplyOrdersCard({ family }: { readonly family: EntityFamily }) {
    const { t } = useTranslation();
    const access = useAccessState();
    const branchId = access.branch?.id ?? null;
    const needs = useSupplyNeedsCountQuery(branchId);
    const testID = `kitchen-family-${family.key}`;
    const count = needs.data?.count ?? null;

    return (
        <FamilyCardShell family={family} testID={testID}>
            {needs.isPending && branchId !== null ? (
                <Skeleton
                    testID={`${testID}-loading`}
                    heightClassName="h-6"
                    widthClassName="w-1/2"
                />
            ) : (
                <Inline space="xs" wrap testID={`${testID}-counts`}>
                    <Badge
                        testID={`${testID}-needs`}
                        tone={count !== null && count > 0 ? 'warning' : 'neutral'}
                        icon="dot"
                        label={
                            count === null
                                ? t('kitchen:hub.countUnavailable')
                                : t('kitchen:ops.supplyOrders.needsCount', { count })
                        }
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
    if (family.key === 'suppliers') {
        return <SuppliersCard key={family.key} family={family} />;
    }
    if (family.key === 'supplyOrders') {
        return <SupplyOrdersCard key={family.key} family={family} />;
    }
    return (
        <FamilyCardShell key={family.key} family={family} testID={`kitchen-family-${family.key}`}>
            {null}
        </FamilyCardShell>
    );
}

interface AttentionRow {
    readonly key: string;
    /** One sentence with its count — "4 records are waiting for review". */
    readonly text: string;
    readonly tone: 'warning' | 'danger';
    readonly href: string;
    /** The page the row opens, named on its link. */
    readonly linkLabel: string;
}

/**
 * What needs someone today: one line per non-zero alert, each opening the page that clears it.
 *
 * It replaced a full-width gradient band that spent a heading, a paragraph, a tag and a button on
 * the review count alone. Every alert now gets one line of the same weight, and when nothing is
 * waiting the panel says so once instead of drawing a row of zeros.
 */
function AttentionPanel({
    rows,
    pending,
}: {
    readonly rows: readonly AttentionRow[];
    /** An alert's count is still in flight: "all clear" would be a guess until every one lands. */
    readonly pending: boolean;
}) {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Card
            testID="kitchen-home-attention"
            tone="raised"
            padding="md"
            className="border-brand-100"
        >
            <Stack space="sm">
                <Heading level={2}>{t('kitchen:hub.attentionTitle')}</Heading>
                {rows.length === 0 && pending ? (
                    <Skeleton
                        testID="kitchen-home-attention-loading"
                        heightClassName="h-5"
                        widthClassName="w-1/2"
                    />
                ) : rows.length === 0 ? (
                    <Inline space="xs" align="center" testID="kitchen-home-attention-clear">
                        <Icon name="circleCheck" size="sm" className="text-success-strong" />
                        <Text tone="secondary">{t('kitchen:hub.attentionClear')}</Text>
                    </Inline>
                ) : (
                    rows.map((row) => (
                        <Inline
                            key={row.key}
                            space="sm"
                            align="center"
                            justify="between"
                            wrap
                            testID={`kitchen-home-attention-${row.key}`}
                        >
                            <Inline
                                space="xs"
                                align="center"
                                wrap={false}
                                className="min-w-0 flex-1"
                            >
                                <Icon
                                    name="alert"
                                    size="sm"
                                    className={
                                        row.tone === 'danger'
                                            ? 'text-danger-strong'
                                            : 'text-warning-strong'
                                    }
                                />
                                <Text className="min-w-0 flex-1">{row.text}</Text>
                            </Inline>
                            <Button
                                testID={`kitchen-home-attention-${row.key}-open`}
                                variant="ghost"
                                size="sm"
                                label={row.linkLabel}
                                iconEnd={<Icon name="chevronEnd" size="sm" />}
                                onPress={() => {
                                    router.push(row.href as never);
                                }}
                            />
                        </Inline>
                    ))
                )}
            </Stack>
        </Card>
    );
}

const GROUP_LABEL_KEYS: Readonly<Record<EntityGroup, string>> = {
    orderDesk: 'kitchen:nav.groups.orderDesk',
    workbench: 'kitchen:nav.groups.workbench',
    catalogue: 'kitchen:nav.groups.catalogue',
    commercial: 'kitchen:nav.groups.commercial',
    operations: 'kitchen:nav.groups.operations',
    access: 'kitchen:nav.groups.access',
};

export function KitchenHomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const state = useAccessState();
    const families = permittedFamilies(state);

    const permitted = new Set(families.map((family) => family.key));
    const canViewCatalogue = useCan(CATALOGUE_VIEW_PERMISSION);
    // The recipe card counts what is on sale as published — the menu's question, not the recipe's.
    const recipeSummary = useRecipeSummaryQuery(permitted.has('recipes'), canViewCatalogue);
    const productSummary = useProductSummaryQuery(permitted.has('products'));
    /*
     * The Drafts and Published-meals tiles still count sauces, dressings and meals as items. Their
     * families went into the recipe book, so these reads are keyed on the code that lists the items
     * rather than on a family that no longer exists — keyed on the family, they would never load.
     */
    const sauceSummary = useProductSummaryQuery(canViewCatalogue, 'sauce');
    const dressingSummary = useProductSummaryQuery(canViewCatalogue, 'dressing');
    const mealSummary = useMealSummaryQuery(canViewCatalogue);
    const priceListSummary = usePriceListSummaryQuery(permitted.has('price-lists'));
    const planSummary = usePlanSummaryQuery(permitted.has('plans'));
    const zoneSummary = useZoneSummaryQuery(permitted.has('delivery-zones'));
    const ingredientSummary = useIngredientSummaryQuery(permitted.has('ingredients'));
    const reviewSources = useReviewQueueQuery(permitted.has('review'));
    const lowStock = useLowStockCountQuery(permitted.has('stock'));
    const exceptionsCount = useConsumptionExceptionCountQuery(
        permitted.has('consumption-exceptions'),
    );
    // The buy list's badge. Asked with the workspace's active branch, which may be null — the
    // endpoint answers rather than refuses, and what comes back for a manager who holds no branch
    // is `count: null`. See the tile below for what that renders as.
    const shortfalls = useOrderDeskShortfallCountQuery(
        state.branch?.id ?? null,
        permitted.has('order-requirements'),
    );
    // SUP3. Not a second count — the low-stock tile keeps its own endpoint — only whether the
    // person reading the tile is the person who could act on it.
    const canOrderSupplies = permitted.has('supplyOrders');

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
        priceList: priceListSummary,
        plan: planSummary,
        zone: zoneSummary,
    };

    const draftParts: Array<number | null | undefined> = [];
    if (permitted.has('ingredients')) draftParts.push(ingredientSummary.data?.drafts);
    if (permitted.has('recipes')) draftParts.push(recipeSummary.data?.drafts);
    if (permitted.has('products')) draftParts.push(productSummary.data?.drafts);
    if (canViewCatalogue) {
        draftParts.push(
            sauceSummary.data?.drafts,
            dressingSummary.data?.drafts,
            mealSummary.data?.drafts,
        );
    }
    const knownDrafts = draftParts.filter((part): part is number => typeof part === 'number');
    const draftsPending =
        (permitted.has('ingredients') && ingredientSummary.isPending) ||
        (permitted.has('recipes') && recipeSummary.isPending) ||
        (permitted.has('products') && productSummary.isPending) ||
        (canViewCatalogue && mealSummary.isPending);
    const draftTotal = draftsPending
        ? null
        : draftParts.length === 0
          ? 0
          : knownDrafts.length === 0
            ? null
            : knownDrafts.reduce((sum, part) => sum + part, 0);

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

    /**
     * How many ingredients the next seven days are short of at the active branch (C5).
     *
     * Three-way, like the two tiles beside it — but with a fourth state those two cannot have.
     * `shortfall_count` comes back **null** when no branch is selected, because availability is a
     * quantity on one shelf and there is no organisation-wide shelf to count against. That is not a
     * zero: zero shortfalls is good news, and not knowing is not news at all.
     *
     * So a null count **renders nothing at all** rather than a dashed tile — the em-dash rule
     * applied to a badge, where there is no room for the character itself. A tile permanently
     * showing "—" to a manager whose membership is organisation-wide is furniture: they will never
     * see a number there until they select a branch, and a KPI strip that carries a blank for them
     * on every visit teaches people to stop reading it. Pending is different and still shows the
     * tile, because a number is coming.
     */
    const shortfallCount = permitted.has('order-requirements')
        ? shortfalls.isPending
            ? null
            : (shortfalls.data?.count ?? null)
        : null;
    const showShortfallTile =
        permitted.has('order-requirements') && (shortfalls.isPending || shortfallCount !== null);

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

    const open = (href: string) => () => {
        router.push(href as never);
    };
    const figure = (value: number | null) =>
        value === null ? t('kitchen:hub.countUnavailable') : String(value);
    const warnWhen = (value: number | null) =>
        value !== null && value > 0 ? ('warning' as const) : ('default' as const);

    /*
     * The figures, as the same pressable cards every list page opens with. No hint lines: the label
     * says what the number counts, and the attention panel below says what to do about it.
     */
    const kpiCards: CatalogueStatCard[] = [];
    if (permitted.has('review')) {
        kpiCards.push({
            key: 'review',
            label: t('kitchen:hub.kpi.needsReview'),
            value: figure(reviewQueue?.total ?? null),
            pending: reviewSources.isPending,
            mark: 'clipboardCheck',
            tone: warnWhen(reviewQueue?.total ?? null),
            onPress: open('/kitchen/review'),
            accessibilityLabel: t('kitchen:hub.kpi.needsReview'),
        });
    }
    if (permitted.has('consumption-exceptions')) {
        kpiCards.push({
            key: 'consumption-exceptions',
            label: t('kitchen:hub.kpi.consumptionExceptions'),
            value: figure(exceptionCount),
            pending: exceptionsCount.isPending,
            mark: 'alert',
            tone: warnWhen(exceptionCount),
            onPress: open('/kitchen/consumption-exceptions'),
            accessibilityLabel: t('kitchen:hub.kpi.consumptionExceptions'),
        });
    }
    if (permitted.has('stock')) {
        kpiCards.push({
            key: 'low-stock',
            label: t('kitchen:hub.kpi.lowStock'),
            value: figure(lowStockCount),
            pending: lowStock.isPending,
            mark: 'package',
            tone: warnWhen(lowStockCount),
            onPress: open('/kitchen/stock'),
            accessibilityLabel: t('kitchen:hub.kpi.lowStock'),
        });
    }
    if (showShortfallTile) {
        kpiCards.push({
            key: 'requirement-shortfalls',
            label: t('kitchen:hub.kpi.requirementShortfalls'),
            value: figure(shortfallCount),
            pending: shortfalls.isPending,
            mark: 'receipt',
            tone: warnWhen(shortfallCount),
            onPress: open('/kitchen/order-desk/requirements'),
            accessibilityLabel: t('kitchen:hub.kpi.requirementShortfalls'),
        });
    }
    kpiCards.push({
        key: 'drafts',
        label: t('kitchen:hub.kpi.drafts'),
        value: figure(draftTotal),
        pending: draftsPending,
        mark: 'fileDraft',
        tone: 'brand',
    });

    /*
     * One line per thing waiting on someone, only when it is waiting. A count of nothing is not
     * news, so the panel shrinks to a single "all clear" rather than listing four zeros.
     */
    const attention: AttentionRow[] = [];
    if (reviewQueue !== null && reviewQueue.total > 0) {
        attention.push({
            key: 'review',
            text: t('kitchen:review.summaryTitle', { count: reviewQueue.total }),
            tone: reviewQueue.blocked > 0 ? 'danger' : 'warning',
            href: '/kitchen/review',
            linkLabel: t('kitchen:hub.kpi.needsReview'),
        });
    }
    if (exceptionCount !== null && exceptionCount > 0) {
        attention.push({
            key: 'consumption-exceptions',
            text: t('kitchen:ops.exceptions.unresolvedCount', { count: exceptionCount }),
            tone: 'warning',
            href: '/kitchen/consumption-exceptions',
            linkLabel: t('kitchen:hub.kpi.consumptionExceptions'),
        });
    }
    if (lowStockCount !== null && lowStockCount > 0) {
        attention.push({
            key: 'low-stock',
            text: canOrderSupplies
                ? t('kitchen:hub.kpi.lowStockReadyToOrder', { count: lowStockCount })
                : t('kitchen:ops.stock.lowStockCount', { count: lowStockCount }),
            tone: 'warning',
            href: canOrderSupplies ? '/kitchen/supply-orders' : '/kitchen/stock',
            linkLabel: t('kitchen:hub.kpi.lowStock'),
        });
    }
    if (shortfallCount !== null && shortfallCount > 0) {
        attention.push({
            key: 'requirement-shortfalls',
            text: t('kitchen:ops.requirements.shortfallCount', { count: shortfallCount }),
            tone: 'warning',
            href: '/kitchen/order-desk/requirements',
            linkLabel: t('kitchen:hub.kpi.requirementShortfalls'),
        });
    }

    return (
        <Gate area="kitchen" requirement={{ anyOf: WORKSPACE_PERMISSIONS }} testID="kitchen-home">
            <Cascade space="lg" testID="kitchen-home-screen">
                <Heading level={1} testID="kitchen-home-title">
                    {t('kitchen:hub.title')}
                </Heading>

                {families.length === 0 ? (
                    <EmptyState
                        testID="kitchen-home-empty"
                        title={t('kitchen:hub.emptyTitle')}
                        body={t('kitchen:hub.emptyBody')}
                    />
                ) : (
                    <>
                        <View testID="kitchen-home-kpis">
                            <CatalogueStatCards
                                testID="kitchen-kpi"
                                pending={false}
                                cards={kpiCards}
                            />
                        </View>

                        <AttentionPanel
                            rows={attention}
                            pending={
                                (permitted.has('review') && reviewSources.isPending) ||
                                (permitted.has('consumption-exceptions') &&
                                    exceptionsCount.isPending) ||
                                (permitted.has('stock') && lowStock.isPending) ||
                                (showShortfallTile && shortfalls.isPending)
                            }
                        />

                        {/* A cascade of its own: the groups continue the page's count. */}
                        <Cascade space="lg" testID="kitchen-home-grid">
                            {ENTITY_GROUPS.map((group) => {
                                const groupFamilies = families.filter(
                                    (family) => family.group === group,
                                );
                                if (groupFamilies.length === 0) return null;
                                return (
                                    <Stack
                                        key={group}
                                        space="sm"
                                        testID={`kitchen-home-section-${group}`}
                                    >
                                        <Heading level={3} className="text-content-secondary">
                                            {t(GROUP_LABEL_KEYS[group])}
                                        </Heading>
                                        <View className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                                            {groupFamilies.map((family) => (
                                                <View key={family.key} className="min-w-0">
                                                    {renderFamilyCard(family, summaries)}
                                                </View>
                                            ))}
                                        </View>
                                    </Stack>
                                );
                            })}
                        </Cascade>
                    </>
                )}
            </Cascade>
        </Gate>
    );
}
