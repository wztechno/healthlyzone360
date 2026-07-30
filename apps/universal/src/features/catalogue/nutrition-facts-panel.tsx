import { Badge, Card, Stack, Table, Tabs, Text } from '@healthy360/design-system';
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
 * ## Provenance is not decoration
 *
 * Doc 09, IMP-06 and IMP-11, and doc 17, NUT-04 and NUT-09, all land on the same requirement:
 * source, version and calculation timestamp on *every* panel, and every synthetic figure visibly
 * labelled synthetic. Neither reference offers any provenance at all. So the source block is part
 * of the component rather than an optional prop — a panel that could be rendered without it is a
 * panel that eventually will be.
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

export function NutritionFactsPanel({
    facts,
    title,
    testID = 'nutrition-facts',
}: NutritionFactsPanelProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const [basis, setBasis] = useState<Basis>('per_serving');

    const per100g = per100gFacts(facts);
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
        basis === 'per_100g' && per100g !== null
            ? t('catalogue:facts.per100g')
            : t('catalogue:facts.perServing');

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="md">
                <Text variant="label">{title ?? t('catalogue:facts.title')}</Text>

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

                <Stack space="xs" testID={`${testID}-source`}>
                    <Text variant="label">{t('catalogue:facts.sourceTitle')}</Text>

                    {active.source.kind === 'synthetic_prototype' ? (
                        <Badge
                            testID={`${testID}-synthetic`}
                            tone="info"
                            icon="prototype"
                            label={t('catalogue:facts.syntheticNote')}
                        />
                    ) : null}

                    <Text tone="secondary" variant="caption">
                        {t('catalogue:facts.source', { source: active.source.label })}
                    </Text>
                    <Text testID={`${testID}-version`} tone="secondary" variant="caption">
                        {t('catalogue:facts.version', { version: active.source.version })}
                    </Text>
                    <Text testID={`${testID}-calculated-at`} tone="secondary" variant="caption">
                        {t('catalogue:facts.calculatedAt', {
                            timestamp: formatter.formatDate(active.calculation.calculatedAt, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            }),
                        })}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:facts.method', { method: active.calculation.method })}
                    </Text>
                    <Text tone="secondary" variant="caption">
                        {t('catalogue:facts.rounding', { rounding: active.calculation.rounding })}
                    </Text>

                    {active.calculation.prototype ? (
                        <Text tone="secondary" variant="caption">
                            {t('catalogue:facts.prototypeFlag')}
                        </Text>
                    ) : null}
                </Stack>

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
