import { Icon, Stack, Text } from '@healthy360/design-system';
import type { AllergenCode } from '@healthy360/domain-types';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * The allergen declaration.
 *
 * A list rather than a row of chips, and the difference is not cosmetic. This is the block a person
 * with a diagnosed allergy scans before deciding whether a dish can be eaten at all, so it has to
 * be:
 *
 * * **A real list.** `role="list"` with one `listitem` per allergen, so a screen reader announces
 *   "list of three items" and the reader knows when it has heard all of them. A wrapping row of
 *   chips announces three unrelated buttons.
 * * **Never colour alone.** Each row carries a warning glyph *and* the word "Contains", so the
 *   declaration survives greyscale, a monochrome display and every form of colour blindness — the
 *   requirement the prompt states outright and doc 17 (NUT-07) repeats.
 * * **Explicit about absence.** "The kitchen declares no allergens" is a different statement from
 *   an empty space, and only one of them is safe to act on.
 */
export interface AllergenListProps {
    readonly allergens: readonly AllergenCode[];
    readonly testID?: string | undefined;
}

export function AllergenList({ allergens, testID = 'allergen-list' }: AllergenListProps) {
    const { t } = useTranslation();

    if (allergens.length === 0) {
        return (
            <Text testID={`${testID}-none`} tone="secondary">
                {t('catalogue:meal.allergensNone')}
            </Text>
        );
    }

    return (
        <Stack space="xs" testID={testID}>
            <Text>{t('catalogue:meal.allergensDeclared')}</Text>
            <View role="list" className="flex-col gap-1">
                {allergens.map((code) => (
                    <View
                        key={code}
                        testID={`${testID}-${code}`}
                        role="listitem"
                        className="min-h-touch flex-row items-center gap-2 rounded-md border border-warning-border bg-warning-subtle px-3 py-2"
                    >
                        <Icon name="warning" size="sm" className="text-warning-on-subtle" />
                        <Text className="flex-1 text-warning-on-subtle">
                            {t('catalogue:meal.allergenItem', {
                                allergen: t(`marketplace:allergens.${code}`),
                            })}
                        </Text>
                    </View>
                ))}
            </View>
        </Stack>
    );
}
