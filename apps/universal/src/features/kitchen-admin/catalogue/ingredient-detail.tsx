import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import { Badge, Cascade, InfoTip, MeterBar, Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { EntityImage } from '../../../media/entity-image.tsx';
import { PhotoCredit } from '../../../media/photo-credit.tsx';
import { displayName, statusShortKey, statusTone, unitShortKey } from '../format.ts';
import { AllergenBoard, AllergenBoardKey } from './allergen-board.tsx';
import { ingredientStockPhotoId } from './ingredient-photo.ts';
import { RecordCanopy } from './record-canopy.tsx';
import { RecordPopup } from './record-popup.tsx';
import type { RecordCanopyTone } from './record-canopy.tsx';
import { RecordTile, RecordTileRow, TileEmpty, TileFacts } from './record-tiles.tsx';
import { SegmentBar, SegmentKey } from './segment-bar.tsx';

/**
 * The ingredient record, read at full width — option C of the `Minimal view page` canvas.
 *
 * ```
 * ┌ canopy ───────────────────────────────────────────────────────────────────────────────┐
 * │ [‹ Back] [photo] Tahini paste  طحينة  ● Published      Cost / 100 g  Margin  [Edit]  │
 * └───────────────────────────────────────────────────────────────────────────────────────┘
 * ┌ Allergens & diets ────────────────────────────┐  ┌ Prices ──────────────── per kg ┐
 * ┌ Nutrition per 100 g ──────────────────────────┐  ┌ Names & what it is ────────────┐
 * ```
 *
 * ## Only what an `IngredientAdmin` carries
 *
 * Every figure on the page is a field of the record, or arithmetic on two of them. The old page's
 * Pack & sourcing card is gone: pack cost, waste and pack contents are packaging's figures and are
 * `null` on food. Where-used is gone too — nothing on the record says where it is used, and the
 * old card was a prototype empty state standing in for a feature that does not exist.
 *
 * ## The meters are shares of a published reference, not a verdict
 *
 * Each nutrient is drawn against an adult reference intake — the EU Reference Intakes (Regulation
 * (EU) No 1169/2011, Annex XIII Part B), with sodium as the salt RI divided by 2.5. Nothing in
 * `@healthy360/nutrition` classifies a single ingredient's per-100 g figure as "high" or "low", so
 * every bar takes the same fill and states the share it is. Fibre has no RI and is not drawn.
 *
 * The energy split above the meters is the fat, carbohydrate and protein the record states, at
 * 9 / 4 / 4 kcal a gram, as shares of their sum — drawn only when all three are recorded.
 */

/** EU Reference Intakes for an adult, per day. Keyed by nutrient id, in the nutrient's own unit. */
const REFERENCE_INTAKES: readonly {
    readonly id: string;
    readonly labelKey: string;
    readonly unit: string;
    readonly value: number;
}[] = [
    { id: 'energy', labelKey: 'nutrition:nutrients.energy', unit: 'kcal', value: 2000 },
    { id: 'protein', labelKey: 'nutrition:nutrients.protein', unit: 'g', value: 50 },
    { id: 'fat', labelKey: 'nutrition:nutrients.fat', unit: 'g', value: 70 },
    { id: 'saturated_fat', labelKey: 'nutrition:nutrients.saturatedFat', unit: 'g', value: 20 },
    { id: 'carbohydrate', labelKey: 'nutrition:nutrients.carbohydrate', unit: 'g', value: 260 },
    { id: 'sugars', labelKey: 'nutrition:nutrients.sugars', unit: 'g', value: 90 },
    { id: 'sodium', labelKey: 'nutrition:nutrients.sodium', unit: 'mg', value: 2400 },
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

function canopyTone(tone: BadgeTone): RecordCanopyTone {
    if (tone === 'success' || tone === 'brand') return 'success';
    if (tone === 'warning' || tone === 'danger') return tone;
    return 'neutral';
}

export interface IngredientDetailProps {
    readonly ingredient: IngredientAdmin;
    /** Resolves a category code to its translated name — the list already owns this lookup. */
    readonly categoryName: (code: string) => string;
    readonly onBack: () => void;
    /** Opens the editor. Omit for a reader without manage permission. */
    readonly onEdit?: (() => void) | undefined;
    readonly testID: string;
}

export function IngredientDetail({
    ingredient,
    categoryName,
    onBack,
    onEdit,
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

    const categoryPath =
        ingredient.categoryCode === ''
            ? t('kitchen:list.noCategory')
            : ingredient.subcategoryCode === null
              ? categoryName(ingredient.categoryCode)
              : `${categoryName(ingredient.categoryCode)}${t('kitchen:recordView.pathSeparator')}${categoryName(ingredient.subcategoryCode)}`;

    const otherName = locale === 'ar' ? ingredient.name.en : ingredient.name.ar;
    const assetId = ingredientStockPhotoId(ingredient);
    const uploaded =
        ingredient.photoUrl !== undefined &&
        ingredient.photoUrl !== null &&
        ingredient.photoUrl !== '';

    /* ── prices ──────────────────────────────────────────────────────────────────────────────── */

    const unitAmount = ingredient.unitPrice?.amount ?? null;
    const b2bAmount = ingredient.b2bPrice?.amount ?? null;
    const b2cAmount = ingredient.b2cPrice?.amount ?? null;
    // A ladder only where the three prices climb; anything else would draw a step that is not there.
    const ladder =
        unitAmount !== null &&
        b2bAmount !== null &&
        b2cAmount !== null &&
        unitAmount <= b2bAmount &&
        b2bAmount <= b2cAmount &&
        b2cAmount > 0
            ? ([
                  { key: 'unit', share: unitAmount, tone: 'deep' },
                  { key: 'b2b', share: b2bAmount - unitAmount, tone: 'brand' },
                  { key: 'b2c', share: b2cAmount - b2bAmount, tone: 'info' },
              ] as const)
            : null;
    const prices = [
        {
            key: 'unit',
            tone: 'deep',
            label: t('kitchen:list.columnUnitPrice'),
            value: money(ingredient.unitPrice),
        },
        {
            key: 'b2b',
            tone: 'brand',
            label: t('kitchen:list.columnB2bPrice'),
            value: money(ingredient.b2bPrice),
        },
        {
            key: 'b2c',
            tone: 'info',
            label: t('kitchen:list.columnB2cPrice'),
            value: money(ingredient.b2cPrice),
        },
    ] as const;

    /* ── nutrition ───────────────────────────────────────────────────────────────────────────── */

    const meters = REFERENCE_INTAKES.flatMap((reference) => {
        const amount =
            ingredient.per100g === null ? null : findAmount(ingredient.per100g, reference.id);
        if (amount === null || amount.unit !== reference.unit) return [];
        const precision = coreNutrientDefinition(reference.id)?.precision ?? 1;
        const percent = (amount.value / reference.value) * 100;
        return [
            <View
                key={reference.id}
                className="min-w-0"
                // eslint-disable-next-line no-restricted-syntax -- a meter in a wrapping grid, not a control: two to a line share it.
                style={{ flexBasis: 200, flexGrow: 1 }}
            >
                <MeterBar
                    testID={`${testID}-nutrient-${reference.id}`}
                    label={t(reference.labelKey)}
                    value={amount.value}
                    target={reference.value}
                    unit={reference.unit}
                    valueText={t('kitchen:ingredientDetail.nutrientValue', {
                        value: formatter.formatNumber(amount.value, {
                            minimumFractionDigits: precision,
                            maximumFractionDigits: precision,
                        }),
                        unit: reference.unit,
                        percent: formatter.formatNumber(percent, { maximumFractionDigits: 0 }),
                    })}
                />
            </View>,
        ];
    });

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

    return (
        <RecordPopup
            title={name.value}
            kind={t('kitchen:list.viewKind')}
            onClose={onBack}
            {...(onEdit === undefined
                ? {}
                : { primaryAction: { label: t('kitchen:editor.editTitle'), onPress: onEdit } })}
            testID={testID}
        >
            <Cascade space="md" testID={testID}>
                <RecordCanopy
                    testID={`${testID}-canopy`}
                    title={name.value}
                    titleAside={otherName}
                    titleAsideLang={locale === 'ar' ? 'en' : 'ar'}
                    status={{
                        label: t(statusShortKey(ingredient.meta.status)),
                        tone: canopyTone(statusTone(ingredient.meta.status)),
                    }}
                    captions={[
                        [ingredient.reference, t('kitchen:list.viewKind'), categoryPath]
                            .filter((part): part is string => part !== null && part !== '')
                            .join(separator),
                        [
                            updatedLine,
                            t('kitchen:recordView.version', {
                                version: formatter.formatNumber(ingredient.meta.lockVersion),
                            }),
                        ].join(separator),
                    ]}
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
                    facts={[
                        {
                            key: 'cost-per-100g',
                            label: t('kitchen:list.columnCostPer100g'),
                            value: money(ingredient.costPer100g),
                        },
                        {
                            key: 'margin',
                            label: t('kitchen:ingredientDetail.kpiMarginOnCost'),
                            value: marginPercent === null ? dash : `${oneDecimal(marginPercent)} %`,
                        },
                    ]}
                    noValue={dash}
                />

                <RecordTileRow testID={`${testID}-row-safety`}>
                    <RecordTile
                        testID={`${testID}-allergens`}
                        icon="shield"
                        title={t('kitchen:ingredientDetail.allergensDietsTitle')}
                        trailing={<AllergenBoardKey />}
                        weight={7}
                    >
                        <AllergenBoard
                            testID={`${testID}-allergen-board`}
                            mappings={ingredient.allergens}
                            assessedClear={ingredient.allergensAssessedClear === true}
                            diets={ingredient.dietClassifications.map((diet) =>
                                t(`marketplace:diets.${diet}`),
                            )}
                            noValue={dash}
                        />
                    </RecordTile>

                    <RecordTile
                        testID={`${testID}-prices`}
                        icon="tag"
                        title={t('kitchen:ingredientDetail.pricesTitle')}
                        trailing={
                            <Text variant="label" tone="secondary">
                                {t('kitchen:ingredientDetail.perUnitCaption', { unit })}
                            </Text>
                        }
                        weight={5}
                    >
                        {ladder === null ? null : (
                            <SegmentBar
                                testID={`${testID}-price-ladder`}
                                label={t('kitchen:ingredientDetail.priceLadderLabel', {
                                    unit: money(ingredient.unitPrice),
                                    b2b: money(ingredient.b2bPrice),
                                    b2c: money(ingredient.b2cPrice),
                                })}
                                segments={ladder}
                            />
                        )}
                        <View className="flex-row flex-wrap gap-snug">
                            {prices.map((price) => (
                                <View
                                    key={price.key}
                                    // eslint-disable-next-line no-restricted-syntax -- one of three equal figure columns: the column *is* the row's third.
                                    className="min-w-[96px] flex-1 flex-col gap-0.5"
                                >
                                    <SegmentKey tone={price.tone} label={price.label} />
                                    <Text
                                        testID={`${testID}-price-${price.key}`}
                                        variant="strong"
                                        tone={price.value === dash ? 'secondary' : 'primary'}
                                        className="tabular-nums"
                                    >
                                        {price.value}
                                    </Text>
                                </View>
                            ))}
                        </View>
                        <View className="mt-auto border-t border-stroke-subtle pt-snug">
                            <TileFacts
                                testID={`${testID}-sale`}
                                facts={[
                                    {
                                        key: 'sellable',
                                        label: t('kitchen:ingredientDetail.fieldSellable'),
                                        value: t(
                                            ingredient.isSellable
                                                ? 'kitchen:ingredientDetail.sellableYes'
                                                : 'kitchen:ingredientDetail.sellableNo',
                                        ),
                                    },
                                ]}
                            />
                        </View>
                    </RecordTile>
                </RecordTileRow>

                <RecordTileRow testID={`${testID}-row-make-up`}>
                    <RecordTile
                        testID={`${testID}-nutrition`}
                        icon="leaf"
                        title={nutritionTitle}
                        aside={nutritionBadges.length === 0 ? undefined : nutritionBadges}
                        trailing={
                            <InfoTip
                                label={nutritionTitle}
                                text={t('kitchen:ingredientDetail.nutritionSubtitle')}
                            />
                        }
                        weight={7}
                    >
                        {meters.length === 0 ? (
                            <TileEmpty
                                testID={`${testID}-nutrition-empty`}
                                text={t('kitchen:ingredientDetail.nutritionEmpty')}
                            />
                        ) : (
                            <>
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
                                                    label={t(
                                                        'kitchen:ingredientDetail.energyShare',
                                                        {
                                                            nutrient: t(part.labelKey),
                                                            percent: part.percent,
                                                        },
                                                    )}
                                                />
                                            ))}
                                        </View>
                                    </View>
                                )}
                                <View className="flex-row flex-wrap gap-x-loose gap-y-snug">
                                    {meters}
                                </View>
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

                    <RecordTile
                        testID={`${testID}-names`}
                        icon="languages"
                        title={t('kitchen:ingredientDetail.namesTitle')}
                        weight={5}
                    >
                        <TileFacts
                            testID={`${testID}-field`}
                            facts={[
                                {
                                    key: 'name-en',
                                    label: t('kitchen:bilingual.englishShort', {
                                        field: t('kitchen:list.columnItem'),
                                    }),
                                    value: ingredient.name.en === '' ? dash : ingredient.name.en,
                                    empty: ingredient.name.en === '',
                                },
                                {
                                    key: 'name-ar',
                                    label: t('kitchen:bilingual.arabicShort', {
                                        field: t('kitchen:list.columnItem'),
                                    }),
                                    value:
                                        ingredient.name.ar === ''
                                            ? t('kitchen:bilingual.missingArabic')
                                            : ingredient.name.ar,
                                    empty: ingredient.name.ar === '',
                                },
                                {
                                    key: 'aliases',
                                    label: t('kitchen:ingredientDetail.aliasesLabel'),
                                    value:
                                        ingredient.aliases.length === 0 ? (
                                            dash
                                        ) : (
                                            <View className="flex-row flex-wrap gap-1.5">
                                                {ingredient.aliases.map((alias) => (
                                                    <Badge
                                                        key={alias}
                                                        tone="neutral"
                                                        label={alias}
                                                    />
                                                ))}
                                            </View>
                                        ),
                                    empty: ingredient.aliases.length === 0,
                                },
                                { key: 'unit', label: t('kitchen:list.columnUnit'), value: unit },
                                {
                                    key: 'composition',
                                    label: t('kitchen:fields.composition'),
                                    value:
                                        ingredient.composition === null ||
                                        ingredient.composition.trim() === ''
                                            ? dash
                                            : ingredient.composition,
                                    empty:
                                        ingredient.composition === null ||
                                        ingredient.composition.trim() === '',
                                },
                                {
                                    key: 'notes',
                                    label: t('kitchen:fields.notes'),
                                    value:
                                        ingredient.notes === null || ingredient.notes.trim() === ''
                                            ? dash
                                            : ingredient.notes,
                                    empty:
                                        ingredient.notes === null || ingredient.notes.trim() === '',
                                },
                            ]}
                        />
                        {/* The stock picture's licence travels with the record that shows it. */}
                        {uploaded || assetId === undefined ? null : (
                            <View className="mt-auto">
                                <PhotoCredit assetId={assetId} testID={`${testID}-photo-credit`} />
                            </View>
                        )}
                    </RecordTile>
                </RecordTileRow>
            </Cascade>
        </RecordPopup>
    );
}
