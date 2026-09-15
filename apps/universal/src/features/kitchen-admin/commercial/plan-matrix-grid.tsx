import { Badge, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, ScrollView, View } from 'react-native';

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
 * A 220px combination track, then one track per energy band, each cell a 32px toggle. **The cell
 * carries the word** — `Sold` / `Not sold` — not just the tint, so the grid reads correctly in
 * greyscale and to a screen reader, whose accessible name is the whole sentence ("Sold — 3 meals, 1
 * snack at 1500–1800 kcal").
 *
 * It is a toggle grid rather than a `Table` of checkboxes: the design's cells are the control, and a
 * checkbox beside a word put two targets in a 120px cell. Each cell is `role="checkbox"` with its
 * checked state, so the semantics the table gave are kept.
 *
 * Wide on purpose: below its 760px floor the grid scrolls sideways inside its own port rather than
 * squeezing four bands into slivers.
 */
export interface PlanMatrixGridProps {
    readonly rows: readonly MatrixRow[];
    readonly bands: readonly MatrixBand[];
    readonly variants: readonly VariantDraft[];
    readonly onToggle: (row: MatrixRow, band: MatrixBand) => void;
    readonly canManage: boolean;
    readonly testID: string;
}

/** The design's `220px` combination track and `minmax(120px, 1fr)` band tracks. */
const COMBINATION_TRACK = 220;
const BAND_FLOOR = 120;
const GRID_FLOOR = 760;

export function PlanMatrixGrid({
    rows,
    bands,
    variants,
    onToggle,
    canManage,
    testID,
}: PlanMatrixGridProps) {
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
                            <Text variant="mono" tone="secondary" numberOfLines={1}>
                                {row.combination === null ? servings(row) : row.combination.code}
                            </Text>
                            {row.combination === null ? (
                                <View className="flex-row">
                                    <Badge
                                        testID={`${testID}-row-${row.key}-undeclared`}
                                        tone="warning"
                                        label={t('kitchen:plans.rowUndeclared')}
                                    />
                                </View>
                            ) : row.combination.isAvailable ? null : (
                                <View className="flex-row">
                                    <Badge
                                        testID={`${testID}-row-${row.key}-unavailable`}
                                        tone="neutral"
                                        label={t('kitchen:plans.combinationUnavailable')}
                                    />
                                </View>
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
                                    <Pressable
                                        testID={`${cellId}-control`}
                                        role="checkbox"
                                        accessibilityRole="checkbox"
                                        accessibilityState={{ checked: sold, disabled: !canManage }}
                                        aria-checked={sold}
                                        accessibilityLabel={t('kitchen:plans.cellLabel', {
                                            combination: servings(row),
                                            band: bandLabel(band),
                                        })}
                                        {...({
                                            title: `${word} — ${servings(row)} · ${bandLabel(band)}`,
                                        } as object)}
                                        disabled={!canManage}
                                        onPress={() => {
                                            onToggle(row, band);
                                        }}
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
                                    </Pressable>
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
