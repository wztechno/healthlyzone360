import { Button, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { BrandGradient } from '../../ui/brand-gradient.tsx';

/**
 * The closing note on the plan catalogue: for anyone who reached the end still unsure. It carries
 * the mood board's violet→emerald accent gradient — the "AI / premium" treatment — with white copy.
 *
 * Its two actions go only where the model actually helps that person: a dietitian, and the
 * explanation of how plans work. There is no "find my plan" here on purpose — it would point back up
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
        <BrandGradient variant="accent" testID="plans-cta" className="p-6 md:p-8">
            <Stack space="sm">
                <Heading level={2} tone="inverse">
                    {t('catalogue:plans.ctaTitle')}
                </Heading>
                <Text tone="inverse" className="max-w-[600px] opacity-95">
                    {t('catalogue:plans.ctaBody')}
                </Text>
                <Inline space="sm" wrap>
                    <Button
                        testID="plans-cta-dietitian"
                        variant="secondary"
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
        </BrandGradient>
    );
}
