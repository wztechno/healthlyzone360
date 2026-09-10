import type { IngredientAdmin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    EmptyState,
    FormSection,
    Separator,
    Tabs,
    Tag,
    Text,
} from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { displayName, statusShortKey, statusTone, unitShortKey } from '../format.ts';
import { DerivedPanel } from './derived-panel.tsx';
import type { DerivedFigure } from './derived-panel.tsx';

/**
 * The ingredient record, read at full width — the design the row's View action now opens.
 *
 * ## Why this replaced the side panel
 *
 * `CatalogueViewDrawer` answered "what is in this?" in a 400px column, which fits a list of fields
 * and nothing else. An ingredient is not a list of fields: it is a definition, a purchase pack, a
 * sale price, a nutrition panel and a change history, and four of those five are the sort of thing
 * a reader compares rather than skims. A drawer that has to scroll past a nutrition panel to reach
 * a supplier price is a worse answer than a page with five tabs, and the tabs are what let the
 * record grow without the panel growing with it.
 *
 * ## Read-only, and with no way out except back
 *
 * There is no Edit and no Archive here. Both live on the row the reader came from, and a record
 * that can be changed from two places is a record whose dirty state has two owners. This screen
 * states what is true and returns you to the list.
 *
 * ## Three sections have no source yet, and say so
 *
 * `IngredientAdmin` carries the definition, the pack, both list prices and the nutrition panel.
 * It carries nothing for **where an ingredient is used**, **who it is bought from**, or **what
 * changed on it** — there is no repository method behind any of the three (`getIngredient` is the
 * only single-record read). Rather than draw three plausible-looking tables of invented rows, each
 * renders the `prototype` empty state, which is what plan §16 says an unbuilt area looks like.
 * The tab counts are drawn only where a real number exists, for the same reason.
 */

type IngredientTab = 'overview' | 'purchasing' | 'sale' | 'composition' | 'history';

/** The four tiles the composition panel draws, present or absent. Mirrors the editor's own set. */
const PANEL_NUTRIENTS: readonly { readonly id: string; readonly labelKey: string }[] = [
    { id: 'energy', labelKey: 'nutrition:nutrients.energy' },
    { id: 'fat', labelKey: 'nutrition:nutrients.fat' },
    { id: 'carbohydrate', labelKey: 'nutrition:nutrients.carbohydrate' },
    { id: 'protein', labelKey: 'nutrition:nutrients.protein' },
];

export interface IngredientDetailProps {
    readonly ingredient: IngredientAdmin;
    /** Resolves a category code to its translated name — the list already owns this lookup. */
    readonly categoryName: (code: string) => string;
    readonly onBack: () => void;
    readonly testID: string;
}

/* ------------------------------------------------------------------------------------------------
 * Pieces
 * ---------------------------------------------------------------------------------------------- */

/**
 * One figure in the strip under the title.
 *
 * Not `CatalogueStatCards`: those are bordered, marked and pressable because they are the list's
 * filters. These are five facts about one record — a border around each would put five more boxes
 * on a page that already has a panel, and there is nothing to press.
 */
function Kpi({
    label,
    value,
    unit,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly unit?: string | undefined;
    readonly testID: string;
}) {
    return (
        <View testID={testID} className="flex-col gap-hair">
            <Text variant="label" tone="secondary" className="uppercase tracking-widest">
                {label}
            </Text>
            <View className="flex-row items-baseline gap-1">
                <Text testID={`${testID}-value`} variant="bodyStrong">
                    {value}
                </Text>
                {unit === undefined ? null : (
                    <Text variant="caption" tone="secondary">
                        {unit}
                    </Text>
                )}
            </View>
        </View>
    );
}

