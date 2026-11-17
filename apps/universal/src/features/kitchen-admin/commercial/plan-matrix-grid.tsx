import { DATA_LIST_HEAD_TEXT_CLASS, Icon } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Platform, Text as RNText, ScrollView, View } from 'react-native';

import { DeskButton } from '../desk-kit/desk-button.tsx';
import { cellVariants } from '../plan-matrix.ts';
import type { MatrixBand, MatrixRow, VariantDraft } from '../plan-matrix.ts';

/**
 * The plan matrix as the Commercial canvas draws it (`Kitchen-com-plan-draft-matrix`, 2026-11-15).
 *
 * ```
 * ┌─────────────────────────────┬──────────────────┬──────────────────┬──────────────────┐
 * │ COMBINATION                 │ 1,400–1,600 KCAL │ 1,700–1,900 KCAL │ 2,000–2,300 KCAL │  38px, sunken
 * ├─────────────────────────────┼──────────────────┼──────────────────┼──────────────────┤
 * │ 3 meals, 1 snack a day      │ Sold             │ Sold             │ ╱╱ Not sold ╱╱╱╱ │  64px
 * │                             │ Light            │ Standard         │ ╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱ │
 * └─────────────────────────────┴──────────────────┴──────────────────┴──────────────────┘
 * ```
 *
 * One framed grid (16px corners, hairlines between every row and column): the combination track
 * at 1.3 parts and one part per energy band. A sold cell is the brand-subtle ground with **Sold**
 * and the configuration that sells it (or how many do, when more than one shares the cell); an
 * empty one says **Not sold** on a hatched ground, so the grid reads in greyscale and to a screen
 * reader, whose accessible name is the whole sentence. Text starts at the inline start, 14px in,
 * as every table's does.
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
    /**
     * Takes the reader to the step where a cell is made. With nothing on the matrix the grid is
     * a dashed box saying so, and this is its one way on (`Configurations →`).
     */
    readonly onOpenConfigurations?: (() => void) | undefined;
    readonly testID: string;
}

/** The canvas's `minmax(0,1.3fr) repeat(n, minmax(0,1fr))`. */
const COMBINATION_FLEX = 1.3;
const GRID_FLOOR = 760;

/**
 * The empty cell's hatch: an 1px sunken stroke every 9px at 135°. A web background — React Native
 * draws no gradient — so on a phone the cell is plain and its words carry it alone.
 */
const HATCH =
    Platform.OS === 'web'
        ? ({
              backgroundImage:
                  'repeating-linear-gradient(135deg, transparent 0 8px, rgb(var(--h360-color-surface-sunken)) 8px 9px)',
          } as object)
        : undefined;

