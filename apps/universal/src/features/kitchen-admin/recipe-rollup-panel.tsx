import type {
    AllergenSource,
    CostAmount,
    IngredientAdmin,
    RecipeRollupPreview,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    Card,
    Chip,
    Heading,
    Inline,
    Skeleton,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { IngredientId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { NutritionFactsPanel } from '../catalogue/nutrition-facts-panel.tsx';
import { costPerServing, displayName, rollupWarningKey } from './format.ts';

/**
 * The roll-up preview: what this draft would declare, before any of it is saved.
 *
 * ## Refreshing never blanks the panel
 *
 * The preview is keyed by a hash of the draft, so every edit is a *different* query. Left alone,
 * that means the panel unmounts its data on every keystroke — and the thing it would unmount is the
 * allergen list. A label that flickers to "no allergens" while a person is typing is not a loading
 * state, it is a lie with a spinner on it, and somebody reading quickly will believe it.
 *
 * So `useRecipeRollupQuery` keeps the previous answer mounted and this panel renders it *dimmed*,
 * with `aria-busy` set and a spinner beside the heading. The figures on screen were true of some
 * draft; the busy state says they are not yet true of this one.
 *
 * ## Cost is confidential and says so
 *
 * `CostAmount` exists on this contract and on no other (plan §4.8). The panel labels it, because an
 * admin screen that showed a purchase cost with no marking is how one ends up pasted into a customer
 * email. Cost per serving is derived here rather than fetched: it is one division, and a contract
 * field for it would be a second thing to keep in step with the yield.
 *
 * ## Warnings are the point, not the footnote
 *
 * A line the roll-up could not use is excluded from the figures and reported. That is the whole
 * shape of `RollupWarning`, and rendering it below the fold would reproduce the failure the shape
 * exists to prevent: figures that look complete and are not.
 */

export interface RecipeRollupPanelProps {
    readonly preview: RecipeRollupPreview | undefined;
    /** True while the figures on screen belong to the previous draft. Dims and sets `aria-busy`. */
    readonly isRefreshing: boolean;
    /** True before any preview has ever arrived. */
    readonly isPending: boolean;
    /** Rendered instead of the figures — the roll-up refused this draft outright. */
    readonly failureMessage: string | null;
    /** Empty draft: nothing to roll up yet, which is a state and not an error. */
    readonly isEmpty: boolean;
    /** Servings the yield declares, for the cost-per-serving division. */
    readonly servings: number;
    /** The library, for naming the ingredients behind an allergen. */
    readonly ingredients: readonly IngredientAdmin[];
    readonly testID: string;
}

function ingredientNames(
    ids: readonly IngredientId[],
    ingredients: readonly IngredientAdmin[],
    locale: string,
): readonly string[] {
    return ids.map((id) => {
        const found = ingredients.find((candidate) => candidate.id === id);
        return found === undefined ? String(id) : displayName(found.name, locale).value;
    });
}

/**
 * One allergen, expandable to the lines that put it there.
 *
 * Collapsed by default and expandable rather than always-on: six codes with their sources spelled
 * out is a wall of text, and the question "why is sesame on this label?" is asked about one code at
 * a time. The chip is the control, so the provenance is one press away and never more.
 */
function AllergenChip({
    source,
    ingredients,
    testID,
}: {
    readonly source: AllergenSource;
    readonly ingredients: readonly IngredientAdmin[];
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const [expanded, setExpanded] = useState(false);
    const names = ingredientNames(source.ingredientIds, ingredients, locale);

    return (
        <Stack space="none" testID={testID}>
            <Chip
                testID={`${testID}-chip`}
                tone={source.containment === 'contains' ? 'danger' : 'warning'}
                label={String(source.allergenCode)}
                onPress={() => {
                    setExpanded(!expanded);
                }}
            />
            {expanded ? (
                <Text testID={`${testID}-sources`} variant="caption" tone="secondary">
                    {names.length === 0
                        ? t('kitchen:rollup.allergenNoSources')
                        : t('kitchen:rollup.allergenFrom', { names: names.join(', ') })}
                </Text>
            ) : null}
        </Stack>
    );
}

function CostLine({
    label,
    cost,
    testID,
}: {
    readonly label: string;
    readonly cost: CostAmount | null;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Inline space="sm" align="center" justify="between" wrap>
            <Text variant="label">{label}</Text>
            <Text testID={testID}>
                {cost === null
                    ? t('kitchen:rollup.costUnknown')
                    : formatter.formatCurrency(cost.amount, cost.currency, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                      })}
            </Text>
        </Inline>
    );
}

export function RecipeRollupPanel({
    preview,
    isRefreshing,
    isPending,
    failureMessage,
    isEmpty,
    servings,
    ingredients,
    testID,
}: RecipeRollupPanelProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();

    return (
        <Card testID={testID} padding="md" tone="raised">
            <Stack space="md">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Heading level={2} testID={`${testID}-title`}>
                        {t('kitchen:rollup.title')}
                    </Heading>
                    {isRefreshing ? (
                        <Inline space="xs" align="center">
                            <Spinner testID={`${testID}-spinner`} size="small" />
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:rollup.refreshing')}
                            </Text>
                        </Inline>
                    ) : null}
                </Inline>

                <Text tone="secondary" variant="caption">
                    {t('kitchen:rollup.description')}
                </Text>

                {isEmpty ? (
                    <Text testID={`${testID}-empty`} tone="secondary">
                        {t('kitchen:rollup.empty')}
                    </Text>
                ) : isPending ? (
                    <Stack space="sm" testID={`${testID}-loading`}>
                        <Skeleton heightClassName="h-6" />
                        <Skeleton heightClassName="h-24" />
                    </Stack>
                ) : failureMessage !== null && preview === undefined ? (
                    <Callout
                        testID={`${testID}-error`}
                        role="alert"
                        tone="danger"
                        title={t('kitchen:rollup.errorTitle')}
                        body={failureMessage}
                    />
                ) : preview === undefined ? null : (
                    /*
                     * `aria-busy` on the region rather than on the page: a screen reader user is
                     * told that *these figures* are being replaced, which is the only true statement
                     * available while the previous ones are still the ones on screen.
                     */
                    <View
                        testID={`${testID}-figures`}
                        aria-busy={isRefreshing}
                        className={isRefreshing ? 'opacity-50' : ''}
                    >
                        <Stack space="md">
                            <Stack space="xs" testID={`${testID}-allergens`}>
                                <Text variant="label">{t('kitchen:rollup.allergensTitle')}</Text>
                                {preview.allergenSources.length === 0 ? (
                                    <Text testID={`${testID}-allergens-none`} tone="secondary">
                                        {t('kitchen:rollup.allergensNone')}
                                    </Text>
                                ) : (
                                    <Inline space="sm" wrap>
                                        {preview.allergenSources.map((source) => (
                                            <AllergenChip
                                                key={`${String(source.allergenCode)}-${source.containment}`}
                                                source={source}
                                                ingredients={ingredients}
                                                testID={`${testID}-allergen-${String(source.allergenCode)}`}
                                            />
                                        ))}
                                    </Inline>
                                )}
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:rollup.allergenProvenanceHint')}
                                </Text>
                            </Stack>

                            <Stack space="xs" testID={`${testID}-cost`}>
                                <Inline space="sm" align="center" wrap>
                                    <Text variant="label">{t('kitchen:rollup.costTitle')}</Text>
                                    <Badge
                                        testID={`${testID}-cost-confidential`}
                                        tone="info"
                                        icon="eyeOff"
                                        label={t('kitchen:rollup.confidential')}
                                    />
                                </Inline>
                                <CostLine
                                    label={t('kitchen:rollup.costTotal')}
                                    cost={preview.estimatedCost}
                                    testID={`${testID}-cost-total`}
                                />
                                <CostLine
                                    label={t('kitchen:rollup.costPerServing')}
                                    cost={costPerServing(preview.estimatedCost, servings)}
                                    testID={`${testID}-cost-per-serving`}
                                />
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:rollup.costHint')}
                                </Text>
                            </Stack>

                            <NutritionFactsPanel
                                testID={`${testID}-facts`}
                                facts={preview.perServing}
                                title={t('kitchen:rollup.factsTitle')}
                            />

                            {preview.warnings.length === 0 ? (
                                <Text
                                    testID={`${testID}-warnings-none`}
                                    tone="secondary"
                                    variant="caption"
                                >
                                    {t('kitchen:rollup.warningsNone')}
                                </Text>
                            ) : (
                                <Stack space="xs" testID={`${testID}-warnings`}>
                                    <Text variant="label">{t('kitchen:rollup.warningsTitle')}</Text>
                                    {preview.warnings.map((warning, index) => {
                                        const key = rollupWarningKey(warning.code);
                                        const names = ingredientNames(
                                            warning.ingredientIds,
                                            ingredients,
                                            locale,
                                        );
                                        return (
                                            <Callout
                                                key={`${warning.code}-${String(index)}`}
                                                testID={`${testID}-warning-${warning.code}`}
                                                role="status"
                                                tone="warning"
                                                title={key === null ? warning.message : t(key)}
                                                {...(names.length === 0
                                                    ? {}
                                                    : {
                                                          body: t('kitchen:rollup.warningLines', {
                                                              names: names.join(', '),
                                                          }),
                                                      })}
                                            />
                                        );
                                    })}
                                </Stack>
                            )}
                        </Stack>
                    </View>
                )}

                {/* A refusal that arrives while previous figures are on screen belongs beside them. */}
                {failureMessage !== null && preview !== undefined ? (
                    <Callout
                        testID={`${testID}-stale-error`}
                        role="alert"
                        tone="warning"
                        title={t('kitchen:rollup.staleErrorTitle')}
                        body={failureMessage}
                    />
                ) : null}

                <Text testID={`${testID}-explainer`} variant="caption" tone="secondary">
                    {t('kitchen:rollup.unsavedNotice')}
                </Text>
            </Stack>
        </Card>
    );
}
