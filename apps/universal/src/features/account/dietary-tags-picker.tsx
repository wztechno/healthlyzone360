import { FilterChip, Inline, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DIET_CLASSIFICATIONS } from '../onboarding/vocabularies.ts';

/**
 * The diet-classification tick-list.
 *
 * Split from {@link import('./allergy-picker.tsx').AllergyPicker} rather than folded into one
 * "dietary preferences" control, because the two answer different questions and carry different
 * weight. A diet classification is a **preference filter** — vegetarian, low carbohydrate — that a
 * generator may reasonably trade off against variety. An allergen declaration is a safety
 * constraint that it may not. Drawing them as one list of chips would say they are the same kind of
 * thing, and the interface would be teaching something false before a single meal was chosen.
 *
 * Religious observance sits here rather than with allergies for the same reason it is recorded at
 * all: `halal_friendly` is about food, never about belief, and the product never asks a person what
 * they believe. (`DietaryProfile` treats religious requirements as special-category data, which is
 * why they live in the declaration rather than in a generic preferences blob.)
 *
 * TODO(onboarding pre-fill wave): the wizard's diet step keeps its own copy of this list. That wave
 * points it here and seeds it from `useDietaryProfileQuery()`. See the note on `AllergyPicker`.
 *
 * Labels are `onboarding:diets.*` — already authored in both locales, and one vocabulary should not
 * have two sets of words.
 */
export interface DietaryTagsPickerProps {
    readonly value: readonly string[];
    readonly onChange: (next: readonly string[]) => void;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

export function DietaryTagsPicker({
    value,
    onChange,
    disabled = false,
    testID = 'dietary-tags-picker',
}: DietaryTagsPickerProps) {
    const { t } = useTranslation();
    const groupLabel = t('account:dietary.dietsTitle');

    return (
        <Stack space="xs" testID={testID}>
            <Text variant="label" testID={`${testID}-label`}>
                {groupLabel}
            </Text>
            <Text variant="caption" tone="secondary">
                {t('account:dietary.dietsSubtitle')}
            </Text>

            <View role="group" aria-label={groupLabel} accessibilityLabel={groupLabel}>
                <Inline space="xs" wrap>
                    {DIET_CLASSIFICATIONS.map((code) => (
                        <FilterChip
                            key={code}
                            testID={`${testID}-${code}`}
                            label={t(`onboarding:diets.${code}`)}
                            selected={value.includes(code)}
                            disabled={disabled}
                            onChange={() => {
                                onChange(
                                    value.includes(code)
                                        ? value.filter((entry) => entry !== code)
                                        : [...value, code],
                                );
                            }}
                        />
                    ))}
                </Inline>
            </View>

            {value.length === 0 ? (
                <Text variant="caption" tone="secondary" testID={`${testID}-empty`}>
                    {t('account:dietary.dietsEmpty')}
                </Text>
            ) : null}
        </Stack>
    );
}