export function PlanMatrixGrid({
    rows,
    bands,
    variants,
    onOpenConfigurations,
    testID,
}: PlanMatrixGridProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const bandLabel = (band: MatrixBand): string =>
        t('kitchen:plans.bandRange', {
            min: formatter.formatNumber(band.min),
            max: formatter.formatNumber(band.max),
        });
    // Each count pluralised on its own — "1 snack", not "1 snacks" — then joined.
    const servings = (row: MatrixRow): string =>
        t('kitchen:plans.servingsSummary', {
            meals: t('kitchen:plans.servingsMeals', { count: row.mealsPerDay }),
            snacks: t('kitchen:plans.servingsSnacks', { count: row.snacksPerDay }),
        });
    const variantName = (variant: VariantDraft): string =>
        variant.name.en.trim() === '' ? t('kitchen:plans.unnamedVariant') : variant.name.en;

    /*
     * Nothing to draw yet: the canvas's dashed box (`.emp`) — the grid icon, the one sentence, and
     * the way to where cells are made, rather than a sentence explaining that way.
     */
    if (rows.length === 0) {
        return (
            <View
                testID={testID}
                className="min-h-14 flex-row items-center gap-2.5 rounded-2xl border border-dashed border-stroke px-3.5 py-2.5"
            >
                <Icon name="layoutGrid" size="md" className="text-content-secondary" />
                <RNText className="min-w-0 flex-1 text-sm font-medium text-content-secondary text-start">
                    {t('kitchen:plans.matrixEmpty')}
                </RNText>
                {onOpenConfigurations === undefined ? null : (
                    <DeskButton
                        testID={`${testID}-open-variants`}
                        variant="quiet"
                        size="sm"
                        label={t('kitchen:plans.tabVariants')}
                        iconEnd={<Icon name="arrowForward" size="sm" />}
                        onPress={onOpenConfigurations}
                    />
                )}
            </View>
        );
    }

    return (
        <ScrollView horizontal testID={testID} contentContainerClassName="flex-grow flex-col">
            <View
                accessibilityLabel={t('kitchen:plans.matrixCaption')}
                style={{ minWidth: GRID_FLOOR }}
                className="flex-1 flex-col overflow-hidden rounded-2xl border border-stroke-subtle bg-surface-raised"
            >
                <View className="min-h-[38px] flex-row bg-surface-sunken">
                    <View
                        style={{ flex: COMBINATION_FLEX }}
                        className="min-w-0 justify-center px-3.5 py-2"
                    >
                        <RNText numberOfLines={1} className={DATA_LIST_HEAD_TEXT_CLASS}>
                            {t('kitchen:plans.matrixRowHeader')}
                        </RNText>
                    </View>
                    {/*
                     * The inset sits on an inner box, as it does in the body's cells: flex shares
                     * the row out after each box's own padding, so a column padded on the outside
                     * here and on the inside below would not line up with itself.
                     */}
                    {bands.map((band) => (
                        <View
                            key={band.key}
                            className="min-w-0 flex-1 border-s border-stroke-subtle"
                        >
                            <View className="flex-1 justify-center px-3.5 py-2">
                                <RNText numberOfLines={1} className={DATA_LIST_HEAD_TEXT_CLASS}>
                                    {bandLabel(band)}
                                </RNText>
                            </View>
                        </View>
                    ))}
                </View>

                {rows.map((row) => (
                    <View key={row.key} className="min-h-16 flex-row border-t border-stroke-subtle">
                        <View
                            testID={`${testID}-row-${row.key}`}
                            style={{ flex: COMBINATION_FLEX }}
                            className="min-w-0 justify-center px-3.5 py-2"
                        >
                            <RNText
                                numberOfLines={2}
                                className="text-sm font-bold text-content-primary text-start"
                            >
                                {row.combination === null || row.combination.label.en.trim() === ''
                                    ? servings(row)
                                    : row.combination.label.en}
                            </RNText>
                        </View>

                        {bands.map((band) => {
                            const occupants = cellVariants(variants, row, band);
                            const sold = occupants.length > 0;
                            const cellId = `${testID}-cell-${row.key}-${band.key}`;
                            const word = sold
                                ? t('kitchen:plans.cellSold')
                                : t('kitchen:plans.cellNotSold');
                            const first = occupants[0];
                            return (
                                <View
                                    key={band.key}
                                    testID={cellId}
                                    className="min-w-0 flex-1 border-s border-stroke-subtle"
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
                                        style={sold ? undefined : HATCH}
                                        className={`min-h-16 flex-1 justify-center gap-0.5 px-3.5 py-2 ${
                                            sold ? 'bg-surface-brand-subtle' : ''
                                        }`}
                                    >
                                        {/* React Native's own `Text`: the ink is the cell's
                                            state, and `Text`'s tone class would race it. */}
                                        <RNText
                                            className={
                                                sold
                                                    ? 'text-[13px] font-bold text-content-on-brand-subtle text-start'
                                                    : 'text-[13px] font-medium text-content-secondary text-start'
                                            }
                                        >
                                            {word}
                                        </RNText>
                                        {first === undefined ? null : occupants.length > 1 ? (
                                            <RNText
                                                testID={`${cellId}-count`}
                                                numberOfLines={1}
                                                className="text-xs font-medium text-content-on-brand-subtle text-start"
                                            >
                                                {t('kitchen:plans.cellVariantCount', {
                                                    count: occupants.length,
                                                })}
                                            </RNText>
                                        ) : (
                                            <RNText
                                                testID={`${cellId}-name`}
                                                numberOfLines={1}
                                                className="text-xs font-medium text-content-on-brand-subtle text-start"
                                            >
                                                {variantName(first)}
                                            </RNText>
                                        )}
                                    </View>
                                </View>
                            );
                        })}
                    </View>
                ))}
            </View>
        </ScrollView>
    );
}
