import { Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText, ScrollView, View } from 'react-native';

import { cellVariants } from '../plan-matrix.ts';
import type { MatrixBand, MatrixRow, VariantDraft } from '../plan-matrix.ts';

/**
 * The plan matrix as `Commercial.dc.html` draws it (§2.2 `PlanMatrixGrid`, §3.3).
 *
 * ```
 * COMBINATION                    1200–1500 kcal   1500–1800 kcal   1800–2200 kcal
 * ─────────────────────────────────────────────────────────────────────────────────
 * Standard · 3 meals 1 snack    [    Sold     ]  [    Sold     ]  [  Not sold   ]
 * STANDARD-3M1S
 * ```
 *
 * A 220px combination track, then one track per energy band, each cell a 32px well. **The cell
 * carries the word** — `Sold` / `Not sold` — not just the tint, so the grid reads correctly in
 * greyscale and to a screen reader, whose accessible name is the whole sentence.
 *
 * ## Read-only, on purpose
 *
 * The matrix is what the configurations say, drawn back. A cell is sold exactly when a
 * configuration sits in it, and configurations are written on the Configurations tab — so nothing
 * here is pressable. Each cell keeps its checked state as accessibility state, so the grid still
 * answers "is this sold?" without being a control.
 *
 * Wide on purpose: below its 760px floor the grid scrolls sideways inside its own port rather than
 * squeezing four bands into slivers.
 */
export interface PlanMatrixGridProps {
    readonly rows: readonly MatrixRow[];
    readonly bands: readonly MatrixBand[];
    readonly variants: readonly VariantDraft[];
    readonly testID: string;
}

/** The design's `220px` combination track and `minmax(120px, 1fr)` band tracks. */
const COMBINATION_TRACK = 220;
const BAND_FLOOR = 120;
const GRID_FLOOR = 760;

export function PlanMatrixGrid({ rows, bands, variants, testID }: PlanMatrixGridProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const bandLabel = (band: MatrixBand): string =>
        t('kitchen:plans.bandRange', {
            min: formatter.formatNumber(band.min),
            max: formatter.formatNumber(band.max),
        });
    const servings = (row: MatrixRow): string =>
        t('kitchen:plans.servingsSummary', { meals: row.mealsPerDay, snacks: row.snacksPerDay });

    if (rows.length === 0) {
        return (
            <Text testID={testID} tone="secondary" variant="caption">
                {t('kitchen:plans.matrixEmpty')}
            </Text>
        );
    }

    return (
        <ScrollView horizontal testID={testID} contentContainerClassName="flex-col">
            <View
                accessibilityLabel={t('kitchen:plans.matrixCaption')}
                style={{ minWidth: GRID_FLOOR }}
                className="flex-1 flex-col"
            >
                <View className="h-8 flex-row items-end gap-tight border-b border-stroke">
                    <View style={{ width: COMBINATION_TRACK }} className="pb-1.5">
                        <Text variant="micro" tone="secondary">
                            {t('kitchen:plans.matrixRowHeader')}
                        </Text>
                    </View>
                    {bands.map((band) => (
                        <View
                            key={band.key}
                            style={{ minWidth: BAND_FLOOR }}
                            className="flex-1 pb-1.5"
                        >
                            <Text variant="mono" tone="secondary" align="center">
                                {bandLabel(band)}
                            </Text>
                        </View>
                    ))}
                </View>

                {rows.map((row) => (
                    <View
                        key={row.key}
                        className="min-h-11 flex-row items-center gap-tight border-b border-stroke-subtle py-1.5"
                    >
                        <View
                            testID={`${testID}-row-${row.key}`}
                            style={{ width: COMBINATION_TRACK }}
                            className="min-w-0 flex-col"
                        >
                            <Text variant="strong" numberOfLines={1}>
                                {row.combination === null
                                    ? servings(row)
                                    : row.combination.label.en.trim() === ''
                                      ? servings(row)
                                      : row.combination.label.en}
                            </Text>
                            {row.combination === null ? null : (
                                <Text variant="mono" tone="secondary" numberOfLines={1}>
                                    {row.combination.code}
                                </Text>
                            )}
                        </View>

                        {bands.map((band) => {
                            const occupants = cellVariants(variants, row, band);
                            const sold = occupants.length > 0;
                            const cellId = `${testID}-cell-${row.key}-${band.key}`;
                            const word = sold
                                ? t('kitchen:plans.cellSold')
                                : t('kitchen:plans.cellNotSold');
                            return (
                                <View
                                    key={band.key}
                                    testID={cellId}
                                    style={{ minWidth: BAND_FLOOR }}
                                    className="flex-1 flex-col gap-hair"
                                >
                                    <View
                                        testID={`${cellId}-control`}
                                        accessibilityState={{ checked: sold }}
                                        accessibilityLabel={t('kitchen:plans.cellLabel', {
                                            combination: servings(row),
                                            band: bandLabel(band),
                                        })}
                                        {...({
                                            title: `${word} — ${servings(row)} · ${bandLabel(band)}`,
                                        } as object)}
                                        className={
                                            sold
                                                ? 'h-8 items-center justify-center rounded-sm border border-surface-brand bg-surface-brand-subtle'
                                                : 'h-8 items-center justify-center rounded-sm border border-stroke-subtle bg-surface-raised'
                                        }
                                    >
                                        {/* React Native's own `Text`: the ink is the cell's
                                            state, and `Text`'s tone class would race it. */}
                                        <RNText
                                            className={
                                                sold
                                                    ? 'text-role-label text-content-on-brand-subtle'
                                                    : 'text-role-label text-content-disabled'
                                            }
                                        >
                                            {word}
                                        </RNText>
                                    </View>
                                    {occupants.length > 1 ? (
                                        <Text
                                            testID={`${cellId}-count`}
                                            variant="caption"
                                            tone="secondary"
                                            align="center"
                                        >
                                            {t('kitchen:plans.cellVariantCount', {
                                                count: occupants.length,
                                            })}
                                        </Text>
                                    ) : null}
                                </View>
                            );
                        })}
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}
