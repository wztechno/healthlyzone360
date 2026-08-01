import { Button, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

/**
 * The closing note on the plan catalogue: for anyone who reached the end still unsure.
 *
 * Its two actions go only where the model actually helps that person — a dietitian, and the
 * explanation of how plans work. There is no "find my plan" here on purpose: it would point back up
 * the same page. Both destinations are routes that exist in this build (`/dietitians`,
 * `/how-it-works`), so neither button is a promise the app cannot keep.
 */
export interface PlanRecommendationCtaProps {
    readonly onSpeakToDietitian: () => void;
    readonly onHowItWorks: () => void;
}

export function PlanRecommendationCta({
    onSpeakToDietitian,
    onHowItWorks,
}: PlanRecommendationCtaProps) {
    const { t } = useTranslation();

    return (
        <View testID="plans-cta" className="rounded-2xl bg-surface-brand-subtle p-6">
            <Stack space="sm">
                <Heading level={2} className="text-content-on-brand-subtle">
                    {t('catalogue:plans.ctaTitle')}
                </Heading>
                <Text className="max-w-[600px] text-content-on-brand-subtle">
                    {t('catalogue:plans.ctaBody')}
                </Text>
                <Inline space="sm" wrap>
                    <Button
                        testID="plans-cta-dietitian"
                        label={t('catalogue:plans.ctaPrimary')}
                        onPress={onSpeakToDietitian}
                    />
                    <Button
                        testID="plans-cta-how"
                        variant="secondary"
                        label={t('catalogue:plans.ctaSecondary')}
                        onPress={onHowItWorks}
                    />
                </Inline>
            </Stack>
        </View>
    );
}
