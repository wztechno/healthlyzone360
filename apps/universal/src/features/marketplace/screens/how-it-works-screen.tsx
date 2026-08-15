import { Button, Card, Heading, Icon, Inline, Stack, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isFeatureAvailable } from '../../availability.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { SectionHeader } from '../section-header.tsx';

/**
 * The four steps.
 *
 * Numbered as data rather than written out four times, so the ordinal, the icon and the copy key
 * cannot drift apart — the failure mode being a step labelled "3" sitting second on the page after
 * somebody reorders the JSX.
 */
const STEPS: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: 'tell', icon: 'user' },
    { key: 'target', icon: 'success' },
    { key: 'plan', icon: 'calendar' },
    { key: 'eat', icon: 'organisation' },
];

/**
 * How it works.
 *
 * A public explainer, deliberately built from the design system's own iconography rather than from
 * illustration: the icon set is a handful of geometric glyphs that carry no borrowed visual
 * identity, which is precisely what a page like this must avoid.
 *
 * The medical disclaimer belongs here even though the page shows no figures. It describes a product
 * that calculates a nutrition target, and the place to say "this is an estimate, not medical
 * advice" is where the promise is made, not only where the number appears.
 */
export function HowItWorksScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Stack space="xl" testID="how-it-works-screen">
            <Stack space="sm">
                <Heading level={1} testID="how-it-works-title">
                    {t('marketplace:howItWorks.title')}
                </Heading>
                <Text tone="secondary" className="max-w-[640px] text-lg">
                    {t('marketplace:howItWorks.subtitle')}
                </Text>
            </Stack>

            <Stack space="md" testID="how-it-works-steps">
                {STEPS.map((step, index) => (
                    <Card
                        key={step.key}
                        testID={`how-it-works-step-${step.key}`}
                        padding="md"
                        tone="raised"
                    >
                        <EntityImage
                            source={resolveMarketingImage(`how-it-works/${step.key}.tile`)}
                            decorative
                            seed={`how-${step.key}`}
                            label={t(`marketplace:howItWorks.step.${step.key}.title`)}
                            aspect="wide"
                            className="mb-3"
                        />
                        <Inline space="md" align="start">
                            <Stack
                                space="none"
                                align="center"
                                justify="center"
                                className="h-11 w-11 rounded-full bg-surface-brand-subtle"
                            >
                                <Text variant="bodyStrong" className="text-content-on-brand-subtle">
                                    {String(index + 1)}
                                </Text>
                            </Stack>
                            <Stack space="xs" className="flex-1">
                                <Inline space="xs" align="center">
                                    <Icon
                                        name={step.icon}
                                        className="text-content-on-brand-subtle"
                                    />
                                    <Text variant="bodyStrong">
                                        {t(`marketplace:howItWorks.step.${step.key}.title`)}
                                    </Text>
                                </Inline>
                                <Text tone="secondary">
                                    {t(`marketplace:howItWorks.step.${step.key}.body`)}
                                </Text>
                            </Stack>
                        </Inline>
                    </Card>
                ))}
            </Stack>

            <Stack space="sm" testID="how-it-works-next">
                <SectionHeader
                    title={t('marketplace:howItWorks.nextTitle')}
                    description={t('marketplace:howItWorks.nextBody')}
                />
                <Inline space="sm" wrap>
                    <Button
                        testID="how-it-works-browse"
                        label={t('marketplace:landing.browseKitchens')}
                        onPress={() => {
                            router.push('/kitchens');
                        }}
                    />
                    {isFeatureAvailable('dietitianDirectory') ? (
                        <Button
                            testID="how-it-works-dietitians"
                            variant="secondary"
                            label={t('marketplace:howItWorks.meetDietitians')}
                            onPress={() => {
                                router.push('/dietitians');
                            }}
                        />
                    ) : null}
                    <Button
                        testID="how-it-works-register"
                        variant="ghost"
                        label={t('marketplace:nav.register')}
                        onPress={() => {
                            router.push('/register');
                        }}
                    />
                </Inline>
            </Stack>

            <MedicalDisclaimer />
        </Stack>
    );
}
