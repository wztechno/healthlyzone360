import { Callout, Inline, ProgressRing, Stack, Text } from '@healthy360/design-system';
import type { NutritionLevel } from '@healthy360/design-tokens';
import { useFormatter } from '@healthy360/i18n';
import { amountValue } from '@healthy360/nutrition';
import type { MacroNutrientId, NutritionFacts } from '@healthy360/nutrition';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { macroBreakdown } from './format.ts';

/**
 * The three macronutrients of one serving, as rings.
 *
 * ## What the ring is a proportion *of*
 *
 * The share of the serving's declared energy — not a share of a personal target. A marketplace meal
 * has no idea who is reading it, and drawing a meal against "your protein target" on a public page
 * would be a fabrication dressed as a meter.
 *
 * ## Why there is a five-stop level at all, and where it comes from
 *
 * A ring with no scale is a decoration. The scale used here is the **acceptable macronutrient
 * distribution range** published by the Institute of Medicine (2005) — the same source the
 * prototype target engine cites for its fat floor, and a published population range rather than
 * anything reverse-engineered from a reference product (doc 09 §7 forbids the latter absolutely).
 *
 * Only two of the design system's five stops are used, deliberately. The AMDR is a two-state fact —
 * inside the band or outside it — and spreading it across five stops would manufacture precision
 * the source does not have. `optimal` and `moderate` are the two chosen, and each carries its
 * pattern mark and a full sentence next to the colour, so the reading survives greyscale (WCAG
 * 1.4.1, and doc 17, NUT-07).
 *
 * The accompanying note says in plain words that the band describes a population and not the
 * reader, because a person who lands outside one must not read that as a diagnosis.
 */

/**
 * Acceptable macronutrient distribution ranges for adults, percent of energy.
 * Institute of Medicine, *Dietary Reference Intakes for Energy, Carbohydrate, Fibre, Fat, Fatty
 * Acids, Cholesterol, Protein and Amino Acids*, National Academies Press, 2005.
 */
export const MACRO_DISTRIBUTION_RANGES: Readonly<
    Record<MacroNutrientId, { readonly min: number; readonly max: number }>
> = {
    protein: { min: 10, max: 35 },
    carbohydrate: { min: 45, max: 65 },
    fat: { min: 20, max: 35 },
};

export function macroDistributionLevel(
    nutrientId: MacroNutrientId,
    percentageOfEnergy: number,
): NutritionLevel {
    const band = MACRO_DISTRIBUTION_RANGES[nutrientId];
    return percentageOfEnergy >= band.min && percentageOfEnergy <= band.max
        ? 'optimal'
        : 'moderate';
}

export interface MacroRingsProps {
    readonly facts: NutritionFacts;
    /** Hides the reference note where the surrounding block already carries one. */
    readonly showReference?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function MacroRings({
    facts,
    showReference = true,
    testID = 'macro-rings',
}: MacroRingsProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const energy = amountValue(facts, 'energy');
    const shares = macroBreakdown(facts);

    return (
        <Stack space="sm" testID={testID}>
            <Inline space="lg" wrap align="start">
                {shares.map((share) => {
                    const level = macroDistributionLevel(
                        share.nutrientId,
                        share.percentageOfEnergy,
                    );
                    const band = MACRO_DISTRIBUTION_RANGES[share.nutrientId];
                    const nutrient = t(`marketplace:nutrients.${share.nutrientId}`);
                    const verdict =
                        level === 'optimal'
                            ? t('catalogue:macros.inRange')
                            : t('catalogue:macros.outOfRange');

                    return (
                        <View key={share.nutrientId} className="min-w-[140px] items-center gap-1">
                            <ProgressRing
                                testID={`${testID}-${share.nutrientId}`}
                                size="md"
                                label={t('catalogue:macros.ringLabel', { nutrient })}
                                value={share.kilocalories}
                                target={energy}
                                level={level}
                                levelLabel={verdict}
                                caption={t('catalogue:macros.grams', {
                                    grams: formatter.formatNumber(share.grams, {
                                        maximumFractionDigits: 1,
                                    }),
                                })}
                                valueText={t('catalogue:macros.ringValue', {
                                    grams: formatter.formatNumber(share.grams, {
                                        maximumFractionDigits: 1,
                                    }),
                                    kilocalories: formatter.formatNumber(share.kilocalories),
                                    percentage: formatter.formatNumber(share.percentageOfEnergy),
                                    verdict,
                                })}
                            />
                            <Text variant="bodyStrong">{nutrient}</Text>
                            <Text
                                testID={`${testID}-${share.nutrientId}-energy`}
                                tone="secondary"
                                variant="caption"
                            >
                                {t('catalogue:macros.kilocalories', {
                                    kilocalories: formatter.formatNumber(share.kilocalories),
                                })}
                            </Text>
                            <Text tone="secondary" variant="caption">
                                {t('catalogue:macros.publishedRange', {
                                    min: formatter.formatNumber(band.min),
                                    max: formatter.formatNumber(band.max),
                                })}
                            </Text>
                        </View>
                    );
                })}
            </Inline>

            {showReference ? (
                <Callout
                    testID={`${testID}-reference`}
                    role="note"
                    tone="info"
                    icon="info"
                    title={t('catalogue:macros.referenceTitle')}
                    body={`${t('catalogue:macros.referenceBody')} ${t('catalogue:macros.referenceCitation')}`}
                />
            ) : null}
        </Stack>
    );
}
