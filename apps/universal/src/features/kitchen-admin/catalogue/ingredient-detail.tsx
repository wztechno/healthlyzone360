import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import {
    Badge,
    EmptyState,
    Inline,
    MeterBar,
    RecordWindowFieldGrid,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { RecordWindowField, TagRowItem } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import { useTranslation } from 'react-i18next';

import { displayName, statusShortKey, statusTone, unitDimension, unitShortKey } from '../format.ts';
import { RecordPhoto } from './record-photo.tsx';
import { RecordViewPage } from './record-view-page.tsx';
import type { RecordViewSection } from './record-view-page.tsx';

/**
 * The ingredient record, read at full width — `IngredientView.dc.html`, and the reference use of
 * {@link RecordViewPage}.
 *
 * ```
 * Tahini paste  ING-0142 [ Live ]                  [ ‹ Back to list ] [ ✎ Edit ingredient ]
 * ┌ Identification ──────────────────────┐  ┌ Record status ───┐
 * ┌ Nutrition per 100 g ─────────────────┐  ┌ Allergens & diets┐
 * ┌ Used in recipes ─────────────────────┐  ┌ Pack & sourcing ─┐
 * ┌ Made from ───────────────────────────┐
 * ```
 *
 * ## Edit is on the page now
 *
 * The design gives the record two ways into the editor — the header's primary and the status
 * card's block button — and they are the same action. The page never writes, so the dirty state
 * still has exactly one owner: the editor it hands off to. Without manage permission neither is
 * drawn.
 *
 * ## The meters are shares of a published reference, not a verdict
 *
 * The design draws each nutrient against an adult reference intake. Those figures are the EU
 * Reference Intakes (Regulation (EU) No 1169/2011, Annex XIII Part B), with sodium as the salt RI
 * divided by 2.5. The design also tags each bar "Good source" / "High" / "Low"; nothing in
 * `@healthy360/nutrition` classifies a single ingredient's per-100 g figure that way, so the bar
 * states the share it is and no level is invented for it. Fibre has no RI and is not drawn.
 *
 * ## Where-used has no source yet, and says so
 *
 * `IngredientAdmin` carries nothing for **where an ingredient is used** — there is no repository
 * method behind it. Rather than draw a plausible table of invented rows, the card renders the
 * `prototype` empty state, which is what plan §16 says an unbuilt area looks like.
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

    const money = (amount: { readonly amount: number; readonly currency: string } | null) =>
        amount === null ? dash : formatter.formatCurrency(amount.amount, amount.currency);
    const perUnit = (amount: { readonly amount: number; readonly currency: string } | null) =>
        amount === null
            ? dash
            : t('kitchen:ingredientDetail.perUnitValue', { price: money(amount), unit });

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

    const oneDecimal = (value: number) =>
        formatter.formatNumber(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

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
     * Every field the list also draws as a column is labelled with the *column's* key, not a key of
     * its own. The view is the row opened up, and a reader who scanned "Item" and "Cost / 100 g"
     * down the table should find the same words here — two names for one field read as two fields.
     * Fields with no column (the other-language name, margin, pack contents) keep their own.
     */
    const identification: readonly RecordWindowField[] = [
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            value: ingredient.reference ?? dash,
            mono: true,
        },
        {
            key: 'name',
            label: t('kitchen:list.columnItem'),
            value: name.value,
        },
        {
            key: 'name-other',
            label: t('kitchen:ingredientDetail.fieldOtherName'),
            value: (locale === 'ar' ? ingredient.name.en : ingredient.name.ar) || dash,
        },
        {
            key: 'category',
            label: t('kitchen:list.columnCategory'),
            value:
                ingredient.categoryCode === ''
                    ? t('kitchen:list.noCategory')
                    : categoryName(ingredient.categoryCode),
        },
        {
            key: 'subcategory',
            label: t('kitchen:list.columnSubcategory'),
            value:
                ingredient.subcategoryCode === null
                    ? t('kitchen:fields.subcategoryNone')
                    : categoryName(ingredient.subcategoryCode),
        },
        { key: 'unit', label: t('kitchen:list.columnUnit'), value: unit },
        {
            key: 'unit-price',
            label: t('kitchen:list.columnUnitPrice'),
            value: perUnit(ingredient.unitPrice),
            mono: true,
        },
        {
            key: 'cost-per-100g',
            label: t('kitchen:list.columnCostPer100g'),
            value: money(ingredient.costPer100g),
            mono: true,
        },
        {
            key: 'b2b',
            label: t('kitchen:list.columnB2bPrice'),
            value: perUnit(ingredient.b2bPrice),
            mono: true,
        },
        {
            key: 'b2c',
            label: t('kitchen:list.columnB2cPrice'),
            value: perUnit(ingredient.b2cPrice),
            mono: true,
        },
        {
            key: 'margin',
            label: t('kitchen:ingredientDetail.kpiMarginOnCost'),
            value:
                marginPercent === null
                    ? t('kitchen:sale.marginNoBasis')
                    : `${oneDecimal(marginPercent)} %`,
            mono: marginPercent !== null,
        },
        {
            key: 'sellable',
            label: t('kitchen:ingredientDetail.fieldSellable'),
            value: t(
                ingredient.isSellable
                    ? 'kitchen:ingredientDetail.sellableYes'
                    : 'kitchen:ingredientDetail.sellableNo',
            ),
        },
    ];

    const sourcing: readonly RecordWindowField[] = [
        {
            key: 'purchase-unit',
            label: t('kitchen:list.columnPurchaseUnit'),
            value:
                ingredient.purchaseUnit === null ? dash : t(unitShortKey(ingredient.purchaseUnit)),
        },
        {
            key: 'items-per-unit',
            label: t('kitchen:list.columnItemsPerUnit'),
            value:
                ingredient.itemsPerUnit === null
                    ? dash
                    : formatter.formatNumber(ingredient.itemsPerUnit),
            mono: true,
        },
        {
            key: 'capacity',
            label: t('kitchen:ingredientDetail.fieldCapacity'),
            value:
                ingredient.capacity === null
                    ? dash
                    : `${formatter.formatNumber(ingredient.capacity.quantity)} ${t(unitShortKey(ingredient.capacity.unit))}`,
            mono: true,
        },
        // A mass unit needs no density — a kilogram weighs a kilogram — so the row is drawn only
        // where it can be true.
        ...(unitDimension(ingredient.measurementUnit) === 'mass'
            ? []
            : [
                  {
                      key: 'grams-per-unit',
                      label: t('kitchen:list.columnGramsPerUnit'),
                      value:
                          ingredient.gramsPerUnit === null
                              ? dash
                              : formatter.formatNumber(ingredient.gramsPerUnit),
                      mono: true,
                  },
              ]),
        {
            key: 'pack-cost',
            label: t('kitchen:ingredientDetail.fieldPackCost'),
            value: money(ingredient.purchasePrice),
            mono: true,
        },
        {
            key: 'waste',
            label: t('kitchen:ingredientDetail.fieldWaste'),
            value:
                ingredient.wastePercent === null
                    ? dash
                    : `${oneDecimal(ingredient.wastePercent)} %`,
            mono: ingredient.wastePercent !== null,
        },
    ];

    const meters = REFERENCE_INTAKES.flatMap((reference) => {
        const amount =
            ingredient.per100g === null ? null : findAmount(ingredient.per100g, reference.id);
        if (amount === null || amount.unit !== reference.unit) return [];
        const precision = coreNutrientDefinition(reference.id)?.precision ?? 1;
        const percent = (amount.value / reference.value) * 100;
        return [
            <MeterBar
                key={reference.id}
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
            />,
        ];
    });

    const tags: readonly TagRowItem[] = [
        ...ingredient.allergens.map((mapping) => ({
            key: `allergen-${mapping.allergenCode}`,
            label: t(`marketplace:allergens.${mapping.allergenCode}`, {
                defaultValue: mapping.allergenCode,
            }),
            tone: mapping.containment === 'contains' ? ('danger' as const) : ('warning' as const),
        })),
        ...ingredient.dietClassifications.map((diet) => ({
            key: `diet-${diet}`,
            label: t(`marketplace:diets.${diet}`),
            tone: 'brand' as const,
        })),
    ];

    const sections: RecordViewSection[] = [
        {
            key: 'nutrition',
            title: t('kitchen:nutritionFacts.title'),
            subtitle: t('kitchen:ingredientDetail.nutritionSubtitle'),
            content: (
                <Stack space="sm">
                    {ingredient.nutritionEstimated === true ||
                    ingredient.nutritionDerivedFromVersionId !== null ? (
                        <Inline space="xs" align="center" wrap>
                            {ingredient.nutritionEstimated !== true ? null : (
                                <Badge
                                    testID={`${testID}-nutrition-estimated`}
                                    tone="warning"
                                    label={t('kitchen:nutritionFacts.estimatedBadge')}
                                />
                            )}
                            {ingredient.nutritionDerivedFromVersionId === null ? null : (
                                <Badge
                                    testID={`${testID}-nutrition-derived`}
                                    tone="info"
                                    label={t('kitchen:nutritionFacts.derivedBadge')}
                                />
                            )}
                        </Inline>
                    ) : null}
                    {meters.length === 0 ? (
                        <Text testID={`${testID}-nutrition-empty`} tone="secondary">
                            {t('kitchen:ingredientDetail.nutritionEmpty')}
                        </Text>
                    ) : (
                        meters
                    )}
                    {ingredient.nutritionNote === null ? null : (
                        <Text
                            testID={`${testID}-nutrition-note`}
                            variant="caption"
                            tone="secondary"
                        >
                            {ingredient.nutritionNote}
                        </Text>
                    )}
                </Stack>
            ),
        },
        {
            key: 'used-in',
            title: t('kitchen:ingredientDetail.usedInTitle'),
            subtitle: t('kitchen:ingredientDetail.usedInSubtitle'),
            content: (
                <EmptyState
                    testID={`${testID}-where-used`}
                    variant="prototype"
                    title={t('kitchen:ingredientDetail.whereUsedTitle')}
                    body={t('kitchen:ingredientDetail.whereUsedBody')}
                />
            ),
        },
        ...(ingredient.composition === null || ingredient.composition.trim() === ''
            ? []
            : [
                  {
                      key: 'made-from',
                      title: t('kitchen:fields.composition'),
                      content: (
                          <Text testID={`${testID}-composition`} tone="secondary">
                              {ingredient.composition}
                          </Text>
                      ),
                  },
              ]),
    ];

    return (
        <RecordViewPage
            testID={testID}
            title={name.value}
            media={
                <RecordPhoto
                    assetId={`ingredient-${ingredient.slug}`}
                    label={name.value}
                    shape="square"
                    testID={`${testID}-photo`}
                />
            }
            kind={t('kitchen:list.viewKind')}
            {...(ingredient.reference === null ? {} : { reference: ingredient.reference })}
            status={{
                label: t(statusShortKey(ingredient.meta.status)),
                tone: statusTone(ingredient.meta.status),
            }}
            onBack={onBack}
            fieldsTitle={t('kitchen:ingredientDetail.identificationTitle')}
            fieldsSubtitle={t('kitchen:ingredientDetail.identificationSubtitle')}
            fields={identification}
            sections={sections}
            statusLines={[
                updatedLine,
                t('kitchen:recordView.version', {
                    version: formatter.formatNumber(ingredient.meta.lockVersion),
                }),
            ]}
            chipsLabel={t('kitchen:ingredientDetail.allergensDietsTitle')}
            chipsSourceBadge={t('kitchen:list.viewAllergensSource')}
            chipsCaption={t('kitchen:list.viewAllergensCaption')}
            chipsContent={
                tags.length === 0 ? (
                    <Text tone="secondary">{t('kitchen:list.noAllergens')}</Text>
                ) : undefined
            }
            chips={tags}
            rail={[
                {
                    key: 'sourcing',
                    title: t('kitchen:ingredientDetail.sourcingTitle'),
                    content: (
                        <RecordWindowFieldGrid fields={sourcing} testID={`${testID}-sourcing`} />
                    ),
                },
            ]}
            {...(onEdit === undefined
                ? {}
                : { primaryAction: { label: t('kitchen:editor.editTitle'), onPress: onEdit } })}
        />
    );
}
