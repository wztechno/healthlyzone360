import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { Badge, Cascade, InfoTip, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { PhotoCredit } from '../../../media/photo-credit.tsx';
import { displayName, statusShortKey, unitKey, unitShortKey } from '../format.ts';
import { AllergenChip } from './allergen-chip.tsx';
import { ingredientStockPhotoId } from './ingredient-photo.ts';
import { RecordCanopyHero } from './record-canopy.tsx';
import { primaryMenuAction, RecordPopup } from './record-popup.tsx';
import { RecordTile, RecordTileRow, TileEmpty, TileFacts } from './record-tiles.tsx';
import { SegmentBar, SegmentKey } from './segment-bar.tsx';

/**
 * The ingredient record, in its pop-up — the `Kitchen-ingredient` board.
 *
 * ```
 * ┌ canopy ──────────────────────────────────────────────────────────────┐
 * │ [photo] ING-221 · Published                               Unit price │
 * │         Tahini                                              $13.13   │
 * │         طحينة   (Nut & Seed) (Seed) (Kilogram)               per kg  │
 * └──────────────────────────────────────────────────────────────────────┘
 * ┌ Prices ───────────────────────┐  ┌ Allergens ─────────────────────────┐
 * ┌ Nutrition per 100 g ─────────────────────────────────────────────────┐
 * ┌ Composition ─────────────────────────────────────────────────────────┐
 * ```
 *
 * ## Only what an `IngredientAdmin` carries
 *
 * Every figure on the page is a field of the record, or arithmetic on two of them. The board draws
 * fewer rows than the record holds; what it leaves out still has a place here — the photo on the
 * canopy, cost per 100 g, margin and for sale among the prices, diets under the allergens, other
 * names and notes under the composition.
 *
 * ## Allergens: what it carries, or that nobody has looked
 *
 * "None" holds only for a record somebody assessed. An ingredient with no mapping and no
 * `allergensAssessedClear` has simply not been recorded, and saying "No allergens" over it would be
 * the most dangerous lie this page could tell, so it says it has not been recorded instead.
 *
 * ## The bars are shares of a published reference, not a verdict
 *
 * Each nutrient is drawn against an adult reference intake — the EU Reference Intakes (Regulation
 * (EU) No 1169/2011, Annex XIII Part B), with sodium as the salt RI divided by 2.5. Nothing in
 * `@healthy360/nutrition` classifies a single ingredient's per-100 g figure as "high" or "low", so
 * every bar takes the same fill and states the share it is. Fibre has no RI: its figure is stated
 * and its track stays empty.
 *
 * The energy split under the bars is the fat, carbohydrate and protein the record states, at
 * 9 / 4 / 4 kcal a gram, as shares of their sum — drawn only when all three are recorded.
 */

/** EU Reference Intakes for an adult, per day, in the nutrient's own unit. */
const REFERENCE_INTAKES: Readonly<Record<string, number>> = {
    energy: 2000,
    protein: 50,
    fat: 70,
    saturated_fat: 20,
    carbohydrate: 260,
    sugars: 90,
    sodium: 2400,
};

/** The bars, in the board's order. Energy leads in its circle and sodium closes on its own row. */
const NUTRIENT_BARS: readonly {
    readonly id: string;
    readonly labelKey: string;
}[] = [
    { id: 'protein', labelKey: 'nutrition:nutrients.protein' },
    { id: 'carbohydrate', labelKey: 'nutrition:nutrients.carbohydrate' },
    { id: 'sugars', labelKey: 'nutrition:nutrients.sugars' },
    { id: 'fat', labelKey: 'nutrition:nutrients.fat' },
    { id: 'saturated_fat', labelKey: 'nutrition:nutrients.saturatedFat' },
    { id: 'fibre', labelKey: 'nutrition:nutrients.fibre' },
];

/** Atwater's general factors, kcal per gram. */
const ENERGY_SPLIT = [
    { id: 'fat', labelKey: 'nutrition:nutrients.fat', kcalPerGram: 9, tone: 'deep' },
    {
        id: 'carbohydrate',
        labelKey: 'nutrition:nutrients.carbohydrate',
        kcalPerGram: 4,
        tone: 'warning',
    },
    { id: 'protein', labelKey: 'nutrition:nutrients.protein', kcalPerGram: 4, tone: 'brand' },
] as const;

/** One label and value line of a tile, the value at the inline end. */
function ValueRow({
    label,
    value,
    tone = 'primary',
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly tone?: 'primary' | 'secondary' | 'warning' | undefined;
    readonly testID: string;
}) {
    return (
        <View className="min-h-[30px] flex-row items-center justify-between gap-snug">
            <Text variant="body" tone="secondary">
                {label}
            </Text>
            <Text testID={testID} variant="strong" tone={tone} className="tabular-nums">
                {value}
            </Text>
        </View>
    );
}

export interface IngredientDetailProps {
    readonly ingredient: IngredientAdmin;
    /** Resolves a category code to its translated name — the list already owns this lookup. */
    readonly categoryName: (code: string) => string;
    readonly onBack: () => void;
    /** Opens the editor. Omit for a reader without manage permission. */
    readonly onEdit?: (() => void) | undefined;
    /** Opens the label page. */
    readonly onPrintLabel: () => void;
    readonly testID: string;
}

export function IngredientDetail({
    ingredient,
    categoryName,
    onBack,
    onEdit,
    onPrintLabel,
    testID,
}: IngredientDetailProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const unit = t(unitShortKey(ingredient.measurementUnit));
    const name = displayName(ingredient.name, locale);
    const separator = t('kitchen:recordView.metaSeparator');

    const money = (amount: { readonly amount: number; readonly currency: string } | null) =>
        amount === null ? dash : formatter.formatCurrency(amount.amount, amount.currency);
    const oneDecimal = (value: number) =>
        formatter.formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    /*
     * `null` whenever either side is missing or the basis is zero — a margin over a price nobody
     * has recorded is the same fiction the meal editor refuses to print, and dividing by a zero
     * unit price would render `Infinity %` on a record whose only fault is being uncosted.
     */
    const marginPercent =
        ingredient.b2bPrice === null ||
        ingredient.unitPrice === null ||
        ingredient.unitPrice.amount === 0
            ? null
            : ((ingredient.b2bPrice.amount - ingredient.unitPrice.amount) /
                  ingredient.unitPrice.amount) *
              100;

    const updatedLine =
        ingredient.meta.updatedByName === null
            ? t('kitchen:editor.lastUpdatedBySeed', {
                  when: formatter.formatRelativeTime(ingredient.meta.updatedAt),
              })
            : t('kitchen:editor.lastUpdatedBy', {
                  when: formatter.formatRelativeTime(ingredient.meta.updatedAt),
                  name: ingredient.meta.updatedByName,
              });

    /*
     * The name in the other language, under the title. The same word twice says nothing, and a
     * reader is still told when the Arabic is missing.
     */
    const otherName = locale === 'ar' ? ingredient.name.en : ingredient.name.ar;
    const titleAside =
        otherName === ''
            ? locale === 'ar'
                ? undefined
                : t('kitchen:bilingual.missingArabic')
            : otherName === name.value
              ? undefined
              : otherName;
    const compositionEmpty =
        ingredient.composition === null || ingredient.composition.trim() === '';
    const notesEmpty = ingredient.notes === null || ingredient.notes.trim() === '';
    const assetId = ingredientStockPhotoId(ingredient);
    const uploaded =
        ingredient.photoUrl !== undefined &&
        ingredient.photoUrl !== null &&
        ingredient.photoUrl !== '';

    /* ── nutrition ───────────────────────────────────────────────────────────────────────────── */

    /** The record's figure for a nutrient and its share of the reference, or `null` if unstated. */
    const figureOf = (id: string, nutrientUnit: string) => {
        const amount = ingredient.per100g === null ? null : findAmount(ingredient.per100g, id);
        if (amount === null || amount.unit !== nutrientUnit) return null;
        const precision = coreNutrientDefinition(id)?.precision ?? 1;
        const value = formatter.formatNumber(amount.value, {
            minimumFractionDigits: precision,
            maximumFractionDigits: precision,
        });
        const reference = REFERENCE_INTAKES[id];
        const share = reference === undefined ? null : (amount.value / reference) * 100;
        return {
            value,
            share,
            text:
                share === null
                    ? `${value} ${nutrientUnit}`
                    : t('kitchen:ingredientDetail.nutrientValue', {
                          value,
                          unit: nutrientUnit,
                          percent: formatter.formatNumber(share, { maximumFractionDigits: 0 }),
                      }),
        };
    };

    const energy = figureOf('energy', 'kcal');
    const sodium = figureOf('sodium', 'mg');
    const bars = NUTRIENT_BARS.flatMap((nutrient) => {
        const figure = figureOf(nutrient.id, 'g');
        return figure === null ? [] : [{ ...nutrient, figure }];
    });
    const hasNutrition = energy !== null || sodium !== null || bars.length > 0;

    const split = ENERGY_SPLIT.map((part) => {
        const amount = ingredient.per100g === null ? null : findAmount(ingredient.per100g, part.id);
        return {
            ...part,
            kcal: amount === null || amount.unit !== 'g' ? null : amount.value * part.kcalPerGram,
        };
    });
    const splitTotal = split.reduce((sum, part) => sum + (part.kcal ?? 0), 0);
    const splitShares =
        split.some((part) => part.kcal === null) || splitTotal <= 0
            ? null
            : split.map((part) => ({
                  ...part,
                  percent: formatter.formatNumber(((part.kcal ?? 0) / splitTotal) * 100, {
                      maximumFractionDigits: 0,
                  }),
              }));
    const shareOf = (id: string) => splitShares?.find((part) => part.id === id)?.percent ?? '';

    const nutritionBadges = [
        ...(ingredient.nutritionEstimated === true
            ? [
                  <Badge
                      key="estimated"
                      testID={`${testID}-nutrition-estimated`}
                      tone="warning"
                      label={t('kitchen:nutritionFacts.estimatedBadge')}
                  />,
              ]
            : []),
        ...(ingredient.nutritionDerivedFromVersionId === null
            ? []
            : [
                  <Badge
                      key="derived"
                      testID={`${testID}-nutrition-derived`}
                      tone="info"
                      label={t('kitchen:nutritionFacts.derivedBadge')}
                  />,
              ]),
    ];

    const nutritionTitle = t('kitchen:nutritionFacts.title');

    /* ── allergens ───────────────────────────────────────────────────────────────────────────── */

    const assessed = ingredient.allergens.length > 0 || ingredient.allergensAssessedClear === true;
    const reviewRequired = ingredient.allergenReviewRequired === true;

    return (
        <RecordPopup
            title={name.value}
            kind={t('kitchen:list.viewKind')}
            onClose={onBack}
            actions={[
                {
                    key: 'print-label',
                    label: t('kitchen:barcodes.printLabel'),
                    icon: 'tag',
                    onSelect: onPrintLabel,
                    testID: `${testID}-print-label`,
                },
                ...(onEdit === undefined
                    ? []
                    : [
                          primaryMenuAction(
                              { label: t('kitchen:editor.editTitle'), onPress: onEdit },
                              testID,
                          ),
                      ]),
            ]}
            testID={testID}
        >
            <Cascade space="md" testID={testID}>
                <RecordCanopyHero
                    testID={`${testID}-canopy`}
                    title={name.value}
                    titleAside={titleAside}
                    titleAsideLang={locale === 'ar' ? 'en' : 'ar'}
                    reference={ingredient.reference}
                    status={t(statusShortKey(ingredient.meta.status))}
                    chips={[
                        ingredient.categoryCode === ''
                            ? t('kitchen:list.noCategory')
                            : categoryName(ingredient.categoryCode),
                        ...(ingredient.subcategoryCode === null
                            ? []
                            : [categoryName(ingredient.subcategoryCode)]),
                        t(unitKey(ingredient.measurementUnit)),
                    ]}
                    caption={[
                        updatedLine,
                        t('kitchen:recordView.version', {
                            version: formatter.formatNumber(ingredient.meta.lockVersion),
                        }),
                    ].join(separator)}
                    media={
                        <View className="w-16 overflow-hidden rounded-lg">
                            <EntityImage
                                assetId={assetId}
                                photoUrl={ingredient.photoUrl}
                                seed={String(ingredient.id)}
                                label={name.value}
                                aspect="square"
                                variant="card"
                                decorative
                                testID={`${testID}-photo`}
                            />
                        </View>
                    }
                    figure={{
                        label: t('kitchen:list.columnUnitPrice'),
                        value: money(ingredient.unitPrice),
                        note: t('kitchen:ingredientDetail.perUnitCaption', { unit }),
                    }}
                />

                <RecordTileRow testID={`${testID}-row-safety`}>
                    <RecordTile
                        testID={`${testID}-prices`}
                        title={t('kitchen:ingredientDetail.pricesTitle')}
                    >
                        <View className="flex-col">
                            <ValueRow
                                testID={`${testID}-price-unit`}
                                label={t('kitchen:list.columnUnitPrice')}
                                value={money(ingredient.unitPrice)}
                                tone={ingredient.unitPrice === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-price-b2b`}
                                label={t('kitchen:list.columnB2bPrice')}
                                value={money(ingredient.b2bPrice)}
                                tone={ingredient.b2bPrice === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-price-b2c`}
                                label={t('kitchen:list.columnB2cPrice')}
                                value={money(ingredient.b2cPrice)}
                                tone={ingredient.b2cPrice === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-bought-in`}
                                label={t('kitchen:ingredientDetail.boughtIn')}
                                value={
                                    ingredient.purchaseUnit === null
                                        ? dash
                                        : t(unitKey(ingredient.purchaseUnit))
                                }
                                tone={ingredient.purchaseUnit === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-cost-per-100g`}
                                label={t('kitchen:list.columnCostPer100g')}
                                value={money(ingredient.costPer100g)}
                                tone={ingredient.costPer100g === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-margin`}
                                label={t('kitchen:ingredientDetail.kpiMarginOnCost')}
                                value={
                                    marginPercent === null ? dash : `${oneDecimal(marginPercent)} %`
                                }
                                tone={marginPercent === null ? 'secondary' : 'primary'}
                            />
                            <ValueRow
                                testID={`${testID}-sellable`}
                                label={t('kitchen:ingredientDetail.fieldSellable')}
                                value={t(
                                    ingredient.isSellable
                                        ? 'kitchen:ingredientDetail.sellableYes'
                                        : 'kitchen:ingredientDetail.sellableNo',
                                )}
                            />
                        </View>
                    </RecordTile>

                    <RecordTile
                        testID={`${testID}-allergens`}
                        title={t('kitchen:forms.allergensTitle')}
                    >
                        {assessed ? (
                            <View
                                testID={`${testID}-allergen-list`}
                                role="list"
                                aria-label={t('kitchen:allergenBoard.listLabel')}
                                className="min-h-[68px] flex-row flex-wrap content-start gap-1.5"
                            >
                                {ingredient.allergens.length === 0 ? (
                                    <View role="listitem">
                                        <Badge
                                            testID={`${testID}-allergens-clear`}
                                            tone="success"
                                            label={t('kitchen:allergens.noneBadge')}
                                        />
                                    </View>
                                ) : (
                                    ingredient.allergens.map((mapping) => {
                                        const code = String(mapping.allergenCode);
                                        return (
                                            <View key={code} role="listitem">
                                                <AllergenChip
                                                    testID={`${testID}-allergen-${code}-${mapping.containment}`}
                                                    code={code}
                                                    containment={mapping.containment}
                                                    size="md"
                                                />
                                            </View>
                                        );
                                    })
                                )}
                            </View>
                        ) : (
                            <TileEmpty
                                testID={`${testID}-allergens-not-assessed`}
                                tone="warning"
                                text={t('kitchen:allergens.notAssessed')}
                            />
                        )}
                        <View className="mt-auto flex-col border-t border-stroke-subtle pt-tight">
                            <ValueRow
                                testID={`${testID}-allergens-checked`}
                                label={t('kitchen:ingredientDetail.checkedLabel')}
                                value={t(
                                    reviewRequired
                                        ? 'kitchen:ingredientDetail.checkedReview'
                                        : assessed
                                          ? 'kitchen:ingredientDetail.checkedYes'
                                          : 'kitchen:ingredientDetail.checkedNo',
                                )}
                                tone={reviewRequired || !assessed ? 'warning' : 'primary'}
                            />
                            <View className="min-h-[30px] flex-row flex-wrap items-center justify-between gap-snug">
                                <Text variant="body" tone="secondary">
                                    {t('kitchen:allergenBoard.diets')}
                                </Text>
                                {ingredient.dietClassifications.length === 0 ? (
                                    <Text
                                        variant="strong"
                                        tone="secondary"
                                        testID={`${testID}-no-diets`}
                                    >
                                        {dash}
                                    </Text>
                                ) : (
                                    <View className="flex-row flex-wrap gap-1.5">
                                        {ingredient.dietClassifications.map((diet) => (
                                            <Badge
                                                key={diet}
                                                tone="brand"
                                                icon="check"
                                                label={t(`marketplace:diets.${diet}`)}
                                                testID={`${testID}-diet`}
                                            />
                                        ))}
                                    </View>
                                )}
                            </View>
                        </View>
                    </RecordTile>
                </RecordTileRow>

                <RecordTile
                    testID={`${testID}-nutrition`}
                    title={nutritionTitle}
                    aside={nutritionBadges.length === 0 ? undefined : nutritionBadges}
                    trailing={
                        <InfoTip
                            label={nutritionTitle}
                            text={t('kitchen:ingredientDetail.nutritionSubtitle')}
                        />
                    }
                >
                    {!hasNutrition ? (
                        <TileEmpty
                            testID={`${testID}-nutrition-empty`}
                            text={t('kitchen:ingredientDetail.nutritionEmpty')}
                        />
                    ) : (
                        <>
                            <View className="flex-row flex-wrap items-center gap-6">
                                <View className="items-center gap-1">
                                    <View className="h-28 w-28 items-center justify-center rounded-full bg-surface-brand-subtle">
                                        <RNText
                                            testID={`${testID}-energy`}
                                            className="font-display text-3xl font-bold tabular-nums text-content-on-brand-subtle"
                                        >
                                            {energy?.value ?? dash}
                                        </RNText>
                                        <RNText className="text-role-label font-semibold text-content-on-brand-subtle">
                                            {t('kitchen:nutritionFacts.unitKcal')}
                                        </RNText>
                                    </View>
                                    {energy?.share == null ? null : (
                                        <Text variant="caption" tone="secondary">
                                            {t('kitchen:ingredientDetail.energyShareOfRi', {
                                                percent: formatter.formatNumber(energy.share, {
                                                    maximumFractionDigits: 0,
                                                }),
                                            })}
                                        </Text>
                                    )}
                                </View>
                                {/* eslint-disable-next-line no-restricted-syntax -- the bars take what the circle leaves. */}
                                <View className="min-w-[280px] flex-1 flex-col gap-2">
                                    {bars.map((bar) => (
                                        <View
                                            key={bar.id}
                                            testID={`${testID}-nutrient-${bar.id}`}
                                            role="img"
                                            aria-label={`${t(bar.labelKey)}: ${bar.figure.text}`}
                                            className="flex-row items-center gap-3"
                                        >
                                            <View className="w-28">
                                                <Text
                                                    variant="label"
                                                    tone="secondary"
                                                    numberOfLines={1}
                                                >
                                                    {t(bar.labelKey)}
                                                </Text>
                                            </View>
                                            {/* eslint-disable-next-line no-restricted-syntax -- the track takes the middle of the row. */}
                                            <View className="h-2.5 min-w-[48px] flex-1 overflow-hidden rounded-full bg-surface-sunken">
                                                {bar.figure.share === null ? null : (
                                                    <View
                                                        className="h-full rounded-full bg-surface-brand"
                                                        style={{
                                                            width: `${String(Math.min(100, bar.figure.share))}%` as DimensionValue,
                                                        }}
                                                    />
                                                )}
                                            </View>
                                            <View className="w-32 items-end">
                                                <Text variant="label" className="tabular-nums">
                                                    {bar.figure.text}
                                                </Text>
                                            </View>
                                        </View>
                                    ))}
                                </View>
                            </View>
                            <View className="flex-col border-t border-stroke-subtle pt-tight">
                                <ValueRow
                                    testID={`${testID}-nutrient-sodium`}
                                    label={t('nutrition:nutrients.sodium')}
                                    value={sodium?.text ?? dash}
                                    tone={sodium === null ? 'secondary' : 'primary'}
                                />
                            </View>
                            {splitShares === null ? null : (
                                <View className="flex-col gap-tight">
                                    <SegmentBar
                                        testID={`${testID}-energy-split`}
                                        label={t('kitchen:ingredientDetail.energySplitLabel', {
                                            fat: shareOf('fat'),
                                            carbohydrate: shareOf('carbohydrate'),
                                            protein: shareOf('protein'),
                                        })}
                                        segments={splitShares.map((part) => ({
                                            key: part.id,
                                            share: part.kcal ?? 0,
                                            tone: part.tone,
                                        }))}
                                    />
                                    <View className="flex-row flex-wrap items-center gap-x-base gap-y-hair">
                                        <Text variant="label" tone="secondary">
                                            {t('kitchen:ingredientDetail.energyFrom')}
                                        </Text>
                                        {splitShares.map((part) => (
                                            <SegmentKey
                                                key={part.id}
                                                tone={part.tone}
                                                label={t('kitchen:ingredientDetail.energyShare', {
                                                    nutrient: t(part.labelKey),
                                                    percent: part.percent,
                                                })}
                                            />
                                        ))}
                                    </View>
                                </View>
                            )}
                            {ingredient.nutritionNote === null ? null : (
                                <View className="flex-row flex-wrap gap-tight">
                                    <Text variant="label">
                                        {t('kitchen:nutritionFacts.noteLabel')}
                                    </Text>
                                    <Text
                                        testID={`${testID}-nutrition-note`}
                                        variant="label"
                                        tone="secondary"
                                    >
                                        {ingredient.nutritionNote}
                                    </Text>
                                </View>
                            )}
                        </>
                    )}
                </RecordTile>

                <RecordTile testID={`${testID}-names`} title={t('kitchen:fields.composition')}>
                    <Text
                        testID={`${testID}-field-composition`}
                        variant="body"
                        tone={compositionEmpty ? 'secondary' : 'primary'}
                    >
                        {compositionEmpty ? dash : ingredient.composition}
                    </Text>
                    <TileFacts
                        testID={`${testID}-field`}
                        facts={[
                            {
                                key: 'aliases',
                                label: t('kitchen:ingredientDetail.aliasesLabel'),
                                value:
                                    ingredient.aliases.length === 0 ? (
                                        dash
                                    ) : (
                                        <View className="flex-row flex-wrap gap-1.5">
                                            {ingredient.aliases.map((alias) => (
                                                <Badge key={alias} tone="neutral" label={alias} />
                                            ))}
                                        </View>
                                    ),
                                empty: ingredient.aliases.length === 0,
                            },
                            {
                                key: 'notes',
                                label: t('kitchen:fields.notes'),
                                value: notesEmpty ? dash : (ingredient.notes ?? dash),
                                empty: notesEmpty,
                            },
                        ]}
                    />
                    {/* The stock picture's licence travels with the record that shows it. */}
                    {uploaded || assetId === undefined ? null : (
                        <PhotoCredit assetId={assetId} testID={`${testID}-photo-credit`} />
                    )}
                </RecordTile>
            </Cascade>
        </RecordPopup>
    );
}
