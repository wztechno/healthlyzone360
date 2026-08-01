import {
    Button,
    Heading,
    Icon,
    Inline,
    Stack,
    Text,
    cx,
    useBreakpoint,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EntityImage, resolveMarketingImage } from '../../media/entity-image.tsx';

/**
 * The `/plans` hero.
 *
 * A reading surface, not a funnel: it orients somebody who has arrived at a wall of plans, states
 * what the marketplace actually promises, and points at the two destinations that help before a
 * choice is made — how the model works, and a real person to talk to. It deliberately does *not*
 * carry a "find my plan" button, which on the catalogue page it heads would only scroll to the grid
 * already beneath it; the filters and the grid are that action.
 *
 * The three trust lines are things the data backs: every plan is presented with a dietitian
 * consultation (`plan.dietitianBody`), the kitchens carry a verified flag, and the durations run
 * from a single week. None of them is a slogan the record cannot stand behind.
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
    const { atLeast } = useBreakpoint();
    const wide = atLeast('lg');

    return (
        <Stack space="lg" testID="plans-hero">
            <View className={cx('gap-6', wide ? 'flex-row items-center' : 'flex-col-reverse')}>
                <Stack space="md" className={wide ? 'flex-1' : undefined}>
                    <Text variant="label" className="text-content-on-brand-subtle">
                        {t('catalogue:plans.eyebrow')}
                    </Text>
                    <Heading level={1} testID="plans-title">
                        {t('catalogue:plans.title')}
                    </Heading>
                    <Text tone="secondary" className="max-w-[560px] text-lg">
                        {t('catalogue:plans.subtitle')}
                    </Text>

                    <Inline space="sm" wrap>
                        <Button
                            testID="plans-hero-how"
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
                                <Icon
                                    name={item.icon}
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                                <Text variant="caption" tone="secondary">
                                    {t(`catalogue:plans.trust.${item.key}`)}
                                </Text>
                            </Inline>
                        ))}
                    </Inline>
                </Stack>

                <View className={wide ? 'w-[42%] max-w-[480px]' : 'w-full'}>
                    <EntityImage
                        source={resolveMarketingImage('discover/plans.tile')}
                        decorative
                        seed="plans-hero"
                        label={t('catalogue:plans.title')}
                        aspect="wide"
                        className="max-h-[300px]"
                    />
                </View>
            </View>
        </Stack>
    );
}
