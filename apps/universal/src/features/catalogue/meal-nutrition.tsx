import { Icon, InfoTip, cx } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount, precisionFor } from '@healthy360/nutrition';
import type { MacroNutrientId, NutritionFacts } from '@healthy360/nutrition';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { macroBreakdown, orderedNutrientIds, per100gFacts } from './format.ts';
import { MACRO_DISTRIBUTION_RANGES } from './macro-rings.tsx';
import { TINT_FILL, TINT_INK, TINT_INK_FILL } from './shelf-tints.ts';
import type { ShelfTint } from './shelf-tints.ts';

/**
 * The meal page's nutrition facts (Shop · Meal, nutrition board, pins 1–6):
 *
 * 1. The basis is a switch on the heading line — Per serving / Per 100 g. A listing sold by weight
 *    has no serving, so it gets one "Per 100 g" chip whose (i) says why, and no switch.
 * 2. Energy leads, big, over one bar of where it comes from: protein, carbohydrate and fat as
 *    shares of the energy, worked out from the grams the facts carry.
 * 3. The three macros as tiles in the hero rings' colours — grams, kcal and share, a Low / High tag
 *    when the share is outside the published range, and what sits inside each (sugars inside
 *    carbohydrate, saturated fat inside fat).
 * 4. Everything else in a short list.
 * 5. Provenance in plain words — what the figures were worked out from, when, which data version —
 *    with the method, rounding and calculation notes behind "Technical details". It is still on
 *    every panel, and a synthetic figure is still labelled synthetic: provenance is not decoration.
 * 6. "How it compares": each macro's share on a track with the published range shaded.
 *
 * Per 100 g is derived from the mass the facts carry; when that mass is unknown the switch says so
 * rather than inventing a density.
 */
export interface MealNutritionProps {
    readonly facts: NutritionFacts;
    /** The section's heading, drawn on the switch's line. */
    readonly heading: ReactNode;
    /** What one serving is, under the heading; `null` prints nothing. */
    readonly serving?: ReactNode;
    readonly testID: string;
}

type Basis = 'per_serving' | 'per_100g';

const MACROS: readonly MacroNutrientId[] = ['protein', 'carbohydrate', 'fat'];

/** Each macro wears the colour the hero rings give it. */
const MACRO_TINT: Readonly<Record<MacroNutrientId, ShelfTint>> = {
    protein: 'green',
    carbohydrate: 'blue',
    fat: 'yellow',
};

/** What sits inside a macro — fats inside fat, sugars and starch inside carbohydrate. */
const INSIDE: Readonly<Record<string, MacroNutrientId>> = {
    saturated_fat: 'fat',
    monounsaturated_fat: 'fat',
    polyunsaturated_fat: 'fat',
    trans_fat: 'fat',
    sugars: 'carbohydrate',
    added_sugars: 'carbohydrate',
    starch: 'carbohydrate',
};

const SOURCE_KINDS = new Set([
    'ingredient_derived',
    'laboratory',
    'manufacturer',
    'professional_entry',
]);

