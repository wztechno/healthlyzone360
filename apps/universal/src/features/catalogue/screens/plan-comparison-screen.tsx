import { Button, EmptyState, Icon, cx, useBreakpoint } from '@healthy360/design-system';
import type { MealSlot, SubscriptionPlan } from '@healthy360/api-client/contracts';
import { SubscriptionPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { usePlanComparisonQuery } from '../../../data/catalogue-hooks.ts';
import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { withQuery } from '../../../navigation/return-to.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useGoToAuth, useNavigateUp } from '../../../navigation/use-return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { BackPill } from '../../../ui/back-pill.tsx';
import { ShopSwitchTrack } from '../../../ui/shop-switch.tsx';
import { estimatedTotal } from '../../commerce/configurator.ts';
import { configuratorHref } from '../../commerce/configurator-draft.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { listDayPrice } from '../plan-balance.ts';
import { cheapestVariant } from '../plan-catalogue.ts';
import { TINT_FILL, TINT_INK } from '../shelf-tints.ts';
import type { ShelfTint } from '../shelf-tints.ts';

/**
 * `/plans/compare` — two or three plans, side by side, as the accepted board draws them.
 *
 * **The heads are the plans.** A tinted card per plan — picture, name, kitchen, price a day, its
 * shortest run and Choose (its set-up, through sign-in when need be) — beside a 200px label column, and
 * "Add a plan" (back to the list, the selection kept) while there is room for a third. With three, each
 * head can be removed.
 *
 * **Rows in three groups.** Food (calories a day on one kcal scale, what each day holds, the macros a
 * plan publishes), Price (a day, the lengths, the whole shortest run) and Flexibility (skip and pause).
 * "Only differences" dims a row every column answers alike. A row nobody publishes is not drawn; a
 * row where some plan publishes the figure keeps a dash for the others — there the absence is the
 * difference.
 *
 * **Columns carry equal emphasis.** No "recommended" badge, no reordering by price. A comparison
 * that nudges is an advert with a table around it.
 *
 * **"Back to the plans" means back.** `/plans` keeps its compare tray in `?compare=` and its kitchen
 * chip in `?kitchen=`; the comparison is opened with both (`?plans=&kitchen=`) and returns both, by
 * Back when `/plans` is the entry underneath and by opening it with them otherwise. It used to push a
 * bare `/plans`, which emptied the tray the person had just filled (browse-05).
 */

/** The kcal scale every column's band is drawn on, widened when a band reaches past it. */
const SCALE_LOW = 400;
const SCALE_HIGH = 2200;
/** The heads, in turn — the board's three. */
const HEAD_TINTS: readonly ShelfTint[] = ['orange', 'green', 'blue'];
const MAX_COMPARED = 3;
const SLOT_LOOK: Readonly<
    Record<MealSlot, { tint: ShelfTint; icon: 'sun' | 'plate' | 'moon' | 'leaf' }>
> = {
    breakfast: { tint: 'yellow', icon: 'sun' },
    lunch: { tint: 'green', icon: 'plate' },
    dinner: { tint: 'blue', icon: 'moon' },
    snack: { tint: 'orange', icon: 'leaf' },
};

interface Cell {
    /** What is compared — two cells with the same text are "the same" for Only differences. */
    readonly text: string | null;
    readonly sub?: string | undefined;
    /** "Allowed" and the like, drawn as a ticked pill. */
    readonly yes?: boolean | undefined;
    /** The band on the kcal scale, as flex parts. */
    readonly range?:
        { readonly before: number; readonly band: number; readonly after: number } | undefined;
    /** The sittings of a day, as tinted glyphs. */
    readonly sittings?: readonly MealSlot[] | undefined;
}

interface ComparisonRow {
    readonly key: string;
    readonly label: string;
    readonly cell: (plan: SubscriptionPlan) => Cell;
}

interface ComparisonGroup {
    readonly key: string;
    readonly label: string;
    readonly icon: 'plate' | 'basket' | 'refresh';
    readonly rows: readonly ComparisonRow[];
}

/** A closed range as "3" or "2–3"; `null` for an empty set. */
function countRange(formatter: Formatter, t: TFunction, values: readonly number[]): string | null {
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    return min === max
        ? formatter.formatNumber(min)
        : t('catalogue:compare.countRange', {
              min: formatter.formatNumber(min),
              max: formatter.formatNumber(max),
          });
}

/** The widest range across the plan's bands, or `null` when no band publishes one. */
function macroRange(
    formatter: Formatter,
    t: TFunction,
    ranges: readonly ({ readonly min: number; readonly max: number } | null)[],
): string | null {
    const known = ranges.filter(
        (range): range is { readonly min: number; readonly max: number } => range !== null,
    );
    if (known.length === 0) return null;
    return t('catalogue:plan.macroRange', {
        min: formatter.formatNumber(Math.min(...known.map((range) => range.min))),
        max: formatter.formatNumber(Math.max(...known.map((range) => range.max))),
    });
}

export function PlanComparisonScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const navigateUp = useNavigateUp();
    const goToAuth = useGoToAuth();
    const formatter = useFormatter();
    const { atLeast } = useBreakpoint();
    const { phase } = useSession();
    const signedIn = phase !== 'restoring' && phase !== 'anonymous';
    const params = useLocalSearchParams<{ plans?: string; kitchen?: string }>();
    const [onlyDifferences, setOnlyDifferences] = useState(false);

    const planIds = useMemo<readonly SubscriptionPlanId[]>(() => {
        const parameter: string | string[] | undefined = params.plans;
        const raw: string = (Array.isArray(parameter) ? parameter[0] : parameter) ?? '';
        return raw
            .split(',')
            .map((value: string) => SubscriptionPlanId.safeParse(value.trim()))
            .filter((value): value is SubscriptionPlanId => value !== null);
    }, [params.plans]);

    const comparison = usePlanComparisonQuery(planIds);
    const plans = comparison.data ?? [];
    // The same query `/plans` names kitchens with, so it is usually already cached.
    const kitchens = useKitchensQuery({ channels: ['marketplace'], limit: 20 });
    const kitchenNameById = useMemo(() => {
        const map = new Map<string, string>();
        for (const kitchen of kitchens.data?.items ?? []) map.set(String(kitchen.id), kitchen.name);
        return map;
    }, [kitchens.data]);

    const low = Math.min(
        SCALE_LOW,
        ...plans.flatMap((plan) => plan.variants.map((v) => v.energyRange.min)),
    );
    const high = Math.max(
        SCALE_HIGH,
        ...plans.flatMap((plan) => plan.variants.map((v) => v.energyRange.max)),
    );
    const allowed = t('catalogue:compare.allowed');

    const groups: readonly ComparisonGroup[] = [
        {
            key: 'food',
            label: t('catalogue:compare.group.food'),
            icon: 'plate',
            rows: [
                {
                    key: 'energy',
                    label: t('catalogue:compare.row.energyADay'),
                    cell: (plan) => {
                        if (plan.variants.length === 0) return { text: null };
                        const min = Math.min(...plan.variants.map((v) => v.energyRange.min));
                        const max = Math.max(...plan.variants.map((v) => v.energyRange.max));
                        return {
                            text: t('catalogue:plan.kcalBand', {
                                min: formatter.formatNumber(min),
                                max: formatter.formatNumber(max),
                            }),
                            range: {
                                before: Math.max(0, min - low),
                                band: Math.max(1, max - min),
                                after: Math.max(0, high - max),
                            },
                        };
                    },
                },
                {
                    key: 'meals',
                    label: t('catalogue:compare.row.eachDay'),
                    cell: (plan) => {
                        const meals = countRange(
                            formatter,
                            t,
                            plan.variants.map((v) => v.mealsPerDay),
                        );
                        const snacks = countRange(
                            formatter,
                            t,
                            plan.variants.map((v) => v.snacksPerDay),
                        );
                        if (meals === null) return { text: null };
                        const cheapest = cheapestVariant(plan);
                        return {
                            text: t('catalogue:compare.eachDayValue', {
                                meals,
                                snacks: snacks ?? formatter.formatNumber(0),
                            }),
                            sittings: [...(cheapest?.sittings ?? [])]
                                .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))
                                .map((sitting) => sitting.slot),
                        };
                    },
                },
                ...(['protein', 'carbohydrate', 'fat'] as const).map((nutrient) => ({
                    key: nutrient,
                    label: t(`catalogue:compare.row.${nutrient}`),
                    cell: (plan: SubscriptionPlan): Cell => ({
                        text: macroRange(
                            formatter,
                            t,
                            plan.variants.map((v) =>
                                nutrient === 'protein'
                                    ? v.proteinRange
                                    : nutrient === 'carbohydrate'
                                      ? v.carbohydrateRange
                                      : v.fatRange,
                            ),
                        ),
                    }),
                })),
            ],
        },
        {
            key: 'price',
            label: t('catalogue:compare.group.price'),
            icon: 'basket',
            rows: [
                {
                    key: 'day',
                    label: t('catalogue:compare.row.aDay'),
                    cell: (plan) => {
                        const cheapest = cheapestVariant(plan);
                        return {
                            text:
                                cheapest === null
                                    ? null
                                    : formatMoney(formatter, listDayPrice(cheapest)),
                        };
                    },
                },
                {
                    key: 'durations',
                    label: t('catalogue:compare.row.durations'),
                    cell: (plan) => ({
                        text:
                            plan.durations.length === 0
                                ? null
                                : plan.durations
                                      .map((option) =>
                                          t('catalogue:plans.finderDaysValue', {
                                              count: option.days,
                                          }),
                                      )
                                      .join(t('catalogue:common.listSeparator')),
                        sub: (() => {
                            const best = Math.max(
                                0,
                                ...plan.durations.map((option) => option.discountPercent),
                            );
                            return best > 0
                                ? t('catalogue:plan.durationDiscount', {
                                      discount: formatter.formatNumber(best),
                                  })
                                : undefined;
                        })(),
                    }),
                },
                {
                    key: 'run',
                    label: t('catalogue:compare.row.wholeRun'),
                    cell: (plan) => {
                        const option = plan.durations[0];
                        const total =
                            option === undefined
                                ? null
                                : estimatedTotal(cheapestVariant(plan), option);
                        return {
                            text: total === null ? null : formatMoney(formatter, total),
                            sub:
                                option === undefined
                                    ? undefined
                                    : t('catalogue:plans.finderDaysValue', { count: option.days }),
                        };
                    },
                },
            ],
        },
        {
            key: 'flexibility',
            label: t('catalogue:compare.group.flexibility'),
            icon: 'refresh',
            rows: [
                {
                    key: 'skip',
                    label: t('catalogue:plan.ruleSkip'),
                    cell: () => ({ text: allowed, yes: true }),
                },
                {
                    key: 'pause',
                    label: t('catalogue:plan.rulePause'),
                    cell: () => ({ text: allowed, yes: true }),
                },
            ],
        },
    ];

    // `/plans` as the person left it: the selection that opened this page, and their kitchen chip.
    const kitchenParameter: string | string[] | undefined = params.kitchen;
    const plansHref = withQuery('/plans', {
        kitchen: Array.isArray(kitchenParameter) ? kitchenParameter[0] : kitchenParameter,
        compare: planIds.map(String).join(','),
    });
    const backToPlans = () => {
        navigateUp(plansHref);
    };

    const choose = (plan: SubscriptionPlan) => {
        const cheapest = cheapestVariant(plan);
        const href = configuratorHref({
            plan: String(plan.id),
            variant: cheapest === null ? undefined : String(cheapest.id),
        });
        if (signedIn) {
            router.push(href as never);
            return;
        }
        goToAuth('/sign-in', href);
    };

    const remove = (plan: SubscriptionPlan) => {
        router.setParams({
            plans: planIds
                .filter((id) => String(id) !== String(plan.id))
                .map(String)
                .join(','),
        } as never);
    };

    const back = (
        <Button
            testID="plan-comparison-back"
            variant="quiet"
            label={t('catalogue:compare.backToPlans')}
            onPress={backToPlans}
        />
    );

    const wide = atLeast('md');
    const canAdd = plans.length < MAX_COMPARED;

    return (
        <View testID="plan-comparison-screen" className="flex-col pb-10">
            <View
                testID="plan-comparison-header"
                className="flex-row flex-wrap items-center gap-3.5 pt-1"
            >
                <BackPill
                    testID="plan-comparison-crumb-plans"
                    label={t('marketplace:nav.weeklyPlans')}
                    onPress={backToPlans}
                />
                <RNText
                    role="heading"
                    aria-level={1}
                    className="font-display text-3xl font-bold tracking-display text-content-primary text-start"
                >
                    {t('catalogue:compare.title')}
                </RNText>
                {plans.length === 0 ? null : (
                    <View className="h-7 justify-center rounded-full bg-surface-brand-subtle px-3">
                        <RNText
                            testID="plan-comparison-count"
                            className="text-sm font-bold text-content-on-brand-subtle"
                        >
                            {t('catalogue:plans.count', { count: plans.length })}
                        </RNText>
                    </View>
                )}
                {plans.length < 2 ? null : (
                    <Pressable
                        testID="plan-comparison-differences"
                        role="switch"
                        aria-checked={onlyDifferences}
                        accessibilityState={{ checked: onlyDifferences }}
                        onPress={() => {
                            setOnlyDifferences((value) => !value);
                        }}
                        className="ms-auto h-11 flex-row items-center gap-2.5 rounded-full border border-stroke bg-surface-raised pe-3.5 ps-2"
                    >
                        <ShopSwitchTrack checked={onlyDifferences} />
                        <RNText className="text-sm font-semibold text-content-primary">
                            {t('catalogue:compare.onlyDifferences')}
                        </RNText>
                    </Pressable>
                )}
            </View>

            <View className="mt-5">
                {/* An empty selection leaves the query disabled, so it never settles and
                    `QueryStates` would show a skeleton for ever. "Nothing was selected" is not a
                    pending request — it is the answer, and it is rendered as one. */}
                {planIds.length === 0 ? (
                    <EmptyState
                        testID="plan-comparison-empty"
                        title={t('catalogue:compare.emptyTitle')}
                        body={t('catalogue:compare.emptyBody')}
                        actions={back}
                    />
                ) : (
                    <QueryStates
                        query={comparison}
                        isEmpty={plans.length === 0}
                        emptyTitle={t('catalogue:compare.emptyTitle')}
                        emptyBody={t('catalogue:compare.emptyBody')}
                        emptyActions={back}
                        skeletonCount={2}
                        testID="plan-comparison"
                    >
                        <View
                            testID="plan-comparison-table"
                            role="table"
                            aria-label={t('catalogue:compare.caption')}
                            className="flex-col"
                        >
                            {/* The heads: a tinted card per plan, and "Add a plan" while there is room. */}
                            <View
                                testID="plan-comparison-head"
                                role="row"
                                className="flex-row gap-3"
                            >
                                {wide ? <View className="w-[200px]" /> : null}
                                {plans.map((plan, index) => (
                                    <PlanHead
                                        key={plan.id}
                                        plan={plan}
                                        tint={HEAD_TINTS[index % HEAD_TINTS.length] ?? 'green'}
                                        kitchenName={kitchenNameById.get(String(plan.kitchenId))}
                                        onChoose={() => {
                                            choose(plan);
                                        }}
                                        {...(plans.length > 2
                                            ? {
                                                  onRemove: () => {
                                                      remove(plan);
                                                  },
                                              }
                                            : {})}
                                    />
                                ))}
                                {canAdd ? (
                                    <Pressable
                                        testID="plan-comparison-add"
                                        role="button"
                                        accessibilityRole="button"
                                        onPress={backToPlans}
                                        className="min-w-0 flex-1 items-center justify-center gap-2.5 rounded-3xl border-2 border-dashed border-stroke py-6 hover:border-surface-brand hover:bg-surface-brand-subtle"
                                    >
                                        <View className="h-12 w-12 items-center justify-center rounded-full bg-surface-brand-subtle">
                                            <Icon
                                                name="plus"
                                                size="md"
                                                className="text-content-brand"
                                            />
                                        </View>
                                        <RNText className="text-sm font-semibold text-content-brand">
                                            {t('catalogue:compare.addPlan')}
                                        </RNText>
                                    </Pressable>
                                ) : null}
                            </View>

                            {groups.map((group) => {
                                // A row nobody publishes is not drawn: a row of dashes says nothing.
                                const rows = group.rows.filter((row) =>
                                    plans.some((plan) => row.cell(plan).text !== null),
                                );
                                if (rows.length === 0) return null;
                                return (
                                    <View
                                        key={group.key}
                                        testID={`plan-comparison-group-${group.key}`}
                                        className="mt-[22px]"
                                    >
                                        <View className="mb-2 flex-row items-center gap-2 px-1">
                                            <Icon
                                                name={group.icon}
                                                size="sm"
                                                className="text-content-brand"
                                            />
                                            <RNText
                                                role="heading"
                                                aria-level={2}
                                                className="text-base font-bold text-content-primary"
                                            >
                                                {group.label}
                                            </RNText>
                                        </View>
                                        <View className="overflow-hidden rounded-[22px] border border-stroke-subtle bg-surface-raised">
                                            {rows.map((row, index) => {
                                                const cells = plans.map((plan) => row.cell(plan));
                                                const same = cells.every(
                                                    (cell) => cell.text === cells[0]?.text,
                                                );
                                                return (
                                                    <View
                                                        key={row.key}
                                                        testID={`plan-comparison-row-${row.key}`}
                                                        role="row"
                                                        className={cx(
                                                            'min-h-[58px] gap-3 py-2.5 transition duration-normal ease-standard hover:bg-surface-base',
                                                            wide
                                                                ? 'flex-row items-center'
                                                                : 'flex-col',
                                                            index === 0
                                                                ? ''
                                                                : 'border-t border-stroke-subtle',
                                                            onlyDifferences && same
                                                                ? 'opacity-35'
                                                                : '',
                                                        )}
                                                    >
                                                        <View
                                                            role="rowheader"
                                                            className={
                                                                wide
                                                                    ? 'w-[200px] ps-[18px]'
                                                                    : 'ps-4'
                                                            }
                                                        >
                                                            <RNText className="text-sm font-semibold text-content-secondary text-start">
                                                                {row.label}
                                                            </RNText>
                                                        </View>
                                                        <View className="min-w-0 flex-1 flex-row gap-3">
                                                            {plans.map((plan, column) => (
                                                                <CompareCell
                                                                    key={plan.id}
                                                                    testID={`plan-compare-${row.key}-${plan.slug}`}
                                                                    cell={
                                                                        cells[column] ?? {
                                                                            text: null,
                                                                        }
                                                                    }
                                                                />
                                                            ))}
                                                            {canAdd ? (
                                                                <View className="min-w-0 flex-1" />
                                                            ) : null}
                                                        </View>
                                                    </View>
                                                );
                                            })}
                                        </View>
                                    </View>
                                );
                            })}
                        </View>
                    </QueryStates>
                )}
            </View>
        </View>
    );
}

const SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function CompareCell({ cell, testID }: { readonly cell: Cell; readonly testID: string }) {
    const { t } = useTranslation();
    return (
        <View role="cell" className="min-w-0 flex-1 px-4">
            {cell.yes === true ? (
                <View className="h-7 flex-row items-center gap-1.5 self-start rounded-full bg-surface-brand-subtle px-2.5">
                    <Icon name="check" size="sm" className="text-content-on-brand-subtle" />
                    <RNText
                        testID={testID}
                        className="text-sm font-bold text-content-on-brand-subtle"
                    >
                        {cell.text}
                    </RNText>
                </View>
            ) : (
                <RNText
                    testID={testID}
                    className="self-start text-base font-bold tabular-nums text-content-primary text-start"
                >
                    {cell.text ?? t('catalogue:compare.noFigure')}
                </RNText>
            )}
            {cell.sub === undefined ? null : (
                <RNText className="mt-0.5 self-start text-xs font-medium text-content-secondary">
                    {cell.sub}
                </RNText>
            )}
            {cell.range === undefined ? null : (
                <View
                    aria-hidden
                    className="mt-2 h-2 flex-row rounded-full border border-stroke-subtle bg-surface-base"
                >
                    <View style={{ flex: cell.range.before }} />
                    <View
                        style={{ flex: cell.range.band }}
                        className="-my-px rounded-full bg-surface-brand"
                    />
                    <View style={{ flex: cell.range.after }} />
                </View>
            )}
            {cell.sittings === undefined || cell.sittings.length === 0 ? null : (
                <View aria-hidden className="mt-2 flex-row flex-wrap gap-1">
                    {cell.sittings.map((slot, index) => (
                        <View
                            key={`${slot}-${String(index)}`}
                            className={cx(
                                'h-[30px] w-[30px] items-center justify-center rounded-[10px]',
                                TINT_FILL[SLOT_LOOK[slot].tint],
                            )}
                        >
                            <Icon
                                name={SLOT_LOOK[slot].icon}
                                size="sm"
                                className={TINT_INK[SLOT_LOOK[slot].tint]}
                            />
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

/** One column's head: the plan on its tint, its kitchen, its price a day, and Choose. */
function PlanHead({
    plan,
    tint,
    kitchenName,
    onChoose,
    onRemove,
}: {
    readonly plan: SubscriptionPlan;
    readonly tint: ShelfTint;
    readonly kitchenName: string | undefined;
    readonly onChoose: () => void;
    readonly onRemove?: (() => void) | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const cheapest = cheapestVariant(plan);
    const option = plan.durations[0];
    const total = option === undefined ? null : estimatedTotal(cheapest, option);

    return (
        <View
            testID={`plan-comparison-head-${plan.slug}`}
            role="columnheader"
            className={cx(
                'relative min-w-0 flex-1 flex-col overflow-hidden rounded-3xl px-4 pb-3.5 pt-4',
                TINT_FILL[tint],
            )}
        >
            <View
                aria-hidden
                pointerEvents="none"
                className="absolute -end-10 -top-[50px] h-[140px] w-[140px] rounded-full bg-surface-raised opacity-35"
            />
            {onRemove === undefined ? null : (
                <Pressable
                    testID={`plan-comparison-remove-${plan.slug}`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('catalogue:compare.remove', { plan: plan.name })}
                    onPress={onRemove}
                    className="absolute end-2.5 top-2.5 z-10 h-8 w-8 items-center justify-center rounded-[10px] bg-surface-raised/60 hover:bg-surface-raised"
                >
                    <Icon name="close" size="sm" className={TINT_INK[tint]} />
                </Pressable>
            )}
            <View className="h-14 w-14 overflow-hidden rounded-2xl shadow-elevation-2">
                <EntityImage
                    assetId={plan.imagePlaceholderId}
                    variant="card"
                    seed={plan.slug}
                    label={plan.name}
                    decorative
                    flush
                    className="h-full w-full"
                />
            </View>
            <RNText
                numberOfLines={2}
                className="mt-3 font-display text-xl font-bold text-content-primary text-start"
            >
                {plan.name}
            </RNText>
            {kitchenName === undefined ? null : (
                <RNText
                    numberOfLines={1}
                    className={cx('text-xs font-semibold opacity-85 text-start', TINT_INK[tint])}
                >
                    {kitchenName}
                </RNText>
            )}
            {cheapest === null ? null : (
                <View className="mb-0.5 mt-3 flex-row flex-wrap items-baseline gap-1">
                    <RNText
                        testID={`plan-compare-price-${plan.slug}`}
                        className="font-display text-3xl font-bold tabular-nums text-content-primary"
                    >
                        {formatMoney(formatter, listDayPrice(cheapest))}
                    </RNText>
                    <RNText className="text-sm font-semibold text-content-secondary">
                        {t('catalogue:plans.aDay')}
                    </RNText>
                </View>
            )}
            {option === undefined ? null : (
                <RNText className="mb-3 text-xs font-semibold tabular-nums text-content-secondary text-start">
                    {total === null
                        ? t('catalogue:plans.finderDaysValue', { count: option.days })
                        : t('catalogue:compare.runValue', {
                              days: t('catalogue:plans.finderDaysValue', { count: option.days }),
                              total: formatMoney(formatter, total),
                          })}
                </RNText>
            )}
            <Pressable
                testID={`plan-comparison-open-${plan.slug}`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('catalogue:plans.choosePlan', { plan: plan.name })}
                onPress={onChoose}
                className="mt-auto h-[46px] flex-row items-center justify-between rounded-2xl bg-surface-brand px-4 hover:bg-surface-canopy"
            >
                <RNText className="text-base font-bold text-content-on-brand">
                    {t('catalogue:plans.choosePlanShort')}
                </RNText>
                <View className="h-7 w-7 items-center justify-center rounded-full bg-content-on-brand/20">
                    <Icon name="chevronForward" size="sm" className="text-content-on-brand" />
                </View>
            </Pressable>
        </View>
    );
}
