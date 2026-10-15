import type { AllergenClass, AllergenReferenceSelection } from '@healthy360/api-client/contracts';
import { Button, Callout, Checkbox, Stack, Text, TextInputField } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { useAllergenReferenceSearch } from '../../data/kitchen-admin-hooks.ts';
import { displayName, containmentKey } from './format.ts';

export function AllergenReferencePicker({
    name,
    classes,
    value,
    onChange,
    disabled = false,
}: {
    readonly name: string;
    readonly classes: readonly AllergenClass[];
    readonly value: AllergenReferenceSelection | undefined;
    readonly onChange: (value: AllergenReferenceSelection | undefined) => void;
    readonly disabled?: boolean;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const [query, setQuery] = useState(name);
    const [barcode, setBarcode] = useState('');
    const search = useAllergenReferenceSearch();
    const run = () => {
        onChange(undefined);
        search.mutate({ query: query.trim(), barcode: barcode.trim() || undefined });
    };
    const blocked =
        disabled ||
        search.isPending ||
        (barcode.trim() ? !/^[0-9]{8,14}$/.test(barcode.trim()) : query.trim().length < 2);

    return (
        <Stack space="sm" testID="allergen-reference-picker">
            <Text>{t('kitchen:allergenLookup.title')}</Text>
            <Text variant="caption" tone="secondary">
                {t('kitchen:allergenLookup.guidance')}
            </Text>
            <TextInputField
                testID="allergen-reference-query"
                label={t('kitchen:allergenLookup.query')}
                value={query}
                onChangeText={setQuery}
                maxLength={150}
            />
            <TextInputField
                testID="allergen-reference-barcode"
                label={t('kitchen:allergenLookup.barcode')}
                value={barcode}
                onChangeText={setBarcode}
                maxLength={14}
            />
            <Button
                testID="allergen-reference-search"
                label={t('kitchen:allergenLookup.search')}
                disabled={blocked}
                loading={search.isPending}
                onPress={run}
            />
            {search.isError ? (
                <Callout tone="danger" title={t('kitchen:allergenLookup.unavailable')} />
            ) : null}
            {search.data?.notices.map((notice) => (
                <Callout
                    key={notice}
                    testID={`allergen-notice-${notice}`}
                    tone="warning"
                    title={'Open Food Facts'}
                    body={t(
                        notice.endsWith('.configuration')
                            ? 'kitchen:allergenLookup.configuration'
                            : 'kitchen:allergenLookup.unavailable',
                    )}
                />
            ))}
            {search.data?.candidates.length === 0 && search.data.notices.length === 0 ? (
                <Callout
                    testID="allergen-reference-empty"
                    tone="warning"
                    title={t('kitchen:allergenLookup.empty')}
                />
            ) : null}
            {search.data?.candidates.map((candidate) => (
                <Stack
                    key={candidate.ref}
                    space="xs"
                    testID={`allergen-reference-${candidate.ref}`}
                >
                    <Text>{candidate.label}</Text>
                    <Text variant="caption">
                        {[candidate.brand, candidate.ref].filter(Boolean).join(' · ')}
                    </Text>
                    {candidate.mappings.map((mapping) => {
                        const known = classes.find(
                            (entry) => String(entry.code) === mapping.allergen_code,
                        );
                        return (
                            <Text key={mapping.allergen_code}>
                                {known === undefined
                                    ? mapping.allergen_code
                                    : displayName(known.name, locale).value}
                                {' · '}
                                {t(containmentKey(mapping.containment))}
                            </Text>
                        );
                    })}
                    {candidate.mappings.length === 0 ? (
                        <Text>{t('kitchen:allergenLookup.noDeclarations')}</Text>
                    ) : null}
                    {candidate.unmapped_terms.length === 0 ? null : (
                        <Callout
                            tone="warning"
                            title={t('kitchen:allergenLookup.unmapped')}
                            body={candidate.unmapped_terms.join(', ')}
                        />
                    )}
                    <Text
                        accessibilityRole="link"
                        onPress={() => {
                            void Linking.openURL(candidate.source_url);
                        }}
                    >
                        {candidate.attribution}
                    </Text>
                    <Text
                        accessibilityRole="link"
                        onPress={() => {
                            void Linking.openURL('https://opendatacommons.org/licenses/odbl/1-0/');
                        }}
                    >
                        ODbL
                    </Text>
                    <Button
                        variant="secondary"
                        testID={`allergen-reference-select-${candidate.ref}`}
                        label={t(
                            value?.candidate.ref === candidate.ref
                                ? 'kitchen:nutritionLookup.selected'
                                : 'kitchen:nutritionLookup.select',
                        )}
                        disabled={
                            disabled || !candidate.importable || candidate.selection_token === null
                        }
                        onPress={() => onChange({ candidate, confirmed: false })}
                    />
                </Stack>
            ))}
            {value === undefined ? null : (
                <>
                    <Checkbox
                        testID="allergen-reference-confirm"
                        label={t('kitchen:allergenLookup.confirmProduct')}
                        checked={value.confirmed}
                        onChange={(confirmed) => onChange({ ...value, confirmed })}
                    />
                    <Button
                        variant="ghost"
                        label={t('kitchen:nutritionLookup.clearSelection')}
                        onPress={() => onChange(undefined)}
                    />
                </>
            )}
        </Stack>
    );
}
