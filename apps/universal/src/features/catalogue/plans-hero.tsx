import { Button, Heading, Icon, Inline, Stack, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { BrandGradient } from '../../ui/brand-gradient.tsx';

/**
 * The `/plans` hero — the mood board's signature green→violet banner.
 *
 * A reading surface, not a funnel: it orients somebody who has arrived at a wall of plans, states
 * what the marketplace promises, and points at the two destinations that help before a choice is
 * made — how the model works, and a real person to talk to. It carries no "find my plan" button,
 * which on the catalogue page it heads would only scroll to the grid already beneath it.
 *
 * The copy is white on the gradient's dark leading edge (see {@link BrandGradient}); both calls to
 * action are the light button so they read against the colour rather than dissolving into it. The
 * three trust lines are things the data backs — a dietitian consultation on every plan, verified
 * kitchens, durations from a single week — not slogans.
 */
export interface PlansHeroProps {
    readonly onHowItWorks: () => void;
    readonly onSpeakToDietitian: () => void;
}

const TRUST: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: 'reviewed', icon: 'user' },
    { key: 'kitchens', icon: 'organisation' },
    { key: 'flexible', icon: 'calendar' },
];

export function PlansHero({ onHowItWorks, onSpeakToDietitian }: PlansHeroProps) {
    const { t } = useTranslation();

    return (
        <BrandGradient variant="hero" testID="plans-hero" className="p-6 md:p-10">
            <Stack space="md" className="max-w-[640px]">
                <Text variant="label" tone="inverse" className="uppercase tracking-wide opacity-90">
                    {t('catalogue:plans.eyebrow')}
                </Text>
                <Heading level={1} tone="inverse" testID="plans-title">
                    {t('catalogue:plans.title')}
                </Heading>
                <Text tone="inverse" className="max-w-[560px] text-lg opacity-95">
                    {t('catalogue:plans.subtitle')}
                </Text>

                <Inline space="sm" wrap>
                    <Button
                        testID="plans-hero-how"
                        variant="secondary"
                        label={t('catalogue:plans.heroHowItWorks')}
                        onPress={onHowItWorks}
                    />
                    <Button
                        testID="plans-hero-dietitian"
                        variant="secondary"
                        label={t('catalogue:plans.heroSpeakToDietitian')}
                        onPress={onSpeakToDietitian}
                    />
                </Inline>

                <Inline space="md" wrap testID="plans-hero-trust">
                    {TRUST.map((item) => (
                        <Inline key={item.key} space="xs" align="center">
                            <Icon name={item.icon} size="sm" className="text-content-inverse" />
                            <Text variant="caption" tone="inverse" className="opacity-90">
                                {t(`catalogue:plans.trust.${item.key}`)}
                            </Text>
                        </Inline>
                    ))}
                </Inline>
            </Stack>
        </BrandGradient>
    );
}
