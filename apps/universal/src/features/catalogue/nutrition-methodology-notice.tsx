import { Icon, Stack, Text } from '@healthy360/design-system';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * How to read the nutrition figures on the plan catalogue.
 *
 * This replaces what was a blue `info` callout. The information is unchanged — the body is still the
 * macro-caveat sentence the comparison screen uses, word for word — but a blue box on a warm-green
 * marketplace read as a system message rather than as the page talking to you. On the brand tint it
 * is what it is: a standing editorial note, not an alert. It keeps `role="note"` and its
 * `plans-macro-caveat` handle, so nothing that pointed at the old callout has to move.
 *
 * It is app-level rather than a design-system component for the reason the {@link Callout} docstring
 * gives about the medical disclaimer: the wording is a product decision, and the design system stays
 * domain-free.
 */
export function NutritionMethodologyNotice() {
    const { t } = useTranslation();

    return (
        <View
            testID="plans-macro-caveat"
            role="note"
            className="flex-row items-start gap-3 rounded-xl bg-surface-brand-subtle p-4"
        >
            <Icon name="info" className="text-content-on-brand-subtle" />
            <Stack space="xs" className="flex-1">
                <Text variant="bodyStrong" className="text-content-on-brand-subtle">
                    {t('catalogue:plans.methodologyTitle')}
                </Text>
                <Text variant="caption" className="text-content-on-brand-subtle">
                    {t('catalogue:compare.macroCaveat')}
                </Text>
            </Stack>
        </View>
    );
}
