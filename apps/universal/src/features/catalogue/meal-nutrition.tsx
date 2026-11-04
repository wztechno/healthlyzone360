import { Icon, cx } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount, precisionFor } from '@healthy360/nutrition';
import type { NutritionFacts } from '@healthy360/nutrition';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { orderedNutrientIds, per100gFacts } from './format.ts';
import { TINT_INK_FILL } from './shelf-tints.ts';
import type { ShelfTint } from './shelf-tints.ts';

/**
 * The meal page's nutrition facts, in the shop design's language: the figures as a list in one
 * rounded card, with a pill toggle between a serving and 100 g, and beside it the provenance in a
 * soft card of its own.
 *
 * The same rules as `nutrition-facts-panel.tsx`, which the planner keeps for its recipes:
 *
 * * **Two bases, one dataset.** Per 100 g is derived from the mass the facts carry, and when that
 *   mass is unknown the toggle says so rather than inventing a density.
 * * **Unless the payload is already per 100 g** — a listing sold by weight has no serving, so there
 *   is no toggle and the list is captioned for what it is.
 * * **Provenance is not decoration.** Source, version, calculation time, method and rounding are on
 *   every panel, and a synthetic figure is labelled synthetic.
 */
export interface MealNutritionProps {
    readonly facts: NutritionFacts;
    readonly title: string;
    readonly testID: string;
}

type Basis = 'per_serving' | 'per_100g';

/** The headline figures wear the colours the rings above them do. */
const LEAD_DOTS: Readonly<Record<string, ShelfTint>> = {
    energy: 'orange',
    protein: 'green',
    carbohydrate: 'blue',
    fat: 'yellow',
    fibre: 'teal',
};

/** What sits inside a headline figure — fats inside fat, sugars inside carbohydrate. */
const NESTED = new Set([
    'saturated_fat',
    'monounsaturated_fat',
    'polyunsaturated_fat',
    'trans_fat',
    'sugars',
    'added_sugars',
    'starch',
]);

