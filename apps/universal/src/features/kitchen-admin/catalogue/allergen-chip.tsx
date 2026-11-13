import type { AllergenContainment } from '@healthy360/api-client/contracts';
import { Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { allergenLabel } from '../ops-format.ts';

/**
 * One allergen an ingredient carries, as the Ingredients boards draw it: solid for "contains",
 * dashed and worded for "may contain". The two claims differ in line and in words, so the colour is
 * never the only thing telling them apart.
 */
export interface AllergenChipProps {
    readonly code: string;
    readonly containment: AllergenContainment;
    /** `sm` in a table row, `md` on a record. */
    readonly size?: 'sm' | 'md' | undefined;
    readonly testID?: string | undefined;
}

export function AllergenChip({ code, containment, size = 'sm', testID }: AllergenChipProps) {
    const { t } = useTranslation();
    const name = allergenLabel(code, t);
    const may = containment === 'may_contain';

    return (
        <View
            testID={testID}
            className={`max-w-full flex-row items-center rounded-full border py-0.5 ${
                size === 'md' ? 'min-h-7 px-3' : 'min-h-6 px-2'
            } ${
                may ? 'border-dashed border-warning-border' : 'border-transparent bg-warning-subtle'
            }`}
        >
            {/* A long class name wraps inside the chip: a cut-off allergen is a false answer. */}
            <Text variant="label" tone="warning" numberOfLines={3}>
                {may ? t('kitchen:allergenBoard.mayContain', { allergen: name }) : name}
            </Text>
        </View>
    );
}
