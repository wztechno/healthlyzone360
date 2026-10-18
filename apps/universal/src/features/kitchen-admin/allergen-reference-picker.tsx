import type {
    AllergenClass,
    AllergenReferenceCandidate,
    AllergenReferenceSelection,
} from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Checkbox,
    Inline,
    ListItem,
    Stack,
    Tag,
    TagRow,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, View } from 'react-native';

import { useAllergenReferenceSearch } from '../../data/kitchen-admin-hooks.ts';
import { containmentKey, displayName } from './format.ts';

const ODBL_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

/**
 * The Open Food Facts lookup that suggests a product's allergens.
 *
 * The same shape as the USDA lookup beside it: one search row (name, barcode, Search), then the
 * products as framed rows — name and brand on the line, its declared allergens as tags under it, the
 * source and licence the data asks to be credited with, and a Select. Once one is chosen the list
 * folds down to it, its confirmation and a Change.
 */
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
    const blocked =
        disabled ||
        search.isPending ||
        (barcode.trim() ? !/^[0-9]{8,14}$/.test(barcode.trim()) : query.trim().length < 2);
    const run = () => {
        if (blocked) return;
        onChange(undefined);
        search.mutate({ query: query.trim(), barcode: barcode.trim() || undefined });
    };

    const chosen = search.data?.candidates.find(
        (candidate) => value?.candidate.ref === candidate.ref,
    );
    const candidates = chosen !== undefined ? [chosen] : (search.data?.candidates ?? []);

    const className = (code: string) => {
        const known = classes.find((entry) => String(entry.code) === code);
        return known === undefined ? code : displayName(known.name, locale).value;
    };

    const declarations = (candidate: AllergenReferenceCandidate) => (
        <Inline space="xs" align="center" wrap>
            {candidate.mappings.length === 0 ? (
                <Tag label={t('kitchen:allergenLookup.noneListed')} />
            ) : (
                <TagRow
                    items={candidate.mappings.map((mapping) => ({
                        key: mapping.allergen_code,
                        // Contains and may-contain are two claims: the tone separates them, the
                        // word says which.
                        tone: mapping.containment === 'contains' ? 'danger' : 'warning',
                        label: `${className(mapping.allergen_code)} · ${t(containmentKey(mapping.containment))}`,
                    }))}
                />
            )}
            {candidate.unmapped_terms.length === 0 ? null : (
                <Tag
                    tone="warning"
                    label={t('kitchen:allergenLookup.unmappedTerms', {
                        terms: candidate.unmapped_terms.join(', '),
                    })}
                />
            )}
            <Text
                variant="caption"
                tone="secondary"
                accessibilityRole="link"
                onPress={() => {
                    void Linking.openURL(candidate.source_url);
                }}
            >
                {candidate.attribution}
            </Text>
            <Text
                variant="caption"
                tone="secondary"
                accessibilityRole="link"
                onPress={() => {
                    void Linking.openURL(ODBL_URL);
                }}
            >
                ODbL
            </Text>
        </Inline>
    );

    return (
        <Stack space="sm" testID="allergen-reference-picker">
            {chosen !== undefined ? null : (
                <Inline space="xs" align="end">
                    <View className="max-w-field flex-1">
                        <TextInputField
                            testID="allergen-reference-query"
                            label={t('kitchen:allergenLookup.query')}
                            value={query}
                            onChangeText={setQuery}
                            onSubmitEditing={run}
                            returnKeyType="search"
                            maxLength={150}
                        />
                    </View>
                    {/* Fourteen digits, the longest a GTIN runs to. */}
                    <View className="w-32">
                        <TextInputField
                            testID="allergen-reference-barcode"
                            label={t('kitchen:allergenLookup.barcodeShort')}
                            hint={t('kitchen:allergenLookup.barcodeHint')}
                            value={barcode}
                            onChangeText={setBarcode}
                            onSubmitEditing={run}
                            keyboardType="number-pad"
                            maxLength={14}
                        />
                    </View>
                    {/* `Button` holds itself to the top (`self-start`); the wrapper is what the row
                        lines up with the input box. */}
                    <View>
                        <Button
                            testID="allergen-reference-search"
                            variant="secondary"
                            label={t('kitchen:nutritionLookup.search')}
                            disabled={blocked}
                            loading={search.isPending}
                            onPress={run}
                        />
                    </View>
                </Inline>
            )}

            {search.isError ? (
                <Callout tone="danger" title={t('kitchen:allergenLookup.unavailable')} />
            ) : null}
            {search.data?.notices.map((notice) => (
                <Callout
                    key={notice}
                    testID={`allergen-notice-${notice}`}
                    tone="warning"
                    title="Open Food Facts"
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

            {candidates.length === 0 ? null : (
                <View className="overflow-hidden rounded-md border border-stroke">
                    {candidates.map((candidate, index) => {
                        const selected = value?.candidate.ref === candidate.ref;
                        return (
                            <View
                                key={candidate.ref}
                                testID={`allergen-reference-${candidate.ref}`}
                                className={
                                    index < candidates.length - 1
                                        ? 'border-b border-stroke-subtle'
                                        : ''
                                }
                            >
                                <ListItem
                                    title={candidate.label}
                                    selected={selected}
                                    divider={false}
                                    meta={
                                        <Text variant="caption" tone="secondary">
                                            {[candidate.brand, candidate.ref]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </Text>
                                    }
                                    trailing={
                                        selected ? (
                                            <Button
                                                testID="allergen-reference-change"
                                                size="sm"
                                                variant="ghost"
                                                label={t('common:action.change')}
                                                onPress={() => onChange(undefined)}
                                            />
                                        ) : (
                                            <Button
                                                testID={`allergen-reference-select-${candidate.ref}`}
                                                size="sm"
                                                variant="secondary"
                                                label={t('common:action.select')}
                                                disabled={
                                                    disabled ||
                                                    !candidate.importable ||
                                                    candidate.selection_token === null
                                                }
                                                onPress={() =>
                                                    onChange({ candidate, confirmed: false })
                                                }
                                            />
                                        )
                                    }
                                />
                                <View className="px-control-sm pb-tight">
                                    {declarations(candidate)}
                                </View>
                            </View>
                        );
                    })}
                </View>
            )}

            {value === undefined ? null : (
                <Checkbox
                    testID="allergen-reference-confirm"
                    label={t('kitchen:allergenLookup.confirmProduct')}
                    checked={value.confirmed}
                    onChange={(confirmed) => onChange({ ...value, confirmed })}
                />
            )}
        </Stack>
    );
}
