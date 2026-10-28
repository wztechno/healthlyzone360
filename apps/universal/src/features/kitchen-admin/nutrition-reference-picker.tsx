import type {
    IngredientAssistSuggestion,
    NutritionReferenceCandidate,
    NutritionReferenceSelection,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Checkbox,
    Inline,
    ListItem,
    Stack,
    Tag,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import { useNutritionReferenceSearch } from '../../data/kitchen-admin-hooks.ts';

/** `saturated_fat` → `saturatedFat`: the provider's ids are snake case, the catalogue's keys are not. */
export function nutrientKey(id: string): string {
    return `nutrition:nutrients.${id.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())}`;
}

/**
 * The USDA lookup a new food ingredient takes its nutrition from.
 *
 * One search row, then the matches as one-line rows in a framed list — name, source, energy, and a
 * Select at the end. A match that cannot be used stays in the list, dimmed and saying what it is
 * missing, below the ones that can: hiding it would leave a reader wondering why the obvious "Lentils,
 * dry" never appeared. Once one is chosen the list folds down to that row, the confirmation and a
 * Change, which is the whole of what is left to decide.
 *
 * The ingredient assistant can hand it a `suggestion`: the USDA search it already ran, the match it
 * would pick and how that match relates to the typed name. Those candidates stand in for a search
 * until the cook runs their own. The preparation-state confirmation stays the cook's either way.
 */
export function NutritionReferencePicker({
    name,
    value,
    valueCandidate,
    suggestion,
    onRename,
    onChange,
}: {
    readonly name: string;
    readonly value: NutritionReferenceSelection | undefined;
    /** The record behind `value`, so a selection carried across a rename still draws its row. */
    readonly valueCandidate?: NutritionReferenceCandidate | undefined;
    readonly suggestion?: NonNullable<IngredientAssistSuggestion['nutrition']> | undefined;
    /** "Update ingredient name" — the cook edits the name; nothing renames by itself. */
    readonly onRename?: (() => void) | undefined;
    readonly onChange: (
        value: NutritionReferenceSelection | undefined,
        candidate?: NutritionReferenceCandidate,
    ) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState(name);
    const search = useNutritionReferenceSearch();
    const failure = toFailure(search.error);

    const choose = (candidate: NutritionReferenceCandidate) =>
        onChange(
            { ref: candidate.ref, sourceHash: candidate.source_hash, confirmed: false },
            candidate,
        );
    const run = () => {
        if (query.trim().length >= 2 && !search.isPending) search.mutate(query.trim());
    };

    const isChosen = (candidate: NutritionReferenceCandidate) =>
        value?.ref === candidate.ref && value.sourceHash === candidate.source_hash;
    const listed = search.data ?? suggestion?.candidates;
    const chosen =
        listed?.find(isChosen) ??
        (valueCandidate !== undefined && isChosen(valueCandidate) ? valueCandidate : undefined);
    // Usable matches first; the order within each group is the provider's relevance.
    const candidates =
        chosen !== undefined
            ? [chosen]
            : [...(listed ?? [])].sort((a, b) => Number(b.suitable) - Number(a.suitable));
    const picked =
        search.data === undefined && suggestion?.pick != null
            ? suggestion.candidates[suggestion.pick]
            : undefined;
    /*
     * How the assistant's pick sits against the typed name. Extra detail ("cooked, boiled") is a
     * question, not an error: it asks whether that is what the kitchen buys. A different food is a
     * warning, and the pick is never preselected for it — the cook chooses from the list.
     */
    const relationNotice =
        picked === undefined
            ? null
            : suggestion?.relation === 'different' && value === undefined
              ? ('different' as const)
              : suggestion?.relation === 'more_specific' && value?.ref === picked.ref
                ? ('more_specific' as const)
                : null;

    return (
        <Stack space="sm" testID="nutrition-reference-picker">
            {chosen !== undefined ? null : (
                <Inline space="xs" align="end" wrap={false}>
                    <View className="max-w-field flex-1">
                        <TextInputField
                            testID="nutrition-reference-query"
                            label={t('kitchen:nutritionLookup.query')}
                            value={query}
                            onChangeText={setQuery}
                            onSubmitEditing={run}
                            returnKeyType="search"
                            maxLength={150}
                        />
                    </View>
                    {/* `Button` holds itself to the top (`self-start`); the wrapper is what the row
                        lines up with the input box. */}
                    <View>
                        <Button
                            testID="nutrition-reference-search"
                            variant="secondary"
                            label={t('kitchen:nutritionLookup.search')}
                            loading={search.isPending}
                            disabled={query.trim().length < 2 || search.isPending}
                            onPress={run}
                        />
                    </View>
                </Inline>
            )}

            {relationNotice === null || picked === undefined ? null : (
                <Callout
                    testID={`nutrition-reference-relation-${relationNotice}`}
                    tone="warning"
                    icon="sparkle"
                    title={t(
                        relationNotice === 'different'
                            ? 'kitchen:assist.relationDifferent'
                            : 'kitchen:assist.relationMoreSpecific',
                        { match: picked.label },
                    )}
                    {...(suggestion?.reason == null ? {} : { body: suggestion.reason })}
                    actions={
                        <>
                            {onRename === undefined ? null : (
                                <Button
                                    testID="nutrition-reference-rename"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:assist.updateName')}
                                    onPress={onRename}
                                />
                            )}
                            {relationNotice === 'more_specific' ? (
                                <Button
                                    testID="nutrition-reference-choose-another"
                                    size="sm"
                                    variant="ghost"
                                    label={t('kitchen:assist.chooseAnother')}
                                    onPress={() => onChange(undefined)}
                                />
                            ) : null}
                        </>
                    }
                />
            )}

            {failure === null ? null : (
                <Callout
                    testID="nutrition-reference-error"
                    tone="danger"
                    title={t(
                        failure.code === 'nutrition.provider_configuration'
                            ? 'kitchen:nutritionLookup.configuration'
                            : 'kitchen:nutritionLookup.unavailable',
                    )}
                    body={failure.message}
                />
            )}
            {!search.isPending && !search.isError && search.data?.length === 0 ? (
                <Callout
                    testID="nutrition-reference-empty"
                    tone="warning"
                    title={t('kitchen:nutritionLookup.noMatches')}
                    body={t('kitchen:nutritionLookup.tryShorter')}
                />
            ) : null}
            {/* Matches came back, but not one can be chosen — every Select is dimmed, and the way
                out is a different search ("pepper sauce" rather than a brand's own name). */}
            {chosen === undefined &&
            candidates.length > 0 &&
            candidates.every((candidate) => !candidate.suitable) ? (
                <Callout
                    testID="nutrition-reference-none-usable"
                    tone="warning"
                    title={t('kitchen:nutritionLookup.unsuitable')}
                    body={t('kitchen:nutritionLookup.tryShorter')}
                />
            ) : null}

            {candidates.length === 0 ? null : (
                <View className="overflow-hidden rounded-md border border-stroke">
                    {candidates.map((candidate, index) => {
                        const energy = candidate.nutrition_per_100g.amounts.find(
                            (amount) => amount.nutrient_id === 'energy',
                        );
                        const selected = isChosen(candidate);
                        return (
                            <ListItem
                                key={candidate.ref}
                                testID={`nutrition-reference-${candidate.ref}`}
                                title={candidate.label}
                                selected={selected}
                                disabled={!candidate.suitable}
                                divider={index < candidates.length - 1}
                                meta={
                                    <>
                                        {candidate === picked ? (
                                            <Tag
                                                testID="nutrition-reference-ai-pick"
                                                tone="info"
                                                label={t('kitchen:assist.aiPick')}
                                            />
                                        ) : null}
                                        {/* One tag per blocker. A branded sauce is usually listed per
                                            ml, and a row that only named its missing nutrients hid
                                            that — or read "Missing" with nothing after it. */}
                                        {candidate.unsupported_basis ? (
                                            <Tag
                                                testID={`nutrition-reference-basis-${candidate.ref}`}
                                                tone="warning"
                                                label={t('kitchen:nutritionLookup.notPerGram')}
                                            />
                                        ) : null}
                                        {candidate.missing_nutrients.length === 0 ? null : (
                                            <Tag
                                                testID={`nutrition-reference-missing-${candidate.ref}`}
                                                tone="warning"
                                                label={t('kitchen:nutritionLookup.missing', {
                                                    list: candidate.missing_nutrients
                                                        .map((id) => t(nutrientKey(id)))
                                                        .join(', '),
                                                })}
                                            />
                                        )}
                                        <Text variant="caption" tone="secondary">
                                            {[candidate.brand, candidate.data_type, candidate.ref]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Text>
                                    </>
                                }
                                metric={
                                    energy === undefined ? undefined : (
                                        <Text variant="mono" tone="secondary">
                                            {`${String(Math.round(energy.value))} ${energy.unit}`}
                                        </Text>
                                    )
                                }
                                trailing={
                                    selected ? (
                                        <Button
                                            testID="nutrition-reference-change"
                                            size="sm"
                                            variant="ghost"
                                            label={t('common:action.change')}
                                            onPress={() => onChange(undefined)}
                                        />
                                    ) : (
                                        <Button
                                            testID={`nutrition-reference-select-${candidate.ref}`}
                                            size="sm"
                                            variant="secondary"
                                            label={t('common:action.select')}
                                            disabled={!candidate.suitable}
                                            onPress={() => choose(candidate)}
                                        />
                                    )
                                }
                            />
                        );
                    })}
                </View>
            )}

            {value === undefined ? null : (
                <Checkbox
                    testID="nutrition-reference-confirm"
                    label={t('kitchen:nutritionLookup.confirmPreparation')}
                    checked={value.confirmed}
                    onChange={(confirmed) => onChange({ ...value, confirmed }, chosen)}
                />
            )}
        </Stack>
    );
}
