import { Callout, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

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
        <Stack space="xs">
            <Text variant="caption">
                {typeof source['label'] === 'string' ? source['label'] : ''}
            </Text>
            <Text
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
                accessibilityRole="link"
                onPress={() => {
                    void Linking.openURL('https://opendatacommons.org/licenses/odbl/1-0/');
                }}
            >
                ODbL
            </Text>
            {unknown.length === 0 ? null : (
                <Callout
                    tone="warning"
                    title={t('kitchen:allergenLookup.unmapped')}
                    body={unknown.join(', ')}
                />
            )}
        </Stack>
    );
}
