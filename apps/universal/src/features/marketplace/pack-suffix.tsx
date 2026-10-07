import type { PackSize } from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Text as RNText } from 'react-native';

import { formatPackSize } from './format.ts';

/**
 * " / 300 g" after a price that buys a pack, nested inside the price's own text so it wraps and
 * ellipsises with it. Nothing for a dish priced as itself.
 *
 * Quieter than the figure — the number is what compares across a row of cards, the size is what
 * stops a 300 g bottle's 3.00 being read as a price per kilo.
 */
export function PackSuffix({
    pack,
    testID,
}: {
    readonly pack: PackSize | null;
    readonly testID?: string | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    if (pack === null) return null;

    return (
        <RNText testID={testID} className="text-sm font-normal text-content-secondary">
            {' '}
            {t('marketplace:packSize.per', { size: formatPackSize(t, formatter, pack) })}
        </RNText>
    );
}
