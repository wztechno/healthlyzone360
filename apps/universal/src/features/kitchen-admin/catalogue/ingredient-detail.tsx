import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import type { ReactNode } from 'react';
import { Cascade, InfoTip, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';
import type { DimensionValue } from 'react-native';

import { PhotoCredit } from '../../../media/photo-credit.tsx';
import { displayName, statusShortKey, statusTone, unitKey, unitShortKey } from '../format.ts';
import { DeskChip } from '../desk-kit/desk-chip.tsx';
import { allergenLabel } from '../ops-format.ts';
import { ingredientStockPhotoId } from './ingredient-photo.ts';
import { primaryMenuAction, RecordPopup } from './record-popup.tsx';
import {
    RecordFigures,
    RecordSheetHead,
    RecordThumb,
    SheetCard,
    SheetColumns,
    SheetFacts,
    SheetTagRows,
    SheetText,
} from './record-sheet.tsx';
import type { SheetFigure } from './record-sheet.tsx';
import { TileEmpty } from './record-tiles.tsx';
import { SegmentBar, SegmentKey } from './segment-bar.tsx';

/**
 * The ingredient record, in its pop-up — option A of the `Record pop-up — no canopy` canvas
 * (2026-11-17), which took the green band away.
 *
 * ```
 * INGREDIENT [ING-221]                                                                 ✕
 * [photo] Tahini                                                           LAST CHANGED
 *         طحينة                                                             2 days ago
 *         (Published) (For sale) (Nut & Seed › Seed) (Kilogram)     by Hala · Version 7
 * ┌ UNIT PRICE ─┬ COST / 100 G ┬ B2B PRICE ──────────┬ B2C PRICE ─┬ ENERGY ──────┐
 * │ $13.13      │ $1.31        │ $16.00             │ $19.50     │ 595 kcal     │
 * │ per kg      │              │ per kg · margin 22%│ per kg     │ per 100 g    │
 * └─────────────┴──────────────┴────────────────────┴────────────┴──────────────┘
 * ┌ Allergens and diets ──────────────────────────────────────────────────────────┐
 * │ Contains     (Sesame)                                                         │
 * │ May contain  (Peanuts)                                                        │
 * │ Diets        (Vegan) (Gluten free)                                            │
 * ┌ Nutrition per 100 g (Estimated) (i) ┐ ┌ Composition ───────────────────────────┐
 * │ 595 kcal                  30 % RI   │ ┌ Details ───────────────────────────────┐
 * │ Fat        ▓▓▓▓▓▓░  53.8 g    77 %  │ │ Bought in · Also called · Notes        │
 * ```
 *
 * ## Only what an `IngredientAdmin` carries
 *
 * Every figure on the page is a field of the record, or arithmetic on two of them: the prices and
 * energy lead in the strip, the margin rides under the B2B price, and for sale is a chip on the
 * head.
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
 * every bar takes the same quiet fill and states the share it is. Fibre has no RI: its figure is
 * stated and its track stays empty.
 *
 * The energy split under the rows is the fat, carbohydrate and protein the record states, at
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

/** The rows, in the order a nutrition label reads; "of which" rows sit under their parent. */
const NUTRIENT_ROWS: readonly {
    readonly id: string;
    readonly unit: 'g' | 'mg';
    readonly labelKey: string;
    readonly sub?: boolean;
}[] = [
    { id: 'fat', unit: 'g', labelKey: 'nutrition:nutrients.fat' },
    { id: 'saturated_fat', unit: 'g', labelKey: 'nutrition:nutrients.saturatedFat', sub: true },
    { id: 'carbohydrate', unit: 'g', labelKey: 'nutrition:nutrients.carbohydrate' },
    { id: 'sugars', unit: 'g', labelKey: 'nutrition:nutrients.sugars', sub: true },
    { id: 'fibre', unit: 'g', labelKey: 'nutrition:nutrients.fibre' },
    { id: 'protein', unit: 'g', labelKey: 'nutrition:nutrients.protein' },
    { id: 'sodium', unit: 'mg', labelKey: 'nutrition:nutrients.sodium' },
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

export interface IngredientDetailProps {
    readonly ingredient: IngredientAdmin;
    /** Resolves a category code to its translated name — the list already owns this lookup. */
    readonly categoryName: (code: string) => string;
    readonly onBack: () => void;
    /** Opens the editor. Omit for a reader without manage permission. */
    readonly onEdit?: (() => void) | undefined;
    /** Opens the label page. */
    readonly onPrintLabel: () => void;
    /** The Back pill to the page that opened the record (Requirements), drawn in the bar. */
    readonly leading?: ReactNode;
    readonly testID: string;
}

export function IngredientDetail({
    ingredient,
    categoryName,
    onBack,
    onEdit,
    onPrintLabel,
    leading,
    testID,
}: IngredientDetailProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const dash = t('kitchen:list.noValue');
    const unit = t(unitShortKey(ingredient.measurementUnit));
    const name = displayName(ingredient.name, locale);
    const separator = t('kitchen:recordView.metaSeparator');
    const perUnit = t('kitchen:ingredientDetail.perUnitCaption', { unit });

    const money = (amount: { readonly amount: number; readonly currency: string } | null) =>
        amount === null ? dash : formatter.formatCurrency(amount.amount, amount.currency);
    const wholePercent = (value: number) =>
        formatter.formatNumber(value, { maximumFractionDigits: 0 });

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

    const changedNote = [
        ...(ingredient.meta.updatedByName === null
            ? []
            : [t('kitchen:recordSheet.byName', { name: ingredient.meta.updatedByName })]),
        t('kitchen:recordView.version', {
            version: formatter.formatNumber(ingredient.meta.lockVersion),
        }),
    ].join(separator);

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

    const filing = [
        ingredient.categoryCode === ''
            ? t('kitchen:list.noCategory')
            : categoryName(ingredient.categoryCode),
        ...(ingredient.subcategoryCode === null ? [] : [categoryName(ingredient.subcategoryCode)]),
    ].join(t('kitchen:recordView.pathSeparator'));

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
                          percent: wholePercent(share),
                      }),
        };
    };

    const energy = figureOf('energy', 'kcal');
    const rows = NUTRIENT_ROWS.flatMap((nutrient) => {
        const figure = figureOf(nutrient.id, nutrient.unit);
        return figure === null ? [] : [{ ...nutrient, figure }];
    });
    const hasNutrition = energy !== null || rows.length > 0;
    const kcal = t('kitchen:nutritionFacts.unitKcal');

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
                  percent: wholePercent(((part.kcal ?? 0) / splitTotal) * 100),
              }));
    const shareOf = (id: string) => splitShares?.find((part) => part.id === id)?.percent ?? '';

    const nutritionBadges = [
        ...(ingredient.nutritionEstimated === true
            ? [
                  <DeskChip
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
                  <DeskChip
                      key="derived"
                      testID={`${testID}-nutrition-derived`}
                      tone="info"
                      label={t('kitchen:nutritionFacts.derivedBadge')}
                  />,
              ]),
    ];

    const nutritionTitle = t('kitchen:nutritionFacts.title');

    /* ── the figures ─────────────────────────────────────────────────────────────────────────── */

    const priceFigure = (
        key: string,
        label: string,
        amount: { readonly amount: number; readonly currency: string } | null,
        note: string | undefined,
    ): SheetFigure => ({
        key,
        label,
        value: money(amount),
        ...(note === undefined ? {} : { note }),
        ...(amount === null ? { tone: 'muted' as const } : {}),
        valueTestID: `${testID}-${key}`,
    });

    const figures: readonly SheetFigure[] = [
        priceFigure('price-unit', t('kitchen:list.columnUnitPrice'), ingredient.unitPrice, perUnit),
        priceFigure(
            'cost-per-100g',
            t('kitchen:list.columnCostPer100g'),
            ingredient.costPer100g,
            undefined,
        ),
        priceFigure(
            'price-b2b',
            t('kitchen:list.columnB2bPrice'),
            ingredient.b2bPrice,
            marginPercent === null
                ? perUnit
                : t('kitchen:recordSheet.marginNote', {
                      unit,
                      percent: formatter.formatNumber(marginPercent, {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                      }),
                  }),
        ),
        priceFigure('price-b2c', t('kitchen:list.columnB2cPrice'), ingredient.b2cPrice, perUnit),
        {
            key: 'energy',
            label: t('nutrition:nutrients.energy'),
            value: energy === null ? dash : `${energy.value} ${kcal}`,
            note: t('kitchen:recordSheet.perHundredGrams'),
            ...(energy === null ? { tone: 'muted' as const } : {}),
            valueTestID: `${testID}-energy`,
        },
    ];

    /* ── allergens ───────────────────────────────────────────────────────────────────────────── */

    const assessed = ingredient.allergens.length > 0 || ingredient.allergensAssessedClear === true;
    const reviewRequired = ingredient.allergenReviewRequired === true;
    const quiet = (key: string) => (
        <RNText testID={`${testID}-${key}`} className="pt-1 text-base text-content-secondary">
            {dash}
        </RNText>
    );
    const allergenChips = (containment: 'contains' | 'may_contain') => {
        const found = ingredient.allergens.filter((mapping) => mapping.containment === containment);
        return found.length === 0
            ? quiet(`allergens-${containment}-none`)
            : found.map((mapping) => {
                  const code = String(mapping.allergenCode);
                  return (
                      <DeskChip
                          key={code}
                          testID={`${testID}-allergen-${code}-${containment}`}
                          tone={containment === 'contains' ? 'danger' : 'warning'}
                          size="lg"
                          label={allergenLabel(code, t)}
                      />
                  );
              });
    };

    const allergensCard = (
        <SheetCard
            testID={`${testID}-allergens`}
            title={t('kitchen:recordSheet.allergensAndDiets')}
        >
            {assessed ? null : (
                <TileEmpty
                    testID={`${testID}-allergens-not-assessed`}
                    tone="warning"
                    text={t('kitchen:allergens.notAssessed')}
                />
            )}
            <SheetTagRows
                testID={`${testID}-allergen-list`}
                rows={[
                    ...(assessed
                        ? [
                              {
                                  key: 'contains',
                                  label: t('kitchen:recordSheet.contains'),
                                  content:
                                      ingredient.allergens.length === 0 ? (
                                          <DeskChip
                                              testID={`${testID}-allergens-clear`}
                                              tone="success"
                                              size="lg"
                                              label={t('kitchen:allergens.noneBadge')}
                                          />
                                      ) : (
                                          allergenChips('contains')
                                      ),
                              },
                              {
                                  key: 'may-contain',
                                  label: t('kitchen:recordSheet.mayContain'),
                                  content: allergenChips('may_contain'),
                              },
                          ]
                        : []),
                    {
                        key: 'diets',
                        label: t('kitchen:allergenBoard.diets'),
                        content:
                            ingredient.dietClassifications.length === 0
                                ? quiet('no-diets')
                                : ingredient.dietClassifications.map((diet) => (
                                      <DeskChip
                                          key={diet}
                                          testID={`${testID}-diet-${diet}`}
                                          tone="info"
                                          size="lg"
                                          label={t(`marketplace:diets.${diet}`)}
                                      />
                                  )),
                    },
                    {
                        key: 'checked',
                        label: t('kitchen:ingredientDetail.checkedLabel'),
                        content: (
                            <RNText
                                testID={`${testID}-allergens-checked`}
                                className={`pt-1 text-base font-semibold ${
                                    reviewRequired || !assessed
                                        ? 'text-warning-strong'
                                        : 'text-content-primary'
                                }`}
                            >
                                {t(
                                    reviewRequired
                                        ? 'kitchen:ingredientDetail.checkedReview'
                                        : assessed
                                          ? 'kitchen:ingredientDetail.checkedYes'
                                          : 'kitchen:ingredientDetail.checkedNo',
                                )}
                            </RNText>
                        ),
                    },
                ]}
            />
        </SheetCard>
    );

    /* ── nutrition card ──────────────────────────────────────────────────────────────────────── */

    const nutritionCard = (
        <SheetCard
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
                    {/* The energy line: one figure, then its share of the day. */}
                    <View className="flex-row items-baseline gap-2 rounded-xl border border-stroke-subtle bg-surface-sunken px-4 py-3">
                        <RNText
                            testID={`${testID}-energy-line`}
                            className="font-display text-3xl font-bold tabular-nums text-content-primary"
                        >
                            {energy?.value ?? dash}
                        </RNText>
                        <RNText className="text-sm font-semibold text-content-secondary">
                            {kcal}
                        </RNText>
                        {energy?.share == null ? null : (
                            <RNText className="ms-auto text-sm font-semibold tabular-nums text-content-primary">
                                {t('kitchen:ingredientDetail.energyShareOfRi', {
                                    percent: wholePercent(energy.share),
                                })}
                            </RNText>
                        )}
                    </View>

                    {/* One row a nutrient: name, its share as a bar, the amount, the % RI. */}
                    <View className="overflow-hidden">
                        <View className="-mt-px flex-col">
                            {rows.map((row) => (
                                <View
                                    key={row.id}
                                    testID={`${testID}-nutrient-${row.id}`}
                                    role="img"
                                    aria-label={`${t(row.labelKey)}: ${row.figure.text}`}
                                    className="min-h-10 flex-row items-center gap-3 border-t border-stroke-subtle"
                                >
                                    {/* eslint-disable-next-line no-restricted-syntax -- the name takes what the fixed columns leave. */}
                                    <View className="min-w-0 flex-1">
                                        <RNText
                                            numberOfLines={1}
                                            className={`text-sm text-start ${
                                                row.sub === true
                                                    ? 'text-content-secondary'
                                                    : 'font-semibold text-content-primary'
                                            }`}
                                        >
                                            {t(row.labelKey)}
                                        </RNText>
                                    </View>
                                    <View className="h-1.5 w-20 overflow-hidden rounded-full bg-stroke-subtle">
                                        {row.figure.share === null ? null : (
                                            <View
                                                className="h-full rounded-full bg-content-secondary"
                                                style={{
                                                    width: `${String(Math.min(100, row.figure.share))}%` as DimensionValue,
                                                }}
                                            />
                                        )}
                                    </View>
                                    <RNText className="w-20 text-end text-sm font-semibold tabular-nums text-content-primary">
                                        {`${row.figure.value} ${row.unit}`}
                                    </RNText>
                                    <RNText className="w-12 text-end text-sm font-semibold tabular-nums text-content-secondary">
                                        {row.figure.share === null
                                            ? dash
                                            : `${wholePercent(row.figure.share)} %`}
                                    </RNText>
                                </View>
                            ))}
                        </View>
                    </View>

                    {splitShares === null ? null : (
                        <View className="flex-col gap-tight pt-1">
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
                            <Text variant="label">{t('kitchen:nutritionFacts.noteLabel')}</Text>
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
        </SheetCard>
    );

    return (
        <RecordPopup
            title={name.value}
            kind={t('kitchen:list.viewKind')}
            onClose={onBack}
            leading={leading}
            reference={ingredient.reference}
            referenceTestID={`${testID}-reference`}
            sheet
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
                <RecordSheetHead
                    testID={`${testID}-head`}
                    title={name.value}
                    titleAside={titleAside}
                    titleAsideLang={locale === 'ar' ? 'en' : 'ar'}
                    media={
                        <RecordThumb
                            assetId={assetId}
                            photoUrl={ingredient.photoUrl}
                            label={name.value}
                            seed={String(ingredient.id)}
                            testID={`${testID}-photo`}
                        />
                    }
                    chips={[
                        {
                            key: 'status',
                            label: t(statusShortKey(ingredient.meta.status)),
                            tone: statusTone(ingredient.meta.status),
                            testID: `${testID}-status`,
                        },
                        {
                            key: 'sellable',
                            label: t(
                                ingredient.isSellable
                                    ? 'kitchen:recordSheet.forSale'
                                    : 'kitchen:recordSheet.notForSale',
                            ),
                            tone: ingredient.isSellable ? 'info' : 'neutral',
                            testID: `${testID}-sellable`,
                        },
                        { key: 'filing', label: filing, tone: 'neutral' },
                        {
                            key: 'unit',
                            label: t(unitKey(ingredient.measurementUnit)),
                            tone: 'neutral',
                        },
                    ]}
                    changed={{
                        label: t('kitchen:recordSheet.lastChanged'),
                        value: formatter.formatRelativeTime(ingredient.meta.updatedAt),
                        note: changedNote,
                        valueTestID: `${testID}-changed-when`,
                    }}
                />

                <RecordFigures testID={`${testID}-figures`} figures={figures} />

                <SheetColumns
                    testID={`${testID}-body`}
                    top={allergensCard}
                    start={nutritionCard}
                    end={
                        <>
                            <SheetCard
                                testID={`${testID}-composition`}
                                title={t('kitchen:fields.composition')}
                            >
                                <SheetText
                                    testID={`${testID}-field-composition`}
                                    text={
                                        compositionEmpty ? dash : (ingredient.composition ?? dash)
                                    }
                                    empty={compositionEmpty}
                                />
                            </SheetCard>
                            <SheetCard
                                testID={`${testID}-names`}
                                title={t('kitchen:recordView.details')}
                            >
                                <SheetFacts
                                    testID={`${testID}-field`}
                                    facts={[
                                        {
                                            key: 'bought-in',
                                            label: t('kitchen:ingredientDetail.boughtIn'),
                                            value:
                                                ingredient.purchaseUnit === null
                                                    ? dash
                                                    : t(unitKey(ingredient.purchaseUnit)),
                                            empty: ingredient.purchaseUnit === null,
                                        },
                                        {
                                            key: 'aliases',
                                            label: t('kitchen:ingredientDetail.aliasesLabel'),
                                            value:
                                                ingredient.aliases.length === 0
                                                    ? dash
                                                    : ingredient.aliases.map((alias) => (
                                                          <DeskChip
                                                              key={alias}
                                                              tone="neutral"
                                                              size="lg"
                                                              label={alias}
                                                          />
                                                      )),
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
                            </SheetCard>
                            {/* The stock picture's licence travels with the record that shows it. */}
                            {uploaded || assetId === undefined ? null : (
                                <PhotoCredit assetId={assetId} testID={`${testID}-photo-credit`} />
                            )}
                        </>
                    }
                />
            </Cascade>
        </RecordPopup>
    );
}