/** True when `value` can be passed to `formatDate` without throwing. */
function isRenderableTimestamp(value: string): boolean {
    return value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function MealNutrition({ facts, title, testID }: MealNutritionProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [basis, setBasis] = useState<Basis>('per_serving');

    // Already the comparison basis: one view, no re-basing.
    const fixedPer100g = facts.basis === 'per_100g';
    const per100g = fixedPer100g ? null : per100gFacts(facts);
    const active = basis === 'per_100g' && per100g !== null ? per100g : facts;

    const basisLabel =
        fixedPer100g || (basis === 'per_100g' && per100g !== null)
            ? t('catalogue:facts.per100g')
            : t('catalogue:facts.perServing');

    const rows = orderedNutrientIds(active).map((nutrientId) => {
        const amount = findAmount(active, nutrientId);
        const value = amount === null ? 0 : amount.value;
        return {
            nutrientId,
            name: t(`marketplace:nutrients.${nutrientId}`, {
                defaultValue: coreNutrientDefinition(nutrientId)?.displayName ?? nutrientId,
            }),
            amount: `${formatter.formatNumber(value, {
                minimumFractionDigits: 0,
                maximumFractionDigits: precisionFor(nutrientId),
            })} ${amount?.unit ?? ''}`.trim(),
        };
    });

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
                    'items-center rounded-xl px-3.5 py-1.5 transition duration-normal ease-standard',
                    on ? 'bg-surface-raised shadow-elevation-1' : 'hover:bg-surface-raised',
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

    const provenance = [
        t('catalogue:facts.source', { source: active.source.label }),
        t('catalogue:facts.method', { method: active.calculation.method }),
        t('catalogue:facts.rounding', { rounding: active.calculation.rounding }),
    ];

    return (
        <View testID={testID} className="flex-col gap-4 lg:flex-row lg:items-start">
            <View className="flex-col rounded-3xl border border-stroke-subtle bg-surface-raised p-5 lg:flex-[1.4]">
                <View className="flex-row flex-wrap items-center justify-between gap-3">
                    <View className="flex-row items-center gap-2.5">
                        <View className="h-9 w-9 items-center justify-center rounded-xl bg-tint-orange">
                            <Icon name="heartPulse" size="sm" className="text-tint-orange-on" />
                        </View>
                        <RNText className="font-display text-base font-bold text-content-primary">
                            {title}
                        </RNText>
                    </View>
                    {fixedPer100g ? (
                        <View className="rounded-full bg-surface-base px-3 py-1.5">
                            <RNText
                                testID={`${testID}-sold-by-weight`}
                                className="text-xs font-semibold text-content-secondary"
                            >
                                {t('catalogue:facts.soldByWeight')}
                            </RNText>
                        </View>
                    ) : (
                        <View
                            testID={`${testID}-basis`}
                            role="tablist"
                            aria-label={t('catalogue:facts.basisLabel')}
                            className="flex-row gap-1 rounded-2xl bg-surface-base p-1"
                        >
                            {toggle('per_serving', t('catalogue:facts.perServing'), false)}
                            {toggle('per_100g', t('catalogue:facts.per100g'), per100g === null)}
                        </View>
                    )}
                </View>

                <RNText
                    testID={`${testID}-table-caption`}
                    className="mt-3 text-xs font-semibold uppercase tracking-wider text-content-secondary text-start"
                >
                    {t('catalogue:facts.caption', { basis: basisLabel })}
                </RNText>

                {basis === 'per_100g' && per100g === null ? (
                    <RNText
                        testID={`${testID}-per-100g-unavailable`}
                        className="mt-2 text-sm text-content-secondary text-start"
                    >
                        {t('catalogue:facts.per100gUnavailable')}
                    </RNText>
                ) : (
                    <View testID={`${testID}-table`} role="list" className="mt-1 flex-col">
                        {rows.map((row, index) => {
                            const dot = LEAD_DOTS[row.nutrientId];
                            const nested = NESTED.has(row.nutrientId);
                            return (
                                <View
                                    key={row.nutrientId}
                                    role="listitem"
                                    className={cx(
                                        'flex-row items-center gap-2.5 py-2.5',
                                        index === rows.length - 1
                                            ? ''
                                            : 'border-b border-stroke-subtle',
                                        nested ? 'ps-5' : '',
                                    )}
                                >
                                    {dot === undefined ? (
                                        nested ? null : (
                                            <View className="h-2 w-2" />
                                        )
                                    ) : (
                                        <View
                                            className={cx(
                                                'h-2 w-2 rounded-full',
                                                TINT_INK_FILL[dot],
                                            )}
                                        />
                                    )}
                                    <RNText
                                        className={cx(
                                            'min-w-0 flex-1 text-sm text-start',
                                            nested
                                                ? 'text-content-secondary'
                                                : 'font-semibold text-content-primary',
                                        )}
                                    >
                                        {row.name}
                                    </RNText>
                                    <RNText
                                        testID={`${testID}-amount-${row.nutrientId}`}
                                        className={cx(
                                            'text-sm tabular-nums',
                                            nested
                                                ? 'text-content-secondary'
                                                : 'font-bold text-content-primary',
                                        )}
                                    >
                                        {row.amount}
                                    </RNText>
                                </View>
                            );
                        })}
                    </View>
                )}
            </View>

            <View
                testID={`${testID}-source`}
                className="flex-col gap-2.5 rounded-3xl bg-surface-sunken p-5 lg:flex-1"
            >
                <View className="flex-row items-center gap-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-xl bg-surface-raised">
                        <Icon name="infoCircle" size="sm" className="text-content-primary" />
                    </View>
                    <RNText className="font-display text-base font-bold text-content-primary">
                        {t('catalogue:facts.sourceTitle')}
                    </RNText>
                </View>

                {active.source.kind === 'synthetic_prototype' ? (
                    <View
                        testID={`${testID}-synthetic`}
                        className="flex-row items-center gap-2 self-start rounded-full bg-tint-violet px-3 py-1.5"
                    >
                        <Icon name="prototype" size="sm" className="text-tint-violet-on" />
                        <RNText className="text-xs font-semibold text-tint-violet-on">
                            {t('catalogue:facts.syntheticNote')}
                        </RNText>
                    </View>
                ) : null}

                <View className="flex-col gap-1.5">
                    <RNText className="text-sm text-content-secondary text-start">
                        {provenance[0]}
                    </RNText>
                    <RNText
                        testID={`${testID}-version`}
                        className="text-sm text-content-secondary text-start"
                    >
                        {t('catalogue:facts.version', { version: active.source.version })}
                    </RNText>
                    {/* `UNKNOWN_ISO_DATE_TIME` is `''` when the API has no timestamp — never
                        hand that to `formatDate`, which throws on an unparseable value. */}
                    {isRenderableTimestamp(active.calculation.calculatedAt) ? (
                        <RNText
                            testID={`${testID}-calculated-at`}
                            className="text-sm text-content-secondary text-start"
                        >
                            {t('catalogue:facts.calculatedAt', {
                                timestamp: formatter.formatDate(active.calculation.calculatedAt, {
                                    dateStyle: 'medium',
                                    timeStyle: 'short',
                                }),
                            })}
                        </RNText>
                    ) : null}
                    {provenance.slice(1).map((line) => (
                        <RNText key={line} className="text-sm text-content-secondary text-start">
                            {line}
                        </RNText>
                    ))}
                    {active.calculation.prototype ? (
                        <RNText className="text-sm text-content-secondary text-start">
                            {t('catalogue:facts.prototypeFlag')}
                        </RNText>
                    ) : null}
                </View>

                {active.calculation.notes.length === 0 ? null : (
                    <View
                        testID={`${testID}-notes`}
                        className="mt-1 flex-col gap-1.5 border-t border-stroke-subtle pt-3"
                    >
                        <RNText className="text-xs font-semibold uppercase tracking-wider text-content-secondary text-start">
                            {t('catalogue:facts.notesTitle')}
                        </RNText>
                        {active.calculation.notes.map((note) => (
                            <RNText
                                key={note}
                                className="text-sm leading-relaxed text-content-secondary text-start"
                            >
                                {note}
                            </RNText>
                        ))}
                    </View>
                )}
            </View>
        </View>
    );
}
