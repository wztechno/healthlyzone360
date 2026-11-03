import { Card, Stack, Table, Tabs, Text } from '@healthy360/design-system';
import type { TableColumn } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount, precisionFor } from '@healthy360/nutrition';
import type { NutritionFacts } from '@healthy360/nutrition';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { orderedNutrientIds, per100gFacts } from './format.ts';

/**
 * The nutrition-facts panel.
 *
 * ## Two bases, one dataset
 *
 * Per serving is the consumption basis; per 100 g is the *comparison* basis, and it is the only one
 * on which two dishes from two kitchens can be compared at all. Neither reference product publishes
 * a per-100 g view (doc 09 §5), so this is designed from first principles rather than copied. The
 * second basis is derived here rather than fetched, from the mass the facts already carry — and
 * when that mass is unknown the tab says so instead of inventing a density.
 *
 * ## Unless the payload is already per 100 g
 *
 * A listing sold by weight — a bottled sauce, a dressing — arrives with `basis: 'per_100g'` and no
 * serving at all, because the kitchen never stated one (`catalogue.nutrition.per_100g`). There is
 * then no second view to offer: the tabs come off and the table is captioned for what it is. Leaving
 * a "Per serving" tab in place would label a hundred grams of sauce as somebody's portion, which is
 * the fabrication the server refused to make when it chose this basis.
 *
 * ## Provenance, as a customer reads it
 *
 * The panel names where its figures come from, and nothing else of the calculation: the data-set
 * version, the method key, the rounding and the synthetic/prototype badge read as internal noise
 * on a customer surface (owner, 3 Nov 2026), so only the source name stays. The source block is
 * still part of the component rather than an optional prop.
 *
 * The calculation notes are rendered verbatim because that is where the recipe and its version are
 * named. Parsing them into a field would mean the screen inventing a link the consumer contract
 * deliberately does not publish.
 */
export interface NutritionFactsPanelProps {
    readonly facts: NutritionFacts;
    /** Overrides the panel heading — the plan and diet screens borrow this component. */
    readonly title?: string | undefined;
    readonly testID?: string | undefined;
}

type Basis = 'per_serving' | 'per_100g';

interface NutrientRow {
    readonly nutrientId: string;
    readonly name: string;
    readonly amount: string;
}

/** `NO_NUTRITION_FACTS`' method: the API-client fallback for a meal with no stored facts. */
const NO_RECORDED_SOURCE = 'none.no_recorded_source';

export function NutritionFactsPanel({
    facts,
    title,
    testID = 'nutrition-facts',
}: NutritionFactsPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [basis, setBasis] = useState<Basis>('per_serving');

    // Already the comparison basis: one view, no re-basing (a hundred grams of a hundred grams),
    // and `basis` below never leaves `per_serving` because the control that moves it is not rendered.
    const fixedPer100g = facts.basis === 'per_100g';
    const per100g = fixedPer100g ? null : per100gFacts(facts);
    const active = basis === 'per_100g' && per100g !== null ? per100g : facts;

    const rows: readonly NutrientRow[] = orderedNutrientIds(active).map((nutrientId) => {
        const amount = findAmount(active, nutrientId);
        const decimals = precisionFor(nutrientId);
        const value = amount === null ? 0 : amount.value;
        return {
            nutrientId,
            name: t(`marketplace:nutrients.${nutrientId}`, {
                defaultValue: coreNutrientDefinition(nutrientId)?.displayName ?? nutrientId,
            }),
            amount: `${formatter.formatNumber(value, {
                minimumFractionDigits: 0,
                maximumFractionDigits: decimals,
            })} ${amount?.unit ?? ''}`.trim(),
        };
    });

    const columns: readonly TableColumn<NutrientRow>[] = [
        {
            key: 'nutrient',
            header: t('catalogue:facts.nutrient'),
            rowHeader: true,
            flex: 2,
            render: (row) => <Text variant="bodyStrong">{row.name}</Text>,
        },
        {
            key: 'amount',
            header: t('catalogue:facts.amount'),
            numeric: true,
            render: (row) => (
                <Text testID={`${testID}-amount-${row.nutrientId}`}>{row.amount}</Text>
            ),
        },
    ];

    const basisLabel =
        fixedPer100g || (basis === 'per_100g' && per100g !== null)
            ? t('catalogue:facts.per100g')
            : t('catalogue:facts.perServing');

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="md">
                <Text variant="label">{title ?? t('catalogue:facts.title')}</Text>

                {fixedPer100g ? (
                    <Text testID={`${testID}-sold-by-weight`} tone="secondary" variant="caption">
                        {t('catalogue:facts.soldByWeight')}
                    </Text>
                ) : (
                    <Tabs
                        testID={`${testID}-basis`}
                        label={t('catalogue:facts.basisLabel')}
                        variant="segmented"
                        block
                        value={basis}
                        onChange={setBasis}
                        items={[
                            {
                                value: 'per_serving',
                                label: t('catalogue:facts.perServing'),
                                testID: `${testID}-basis-per-serving`,
                            },
                            {
                                value: 'per_100g',
                                label: t('catalogue:facts.per100g'),
                                disabled: per100g === null,
                                testID: `${testID}-basis-per-100g`,
                            },
                        ]}
                    />
                )}

                {basis === 'per_100g' && per100g === null ? (
                    <Text testID={`${testID}-per-100g-unavailable`} tone="secondary">
                        {t('catalogue:facts.per100gUnavailable')}
                    </Text>
                ) : (
                    <Table
                        testID={`${testID}-table`}
                        caption={t('catalogue:facts.caption', { basis: basisLabel })}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.nutrientId}
                    />
                )}

                {/* The source name only: version, method, rounding and the prototype flags are the
                    platform's bookkeeping, not the customer's. A meal with no recorded source has
                    no name to show, and its notes already say so in a sentence. */}
                {active.calculation.method === NO_RECORDED_SOURCE ? null : (
                    <Stack space="xs" testID={`${testID}-source`}>
                        <Text variant="label">{t('catalogue:facts.sourceTitle')}</Text>
                        <Text tone="secondary" variant="caption">
                            {t('catalogue:facts.source', { source: active.source.label })}
                        </Text>
                    </Stack>
                )}

                {active.calculation.notes.length === 0 ? null : (
                    <Stack space="xs" testID={`${testID}-notes`}>
                        <Text variant="label">{t('catalogue:facts.notesTitle')}</Text>
                        {active.calculation.notes.map((note) => (
                            <Text key={note} tone="secondary" variant="caption">
                                {note}
                            </Text>
                        ))}
                    </Stack>
                )}
            </Stack>
        </Card>
    );
}