/** True when `value` can be passed to `formatDate` without throwing. */
function isRenderableTimestamp(value: string): boolean {
    return value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function MealNutrition({ facts, heading, serving = null, testID }: MealNutritionProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [basis, setBasis] = useState<Basis>('per_serving');
    const [technical, setTechnical] = useState(false);

    // Already the comparison basis: one view, no re-basing.
    const fixedPer100g = facts.basis === 'per_100g';
    const per100g = fixedPer100g ? null : per100gFacts(facts);
    const unavailable = basis === 'per_100g' && per100g === null;
    const active = basis === 'per_100g' && per100g !== null ? per100g : facts;

    const basisLabel =
        fixedPer100g || (basis === 'per_100g' && per100g !== null)
            ? t('catalogue:facts.per100g')
            : t('catalogue:facts.perServing');

    const nameOf = (nutrientId: string) =>
        t(`marketplace:nutrients.${nutrientId}`, {
            defaultValue: coreNutrientDefinition(nutrientId)?.displayName ?? nutrientId,
        });
    const numberOf = (nutrientId: string) => {
        const amount = findAmount(active, nutrientId);
        return {
            value: formatter.formatNumber(amount === null ? 0 : amount.value, {
                minimumFractionDigits: 0,
                maximumFractionDigits: precisionFor(nutrientId),
            }),
            unit: amount?.unit ?? '',
        };
    };
    const amountOf = (nutrientId: string) => {
        const { value, unit } = numberOf(nutrientId);
        return `${value} ${unit}`.trim();
    };

    const present = orderedNutrientIds(active);
    const shares = macroBreakdown(active);
    const shareOf = (nutrientId: MacroNutrientId) =>
        shares.find((share) => share.nutrientId === nutrientId);
    const macroKcal = shares.reduce((sum, share) => sum + share.kilocalories, 0);
    const inside = (macro: MacroNutrientId) =>
        present.filter((nutrientId) => INSIDE[nutrientId] === macro);
    const rest = present.filter(
        (nutrientId) =>
            nutrientId !== 'energy' &&
            !(MACROS as readonly string[]).includes(nutrientId) &&
            INSIDE[nutrientId] === undefined,
    );

    const toggle = (value: Basis, label: string, disabled: boolean) => {
        const on = basis === value;
        return (
            <Pressable
                key={value}
                testID={`${testID}-basis-${value === 'per_serving' ? 'per-serving' : 'per-100g'}`}
                role="tab"
                aria-selected={on}
                accessibilityState={{ selected: on, disabled }}
                disabled={disabled}
                onPress={() => {
                    setBasis(value);
                }}
                className={cx(
                    'h-9 items-center justify-center rounded-full px-4 transition duration-normal ease-standard',
                    on ? 'bg-surface-raised shadow-elevation-2' : 'hover:bg-surface-raised',
                    disabled ? 'opacity-40' : '',
                )}
            >
                <RNText
                    className={cx(
                        'text-sm font-semibold',
                        on ? 'text-content-primary' : 'text-content-secondary',
                    )}
                >
                    {label}
                </RNText>
            </Pressable>
        );
    };

    const sourceKind = active.source.kind;
    const workedOutFrom = SOURCE_KINDS.has(sourceKind)
        ? t(`catalogue:facts.sourceKind.${sourceKind}`)
        : active.source.label;

    return (
        <View testID={testID} className="flex-col gap-[18px]">
            {/* ── 1 · the heading and the basis ─────────────────────────────────────────────── */}
            <View className="flex-col gap-1.5">
                <View className="flex-row flex-wrap items-center justify-between gap-3">
                    {heading}
                    {fixedPer100g ? (
                        <View
                            testID={`${testID}-sold-by-weight`}
                            className="h-9 flex-row items-center gap-1.5 rounded-full bg-surface-brand-subtle pe-2 ps-3.5"
                        >
                            <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                                {t('catalogue:facts.per100g')}
                            </RNText>
                            <InfoTip
                                label={t('catalogue:facts.per100g')}
                                text={t('catalogue:facts.soldByWeight')}
                            />
                        </View>
                    ) : (
                        <View
                            testID={`${testID}-basis`}
                            role="tablist"
                            aria-label={t('catalogue:facts.basisLabel')}
                            className="flex-row gap-0.5 rounded-full border border-stroke-subtle bg-surface-sunken p-1"
                        >
                            {toggle('per_serving', t('catalogue:facts.perServing'), false)}
                            {toggle('per_100g', t('catalogue:facts.per100g'), per100g === null)}
                        </View>
                    )}
                </View>
                {serving}
            </View>

            <View className="flex-col gap-4 lg:flex-row lg:items-start">
                {/* ── 2–4 · the figures ─────────────────────────────────────────────────────── */}
                <View className="flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-5 lg:flex-[1.65] lg:p-[22px]">
                    {unavailable ? (
                        <RNText
                            testID={`${testID}-per-100g-unavailable`}
                            className="text-sm text-content-secondary text-start"
                        >
                            {t('catalogue:facts.per100gUnavailable')}
                        </RNText>
                    ) : (
                        <View testID={`${testID}-table`} className="flex-col">
                            {/* Energy */}
                            <View className="flex-row items-baseline gap-1.5">
                                <RNText
                                    testID={`${testID}-amount-energy`}
                                    className="font-display text-5xl font-bold tracking-display tabular-nums text-content-primary"
                                >
                                    {numberOf('energy').value}
                                </RNText>
                                <RNText className="text-base font-semibold text-content-secondary">
                                    {numberOf('energy').unit}
                                </RNText>
                            </View>
                            <RNText
                                testID={`${testID}-table-caption`}
                                className="mt-1 text-sm font-semibold text-content-secondary text-start"
                            >
                                {basisLabel}
                            </RNText>

                            {/* Where the energy comes from */}
                            {macroKcal <= 0 ? null : (
                                <View testID={`${testID}-split`} className="mt-[18px] flex-col">
                                    <RNText className="mb-2 text-sm font-semibold text-content-secondary text-start">
                                        {t('catalogue:facts.energyFrom')}
                                    </RNText>
                                    <View
                                        aria-hidden
                                        className="h-3 flex-row gap-[3px] overflow-hidden rounded-full bg-surface-sunken"
                                    >
                                        {MACROS.map((macro) => {
                                            const kcal = shareOf(macro)?.kilocalories ?? 0;
                                            return kcal <= 0 ? null : (
                                                <View
                                                    key={macro}
                                                    className={cx(
                                                        'h-full rounded-full',
                                                        TINT_INK_FILL[MACRO_TINT[macro]],
                                                    )}
                                                    style={{ flex: kcal }}
                                                />
                                            );
                                        })}
                                    </View>
                                    <View className="mt-2.5 flex-row flex-wrap gap-x-3.5 gap-y-1">
                                        {MACROS.map((macro) => (
                                            <View
                                                key={macro}
                                                className="flex-row items-center gap-1.5"
                                            >
                                                <View
                                                    className={cx(
                                                        'h-2 w-2 rounded-full',
                                                        TINT_INK_FILL[MACRO_TINT[macro]],
                                                    )}
                                                />
                                                <RNText className="text-xs font-semibold text-content-secondary">
                                                    {t('catalogue:facts.shareLegend', {
                                                        nutrient: nameOf(macro),
                                                        percentage: formatter.formatNumber(
                                                            shareOf(macro)?.percentageOfEnergy ?? 0,
                                                        ),
                                                    })}
                                                </RNText>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )}

                            {/* The three macros */}
                            <View className="mt-4 flex-row gap-2 sm:gap-2.5">
                                {MACROS.map((macro) => {
                                    const tint = MACRO_TINT[macro];
                                    const share = shareOf(macro);
                                    const percentage = share?.percentageOfEnergy ?? 0;
                                    const band = MACRO_DISTRIBUTION_RANGES[macro];
                                    const flag =
                                        macroKcal <= 0
                                            ? null
                                            : percentage < band.min
                                              ? 'low'
                                              : percentage > band.max
                                                ? 'high'
                                                : null;
                                    const { value, unit } = numberOf(macro);
                                    return (
                                        <View
                                            key={macro}
                                            testID={`${testID}-macro-${macro}`}
                                            className={cx(
                                                'min-w-0 flex-1 flex-col gap-1 rounded-2xl px-3 pb-3 pt-3.5 sm:px-3.5',
                                                TINT_FILL[tint],
                                            )}
                                        >
                                            <View className="flex-row items-center gap-1.5">
                                                <View
                                                    className={cx(
                                                        'h-2 w-2 rounded-full',
                                                        TINT_INK_FILL[tint],
                                                    )}
                                                />
                                                <RNText
                                                    numberOfLines={1}
                                                    className={cx(
                                                        'shrink text-sm font-semibold',
                                                        TINT_INK[tint],
                                                    )}
                                                >
                                                    {nameOf(macro)}
                                                </RNText>
                                            </View>
                                            <View className="flex-row items-baseline gap-0.5">
                                                <RNText
                                                    testID={`${testID}-amount-${macro}`}
                                                    className="font-display text-2xl font-bold tracking-display tabular-nums text-content-primary"
                                                >
                                                    {value}
                                                </RNText>
                                                <RNText className="text-sm font-semibold text-content-secondary">
                                                    {unit}
                                                </RNText>
                                            </View>
                                            {share === undefined ? null : (
                                                <RNText
                                                    numberOfLines={1}
                                                    className="text-xs text-content-secondary text-start"
                                                >
                                                    {t('catalogue:facts.shareLine', {
                                                        kilocalories: formatter.formatNumber(
                                                            share.kilocalories,
                                                        ),
                                                        percentage:
                                                            formatter.formatNumber(percentage),
                                                    })}
                                                </RNText>
                                            )}
                                            {inside(macro).map((nested) => (
                                                <View
                                                    key={nested}
                                                    className="flex-row items-center justify-between gap-2"
                                                >
                                                    <RNText
                                                        numberOfLines={1}
                                                        className="shrink text-xs text-content-secondary text-start"
                                                    >
                                                        {nameOf(nested)}
                                                    </RNText>
                                                    <RNText
                                                        testID={`${testID}-amount-${nested}`}
                                                        className="text-xs font-semibold tabular-nums text-content-primary"
                                                    >
                                                        {amountOf(nested)}
                                                    </RNText>
                                                </View>
                                            ))}
                                            {flag === null ? null : (
                                                <View
                                                    testID={`${testID}-macro-${macro}-${flag}`}
                                                    className="mt-1 self-start rounded-full bg-warning-subtle px-2 py-0.5"
                                                >
                                                    <RNText className="text-xs font-semibold text-warning-on-subtle">
                                                        {t(`catalogue:facts.${flag}`)}
                                                    </RNText>
                                                </View>
                                            )}
                                        </View>
                                    );
                                })}
                            </View>

                            {/* Everything else */}
                            {rest.length === 0 ? null : (
                                <View
                                    role="list"
                                    className="mt-[18px] flex-col border-t border-stroke-subtle"
                                >
                                    {rest.map((nutrientId, index) => (
                                        <View
                                            key={nutrientId}
                                            role="listitem"
                                            className={cx(
                                                'min-h-[46px] flex-row items-center gap-3',
                                                index === rest.length - 1
                                                    ? ''
                                                    : 'border-b border-stroke-subtle',
                                            )}
                                        >
                                            <RNText className="min-w-0 flex-1 text-base text-content-primary text-start">
                                                {nameOf(nutrientId)}
                                            </RNText>
                                            <RNText
                                                testID={`${testID}-amount-${nutrientId}`}
                                                className="text-base font-bold tabular-nums text-content-primary"
                                            >
                                                {amountOf(nutrientId)}
                                            </RNText>
                                        </View>
                                    ))}
                                </View>
                            )}
                        </View>
                    )}
                </View>

                <View className="flex-col gap-4 lg:flex-1">
                    {/* ── 5 · where the figures come from ───────────────────────────────────── */}
                    <View
                        testID={`${testID}-source`}
                        className="flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-5"
                    >
                        <View className="flex-row items-center gap-2.5">
                            <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-brand-subtle">
                                <Icon
                                    name="infoCircle"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                            </View>
                            <RNText className="shrink font-display text-base font-bold text-content-primary text-start">
                                {t('catalogue:facts.sourceTitle')}
                            </RNText>
                        </View>

                        {sourceKind === 'synthetic_prototype' ? (
                            <View
                                testID={`${testID}-synthetic`}
                                className="mt-3.5 flex-row items-center gap-2 self-start rounded-full bg-tint-violet px-3 py-1.5"
                            >
                                <Icon name="prototype" size="sm" className="text-tint-violet-on" />
                                <RNText className="shrink text-xs font-semibold text-tint-violet-on">
                                    {t('catalogue:facts.syntheticNote')}
                                </RNText>
                            </View>
                        ) : null}

                        <View className="mt-3.5 flex-col gap-2.5">
                            <Fact
                                icon="check"
                                label={t('catalogue:facts.workedOutFrom')}
                                value={workedOutFrom}
                            />
                            {/* `UNKNOWN_ISO_DATE_TIME` is `''` when the API has no timestamp — never
                                hand that to `formatDate`, which throws on an unparseable value. */}
                            {isRenderableTimestamp(active.calculation.calculatedAt) ? (
                                <Fact
                                    testID={`${testID}-calculated-at`}
                                    icon="calendar"
                                    label={t('catalogue:facts.lastWorkedOut')}
                                    value={formatter.formatDate(active.calculation.calculatedAt, {
                                        dateStyle: 'medium',
                                    })}
                                />
                            ) : null}
                            <Fact
                                testID={`${testID}-version`}
                                icon="layers"
                                label={t('catalogue:facts.dataVersion')}
                                value={active.source.version}
                            />
                        </View>

                        <Pressable
                            testID={`${testID}-technical`}
                            role="button"
                            accessibilityRole="button"
                            aria-expanded={technical}
                            accessibilityState={{ expanded: technical }}
                            onPress={() => {
                                setTechnical((open) => !open);
                            }}
                            className="mt-3 min-h-[42px] flex-row items-center justify-between gap-2 border-t border-stroke-subtle"
                        >
                            <RNText className="text-sm font-semibold text-content-secondary">
                                {t('catalogue:facts.technical')}
                            </RNText>
                            <Icon
                                name={technical ? 'chevronUp' : 'chevronDown'}
                                size="sm"
                                className="text-content-secondary"
                            />
                        </Pressable>
                        {technical ? (
                            <View testID={`${testID}-notes`} className="flex-col gap-1.5 pb-1">
                                <RNText className="text-sm text-content-secondary text-start">
                                    {t('catalogue:facts.source', { source: active.source.label })}
                                </RNText>
                                <RNText className="text-sm text-content-secondary text-start">
                                    {t('catalogue:facts.method', {
                                        method: active.calculation.method,
                                    })}
                                </RNText>
                                <RNText className="text-sm text-content-secondary text-start">
                                    {t('catalogue:facts.rounding', {
                                        rounding: active.calculation.rounding,
                                    })}
                                </RNText>
                                {active.calculation.prototype ? (
                                    <RNText className="text-sm text-content-secondary text-start">
                                        {t('catalogue:facts.prototypeFlag')}
                                    </RNText>
                                ) : null}
                                {active.calculation.notes.map((note) => (
                                    <RNText
                                        key={note}
                                        className="text-sm leading-relaxed text-content-secondary text-start"
                                    >
                                        {note}
                                    </RNText>
                                ))}
                            </View>
                        ) : null}
                    </View>

                    {/* ── 6 · how it compares ───────────────────────────────────────────────── */}
                    {unavailable || macroKcal <= 0 ? null : (
                        <View
                            testID={`${testID}-compare`}
                            className="flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-5"
                        >
                            <View className="flex-row items-center gap-2.5">
                                <View className="h-9 w-9 items-center justify-center rounded-xl bg-tint-orange">
                                    <Icon
                                        name="chartColumn"
                                        size="sm"
                                        className="text-tint-orange-on"
                                    />
                                </View>
                                <RNText className="shrink font-display text-base font-bold text-content-primary text-start">
                                    {t('catalogue:facts.compareTitle')}
                                </RNText>
                            </View>
                            <View className="mt-3.5 flex-col gap-3.5">
                                {MACROS.map((macro) => {
                                    const percentage = Math.min(
                                        100,
                                        Math.max(0, shareOf(macro)?.percentageOfEnergy ?? 0),
                                    );
                                    const band = MACRO_DISTRIBUTION_RANGES[macro];
                                    return (
                                        <View key={macro} className="flex-col">
                                            <View className="flex-row items-center justify-between">
                                                <RNText className="text-sm font-semibold text-content-primary">
                                                    {nameOf(macro)}
                                                </RNText>
                                                <RNText className="text-sm font-bold tabular-nums text-content-primary">
                                                    {`${formatter.formatNumber(percentage)}%`}
                                                </RNText>
                                            </View>
                                            {/* Flex parts, so the track runs from the start in Arabic too. */}
                                            <View
                                                aria-hidden
                                                className="relative mt-2 h-2 flex-row rounded-full bg-surface-sunken"
                                            >
                                                <View style={{ flex: band.min }} />
                                                <View
                                                    className="h-full rounded-full bg-stroke"
                                                    style={{ flex: band.max - band.min }}
                                                />
                                                <View style={{ flex: 100 - band.max }} />
                                                <View className="absolute inset-0 flex-row items-center">
                                                    <View style={{ flex: percentage }} />
                                                    <View
                                                        className={cx(
                                                            '-mx-[7px] h-3.5 w-3.5 rounded-full border-[3px] border-surface-raised shadow-elevation-1',
                                                            TINT_INK_FILL[MACRO_TINT[macro]],
                                                        )}
                                                    />
                                                    <View style={{ flex: 100 - percentage }} />
                                                </View>
                                            </View>
                                            <RNText className="mt-1.5 text-xs text-content-secondary text-start">
                                                {t('catalogue:facts.usualRange', {
                                                    min: formatter.formatNumber(band.min),
                                                    max: formatter.formatNumber(band.max),
                                                })}
                                            </RNText>
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    )}
                </View>
            </View>
        </View>
    );
}

function Fact({
    icon,
    label,
    value,
    testID,
}: {
    readonly icon: 'check' | 'calendar' | 'layers';
    readonly label: string;
    readonly value: string;
    readonly testID?: string | undefined;
}) {
    return (
        <View
            testID={testID}
            className="flex-row items-start gap-3 rounded-2xl bg-surface-sunken p-3"
        >
            <View className="h-[30px] w-[30px] items-center justify-center rounded-[10px] bg-surface-raised">
                <Icon name={icon} size="sm" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText className="text-xs font-semibold text-content-secondary text-start">
                    {label}
                </RNText>
                <RNText className="mt-0.5 text-sm font-semibold text-content-primary text-start">
                    {value}
                </RNText>
            </View>
        </View>
    );
}
