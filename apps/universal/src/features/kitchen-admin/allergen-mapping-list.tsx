import type { AllergenClass, IngredientAllergenMapping } from '@healthy360/api-client/contracts';
import { Inline, Tag, Text } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { containmentKey, displayName, verificationKey } from './format.ts';

/**
 * The allergens an ingredient carries, one framed row each: the class, how it is present as a
 * tag (contains and may-contain take different tones, the word says which), then where the claim
 * stands — its verification, the note it came with and, when narrower than every market, its
 * markets. `footer` closes the frame with whatever acts on the whole set.
 */
export function AllergenMappingList({
    mappings,
    classes,
    footer,
    testID,
}: {
    readonly mappings: readonly IngredientAllergenMapping[];
    readonly classes: readonly AllergenClass[];
    readonly footer?: ReactNode;
    readonly testID?: string | undefined;
}) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    return (
        <View testID={testID} className="overflow-hidden rounded border border-stroke">
            {mappings.map((mapping, index) => {
                const code = String(mapping.allergenCode);
                const known = classes.find((entry) => entry.code === mapping.allergenCode);
                const meta = [
                    t(verificationKey(mapping.verification)),
                    mapping.sourceNote,
                    mapping.marketScope.length === 0 ? null : mapping.marketScope.join(', '),
                ].filter((part): part is string => typeof part === 'string' && part !== '');
                return (
                    <View
                        key={`${code}:${mapping.marketScope.join(',')}:${mapping.layer ?? 'unknown'}`}
                        testID={testID === undefined ? undefined : `${testID}-${code}`}
                        className={`px-control-sm py-tight ${index > 0 ? 'border-t border-stroke-subtle' : ''}`}
                    >
                        <Inline space="sm" align="center" wrap>
                            <Text variant="bodyStrong">
                                {known === undefined ? code : displayName(known.name, locale).value}
                            </Text>
                            <Tag
                                tone={mapping.containment === 'contains' ? 'danger' : 'warning'}
                                label={t(containmentKey(mapping.containment))}
                            />
                            <View className="min-w-0 flex-1">
                                <Text variant="caption" tone="secondary" className="text-end">
                                    {meta.join(' · ')}
                                </Text>
                            </View>
                        </Inline>
                    </View>
                );
            })}
            {footer === undefined ? null : (
                <View className="border-t border-stroke-subtle bg-surface-sunken px-control-sm py-tight">
                    {footer}
                </View>
            )}
        </View>
    );
}