/** A definition row — label on the inline start, value opposite, hairline under. */
function Row({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: ReactNode;
    readonly testID: string;
}) {
    return (
        <View className="flex-col">
            <View className="flex-row flex-wrap items-baseline gap-base py-tight">
                {/*
                 * `w-48`, not an arbitrary 200px: the label column is a fixed track like a form
                 * field's, and the handoff's rule is that a width comes from the scale rather than
                 * from a number typed into a class.
                 */}
                <Text className="w-48" tone="secondary">
                    {label}
                </Text>
                {/* eslint-disable-next-line no-restricted-syntax -- the row's value column; the exempt case. */}
                <View className="min-w-0 flex-1">
                    {typeof value === 'string' ? (
                        <Text testID={`${testID}-value`}>{value}</Text>
                    ) : (
                        value
                    )}
                </View>
            </View>
            <Separator />
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export function IngredientDetail({
    ingredient,
    categoryName,
    onBack,
    testID,
}: IngredientDetailProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const [tab, setTab] = useState<IngredientTab>('overview');

    const dash = t('kitchen:list.noValue');
    const unit = t(unitShortKey(ingredient.measurementUnit));
    const purchaseUnit =
        ingredient.purchaseUnit === null ? null : t(unitShortKey(ingredient.purchaseUnit));

    const money = (amount: { readonly amount: number; readonly currency: string } | null) =>
        amount === null ? dash : formatter.formatCurrency(amount.amount, amount.currency);

    /*
     * The margin the strip and the Sale tab both state, computed once.
     *
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

    const packQuantity =
        ingredient.capacity === null ? null : formatter.formatNumber(ingredient.capacity.quantity);
    const packUnit =
        ingredient.capacity === null ? null : t(unitShortKey(ingredient.capacity.unit));

    const packSummary =
        ingredient.itemsPerUnit === null || packQuantity === null || packUnit === null
            ? null
            : t('kitchen:ingredientDetail.packSummary', {
                  items: formatter.formatNumber(ingredient.itemsPerUnit),
                  quantity: packQuantity,
                  unit: packUnit,
                  cost: money(ingredient.purchasePrice),
              });

    const figures: readonly DerivedFigure[] = PANEL_NUTRIENTS.flatMap((nutrient) => {
        const definition = coreNutrientDefinition(nutrient.id);
        if (definition === null) return [];
        const amount =
            ingredient.per100g === null ? null : findAmount(ingredient.per100g, nutrient.id);

        return [
            {
                key: nutrient.id,
                label: t(nutrient.labelKey),
                value:
                    amount === null
                        ? null
                        : formatter.formatNumber(amount.value, {
                              minimumFractionDigits: definition.precision,
                              maximumFractionDigits: definition.precision,
                          }),
                unit: t('kitchen:composition.per100g', {
                    unit: amount?.unit ?? definition.unit,
                }),
            },
        ];
    });

    const updatedLine =
        ingredient.meta.updatedByName === null
            ? t('kitchen:editor.lastUpdatedBySeed', {
                  when: formatter.formatRelativeTime(ingredient.meta.updatedAt),
              })
            : t('kitchen:editor.lastUpdatedBy', {
                  when: formatter.formatRelativeTime(ingredient.meta.updatedAt),
                  name: ingredient.meta.updatedByName,
              });

    return (
        <View testID={testID} className="z-auto flex-col gap-loose">
            {/* ── identity ──────────────────────────────────────────────────────────────────── */}
            <View className="flex-col gap-hair">
                <View className="flex-row flex-wrap items-start justify-between gap-base">
                    <View className="min-w-0 flex-col gap-hair">
                        <View className="flex-row flex-wrap items-baseline gap-tight">
                            <Text testID={`${testID}-title`} variant="title">
                                {displayName(ingredient.name, locale).value}
                            </Text>
                            {/*
                             * The second language beside the first, not under it. Both names are
                             * one answer to "what is this called", and a reader checking a delivery
                             * note against the record is reading them together.
                             */}
                            <Text tone="secondary">
                                {locale === 'ar' ? ingredient.name.en : ingredient.name.ar}
                            </Text>
                        </View>

                        <View className="flex-row flex-wrap items-center gap-tight">
                            <Text testID={`${testID}-reference`} tone="secondary">
                                {ingredient.reference ?? dash}
                            </Text>
                            <Text tone="secondary">{'·'}</Text>
                            <Text tone="secondary">
                                {ingredient.categoryCode === ''
                                    ? t('kitchen:list.noCategory')
                                    : categoryName(ingredient.categoryCode)}
                            </Text>
                            {ingredient.subcategoryCode === null ? null : (
                                <Text tone="secondary">
                                    {`· ${categoryName(ingredient.subcategoryCode)}`}
                                </Text>
                            )}
                            <Badge
                                testID={`${testID}-status`}
                                tone={statusTone(ingredient.meta.status)}
                                label={t(statusShortKey(ingredient.meta.status))}
                            />
                        </View>
                    </View>

                    {/*
                     * Back, and nothing else. Edit and Archive belong to the row this was opened
                     * from — see the note at the top of the file.
                     */}
                    <Button
                        testID={`${testID}-back`}
                        variant="secondary"
                        size="sm"
                        label={t('kitchen:ingredientDetail.backToList')}
                        onPress={onBack}
                    />
                </View>
            </View>

            {/* ── the figures the record is opened for ──────────────────────────────────────── */}
            <View className="flex-row flex-wrap gap-loose">
                <Kpi
                    testID={`${testID}-kpi-unit-price`}
                    label={t('kitchen:ingredientDetail.kpiUnitPrice')}
                    value={money(ingredient.unitPrice)}
                    unit={`/ ${unit}`}
                />
                {packSummary === null ? null : (
                    <Kpi
                        testID={`${testID}-kpi-pack`}
                        label={t('kitchen:ingredientDetail.kpiPurchasePack')}
                        value={packSummary}
                    />
                )}
                <Kpi
                    testID={`${testID}-kpi-b2b`}
                    label={t('kitchen:ingredientDetail.kpiB2bPrice')}
                    value={money(ingredient.b2bPrice)}
                    unit={`/ ${unit}`}
                />
                <Kpi
                    testID={`${testID}-kpi-margin`}
                    label={t('kitchen:ingredientDetail.kpiMarginOnCost')}
                    value={marginPercent === null ? dash : `${oneDecimal(marginPercent)} %`}
                    unit={t('kitchen:ingredientDetail.kpiMarginBasis')}
                />
            </View>

            <Tabs
                testID={`${testID}-tabs`}
                label={t('kitchen:ingredientDetail.tabsLabel')}
                value={tab}
                onChange={setTab}
                items={[
                    { value: 'overview', label: t('kitchen:ingredientDetail.tabOverview') },
                    { value: 'purchasing', label: t('kitchen:ingredientDetail.tabPurchasing') },
                    { value: 'sale', label: t('kitchen:ingredientDetail.tabSale') },
                    {
                        value: 'composition',
                        label: t('kitchen:ingredientDetail.tabComposition'),
                        // The one count with a real number behind it.
                        count: ingredient.allergens.length,
                    },
                    { value: 'history', label: t('kitchen:ingredientDetail.tabHistory') },
                ]}
            />

            {tab === 'overview' ? (
                <View className="flex-col gap-loose" testID={`${testID}-overview`}>
                    <FormSection first title={t('kitchen:ingredientDetail.sectionDefinition')}>
                        <View className="flex-col">
                            <Row
                                testID={`${testID}-reference-row`}
                                label={t('kitchen:list.columnReference')}
                                value={ingredient.reference ?? dash}
                            />
                            <Row
                                testID={`${testID}-category-row`}
                                label={t('kitchen:list.columnCategory')}
                                value={
                                    ingredient.categoryCode === ''
                                        ? t('kitchen:list.noCategory')
                                        : categoryName(ingredient.categoryCode)
                                }
                            />
                            <Row
                                testID={`${testID}-subcategory-row`}
                                label={t('kitchen:fields.subcategory')}
                                value={
                                    ingredient.subcategoryCode === null
                                        ? t('kitchen:fields.subcategoryNone')
                                        : categoryName(ingredient.subcategoryCode)
                                }
                            />
                            <Row
                                testID={`${testID}-stock-unit-row`}
                                label={t('kitchen:list.columnUnit')}
                                value={t('kitchen:ingredientDetail.stockUnitValue', { unit })}
                            />
                            <Row
                                testID={`${testID}-purchase-unit-row`}
                                label={t('kitchen:fields.purchaseUnit')}
                                value={
                                    purchaseUnit === null
                                        ? dash
                                        : t('kitchen:ingredientDetail.purchaseUnitValue', {
                                              unit: purchaseUnit,
                                          })
                                }
                            />
                            <Row
                                testID={`${testID}-sellable-row`}
                                label={t('kitchen:ingredientDetail.fieldSellable')}
                                value={t(
                                    ingredient.isSellable
                                        ? 'kitchen:ingredientDetail.sellableYes'
                                        : 'kitchen:ingredientDetail.sellableNo',
                                )}
                            />
                            <Row
                                testID={`${testID}-updated-row`}
                                label={t('kitchen:ingredientDetail.fieldLastChange')}
                                value={updatedLine}
                            />
                        </View>
                    </FormSection>

                    <FormSection title={t('kitchen:ingredientDetail.sectionWhereUsed')}>
                        <EmptyState
                            testID={`${testID}-where-used`}
                            variant="prototype"
                            title={t('kitchen:ingredientDetail.whereUsedTitle')}
                            body={t('kitchen:ingredientDetail.whereUsedBody')}
                        />
                    </FormSection>
                </View>
            ) : null}

            {tab === 'purchasing' ? (
                <View className="flex-col gap-loose" testID={`${testID}-purchasing`}>
                    <FormSection first title={t('kitchen:ingredientDetail.sectionPackCost')}>
                        <View className="flex-col">
                            <Row
                                testID={`${testID}-unit-price-row`}
                                label={t('kitchen:list.columnUnitPrice')}
                                value={money(ingredient.unitPrice)}
                            />
                            <Row
                                testID={`${testID}-items-row`}
                                label={t('kitchen:ingredientDetail.fieldItemsPerUnit')}
                                value={
                                    ingredient.itemsPerUnit === null
                                        ? dash
                                        : formatter.formatNumber(ingredient.itemsPerUnit)
                                }
                            />
                            <Row
                                testID={`${testID}-pack-cost-row`}
                                label={t('kitchen:ingredientDetail.fieldPackCost')}
                                value={
                                    packSummary === null
                                        ? money(ingredient.purchasePrice)
                                        : t('kitchen:ingredientDetail.packCostValue', {
                                              cost: money(ingredient.purchasePrice),
                                              items: formatter.formatNumber(
                                                  ingredient.itemsPerUnit ?? 0,
                                              ),
                                              quantity: packQuantity ?? '',
                                              unit: packUnit ?? '',
                                          })
                                }
                            />
                            <Row
                                testID={`${testID}-purchasing-stock-unit-row`}
                                label={t('kitchen:list.columnUnit')}
                                value={unit}
                            />
                            <Row
                                testID={`${testID}-purchasing-purchase-unit-row`}
                                label={t('kitchen:fields.purchaseUnit')}
                                value={purchaseUnit ?? dash}
                            />
                        </View>
                    </FormSection>

                    <FormSection title={t('kitchen:ingredientDetail.sectionSuppliers')}>
                        <EmptyState
                            testID={`${testID}-suppliers`}
                            variant="prototype"
                            title={t('kitchen:ingredientDetail.suppliersTitle')}
                            body={t('kitchen:ingredientDetail.suppliersBody')}
                        />
                    </FormSection>
                </View>
            ) : null}

            {tab === 'sale' ? (
                <View className="flex-col" testID={`${testID}-sale`}>
                    <FormSection first title={t('kitchen:ingredientDetail.sectionSoldAsIs')}>
                        <View className="flex-col">
                            <Row
                                testID={`${testID}-b2b-row`}
                                label={t('kitchen:sale.b2bPrice')}
                                value={
                                    ingredient.b2bPrice === null
                                        ? dash
                                        : t('kitchen:ingredientDetail.b2bValue', {
                                              price: money(ingredient.b2bPrice),
                                              unit,
                                          })
                                }
                            />
                            <Row
                                testID={`${testID}-b2c-row`}
                                label={t('kitchen:sale.b2cPrice')}
                                value={
                                    ingredient.b2cPrice === null
                                        ? dash
                                        : t('kitchen:ingredientDetail.b2cValue', {
                                              price: money(ingredient.b2cPrice),
                                              unit,
                                          })
                                }
                            />
                            <Row
                                testID={`${testID}-margin-row`}
                                label={t('kitchen:ingredientDetail.kpiMarginOnCost')}
                                value={
                                    marginPercent === null
                                        ? t('kitchen:sale.marginNoBasis')
                                        : t('kitchen:ingredientDetail.marginValue', {
                                              percent: oneDecimal(marginPercent),
                                              basis: money(ingredient.unitPrice),
                                          })
                                }
                            />
                            <Row
                                testID={`${testID}-basis-row`}
                                label={t('kitchen:ingredientDetail.fieldBasis')}
                                value={
                                    ingredient.unitPrice === null
                                        ? dash
                                        : t('kitchen:ingredientDetail.basisValue', {
                                              price: money(ingredient.unitPrice),
                                              unit,
                                          })
                                }
                            />
                        </View>
                    </FormSection>
                </View>
            ) : null}

            {tab === 'composition' ? (
                <View className="flex-col" testID={`${testID}-composition`}>
                    <FormSection
                        first
                        title={t('kitchen:composition.title')}
                        aside={
                            <Badge
                                testID={`${testID}-composition-source`}
                                tone="neutral"
                                label={t('kitchen:composition.fromDatabase')}
                            />
                        }
                    >
                        <DerivedPanel
                            testID={`${testID}-composition-panel`}
                            description={t('kitchen:list.viewAllergensCaption')}
                            figures={figures}
                            emptyValue={dash}
                            chips={
                                ingredient.allergens.length === 0 ? (
                                    <Text tone="secondary">{t('kitchen:list.noAllergens')}</Text>
                                ) : (
                                    ingredient.allergens.map((mapping) => (
                                        <Tag
                                            key={mapping.allergenCode}
                                            testID={`${testID}-allergen-${mapping.allergenCode}`}
                                            tone={
                                                mapping.containment === 'contains'
                                                    ? 'danger'
                                                    : 'warning'
                                            }
                                            label={mapping.allergenCode}
                                        />
                                    ))
                                )
                            }
                        />
                    </FormSection>
                </View>
            ) : null}

            {tab === 'history' ? (
                <View className="flex-col" testID={`${testID}-history`}>
                    <FormSection first title={t('kitchen:ingredientDetail.sectionChangeHistory')}>
                        <EmptyState
                            testID={`${testID}-history-empty`}
                            variant="prototype"
                            title={t('kitchen:ingredientDetail.historyTitle')}
                            body={t('kitchen:ingredientDetail.historyBody')}
                        />
                    </FormSection>
                </View>
            ) : null}
        </View>
    );
}
