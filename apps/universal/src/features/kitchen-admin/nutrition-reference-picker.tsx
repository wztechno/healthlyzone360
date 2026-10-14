import type {
    NutritionReferenceCandidate,
    NutritionReferenceSelection,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Checkbox,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import { useNutritionReferenceSearch } from '../../data/kitchen-admin-hooks.ts';

export function NutritionReferencePicker({
    name,
    value,
    onChange,
}: {
    readonly name: string;
    readonly value: NutritionReferenceSelection | undefined;
    readonly onChange: (value: NutritionReferenceSelection | undefined) => void;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState(name);
    const search = useNutritionReferenceSearch();
    const failure = toFailure(search.error);

    const choose = (candidate: NutritionReferenceCandidate) =>
        onChange({ ref: candidate.ref, sourceHash: candidate.source_hash, confirmed: false });

    return (
        <Stack space="sm" testID="nutrition-reference-picker">
            <TextInputField
                testID="nutrition-reference-query"
                label={t('kitchen:nutritionLookup.query')}
                value={query}
                onChangeText={setQuery}
                maxLength={150}
            />
            <Button
                testID="nutrition-reference-search"
                label={t('kitchen:nutritionLookup.search')}
                loading={search.isPending}
                disabled={query.trim().length < 2 || search.isPending}
                onPress={() => search.mutate(query.trim())}
            />
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
            {search.data?.map((candidate) => (
                <Stack
                    space="xs"
                    key={candidate.ref}
                    testID={`nutrition-reference-${candidate.ref}`}
                >
                    <Text>{candidate.label}</Text>
                    <Text tone="secondary" variant="caption">
                        {[candidate.brand, candidate.data_type, candidate.ref]
                            .filter(Boolean)
                            .join(' · ')}
                    </Text>
                    <Badge tone="warning" label={t('kitchen:nutritionLookup.estimated')} />
                    <Text variant="caption">
                        {candidate.nutrition_per_100g.amounts
                            .map(
                                (amount) =>
                                    `${t(`nutrition:nutrients.${amount.nutrient_id}`)}: ${amount.value} ${amount.unit}`,
                            )
                            .join(' · ')}
                    </Text>
                    {candidate.suitable ? null : (
                        <Callout
                            tone="warning"
                            title={t('kitchen:nutritionLookup.unsuitable')}
                            body={candidate.reasons.join(' ')}
                        />
                    )}
                    <Button
                        testID={`nutrition-reference-select-${candidate.ref}`}
                        variant="secondary"
                        label={t(
                            value?.ref === candidate.ref && value.sourceHash === candidate.source_hash
                                ? 'kitchen:nutritionLookup.selected'
                                : 'kitchen:nutritionLookup.select',
                        )}
                        disabled={!candidate.suitable}
                        onPress={() => choose(candidate)}
                    />
                </Stack>
            ))}
            {value === undefined ? null : (
                <Checkbox
                    testID="nutrition-reference-confirm"
                    label={t('kitchen:nutritionLookup.confirmPreparation')}
                    checked={value.confirmed}
                    onChange={(confirmed) => onChange({ ...value, confirmed })}
                />
            )}
            {value === undefined ? null : (
                <Button
                    variant="ghost"
                    label={t('kitchen:nutritionLookup.clearSelection')}
                    onPress={() => onChange(undefined)}
                />
            )}
            <Text tone="secondary" variant="caption">
                {t('kitchen:nutritionLookup.allergensSeparate')}
            </Text>
        </Stack>
    );
}
