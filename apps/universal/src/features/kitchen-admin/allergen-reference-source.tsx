import { Inline, Tag, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

/** Where an imported allergen suggestion came from, on one line: product, source, licence. */
export function AllergenReferenceSource({
    source,
}: {
    readonly source: Readonly<Record<string, unknown>>;
}) {
    const { t } = useTranslation();
    const ref = typeof source['ref'] === 'string' ? source['ref'] : '';
    const barcode = /^off:([0-9]{8,14})$/.exec(ref)?.[1];
    const unknown = Array.isArray(source['unmapped_terms'])
        ? source['unmapped_terms'].filter((term): term is string => typeof term === 'string')
        : [];
    return (
        <Inline space="xs" align="center" wrap>
            <Text variant="caption">
                {typeof source['label'] === 'string' ? source['label'] : ''}
            </Text>
            <Text
                variant="caption"
                tone="secondary"
                accessibilityRole="link"
                onPress={() => {
                    void Linking.openURL(
                        barcode === undefined
                            ? 'https://world.openfoodfacts.org/'
                            : `https://world.openfoodfacts.org/product/${barcode}`,
                    );
                }}
            >
                Open Food Facts
            </Text>
            <Text
                variant="caption"
                tone="secondary"
                accessibilityRole="link"
                onPress={() => {
                    void Linking.openURL('https://opendatacommons.org/licenses/odbl/1-0/');
                }}
            >
                ODbL
            </Text>
            {unknown.length === 0 ? null : (
                <Tag
                    tone="warning"
                    label={t('kitchen:allergenLookup.unmappedTerms', { terms: unknown.join(', ') })}
                />
            )}
        </Inline>
    );
}
