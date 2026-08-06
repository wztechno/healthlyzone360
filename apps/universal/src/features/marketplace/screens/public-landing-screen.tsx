import { Button, Card, Heading, Icon, Inline, Stack, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../section-header.tsx';
import { KitchenCard } from '../kitchen-card.tsx';
import { QueryStates } from '../query-states.tsx';

const VALUE_PROPS: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: 'plan', icon: 'calendar' },
    { key: 'kitchens', icon: 'organisation' },
    { key: 'review', icon: 'user' },
];

/**
 * The public landing page.
 *
 * ## What it gives away
 *
 * Doc 17, MKT-10: a landing page should give something before it asks for anything. What this one
 * gives is the catalogue — six real kitchens, browsable to the last meal on the last menu, with no
 * account. The account CTAs are present and clearly offered, but nothing above them is gated.
 *
 * ## Why every link here resolves today
 *
 * A landing page is the one screen where a dead link is unrecoverable: it is the first thing a
 * person touches and there is nothing behind it to fall back to. So the strips and CTAs point only
 * at routes that exist in this build — discover, kitchens, dietitians, how it works, for business,
 * sign in, register. Meals and plans are reachable from the navigation, where they are marked as
 * not yet built and explain themselves on press; they are deliberately absent from the hero.
 */
export function PublicLandingScreen() {
    const { t } = useTranslation();
    const router = useRouter();

    const featured = useKitchensQuery({ limit: 3, channels: ['b2c', 'marketplace'] });
    const kitchens = featured.data?.items ?? [];

    return (
        <Stack space="xl" testID="landing-screen">
            <Stack space="md" testID="landing-hero">
                <EntityImage
                    source={resolveMarketingImage('landing/hero.hero')}
                    decorative
                    seed="landing-hero"
                    label={t('marketplace:landing.heroTitle')}
                    aspect="wide"
                    className="max-h-[280px]"
                />
                <Heading level={1} testID="landing-title">
                    {t('marketplace:landing.heroTitle')}
                </Heading>
                <Text tone="secondary" className="max-w-[640px] text-lg">
                    {t('marketplace:landing.heroBody')}
                </Text>
                <Inline space="sm" wrap>
                    <Button
                        testID="landing-browse-kitchens"
                        label={t('marketplace:landing.browseKitchens')}
                        onPress={() => {
                            router.push('/kitchens');
                        }}
                    />
                    <Button
                        testID="landing-how-it-works"
                        variant="secondary"
                        label={t('marketplace:landing.howItWorks')}
                        onPress={() => {
                            router.push('/how-it-works');
                        }}
                    />
                </Inline>
            </Stack>

            <Stack space="sm" testID="landing-value-props">
                <SectionHeader title={t('marketplace:landing.valueTitle')} />
                <CardGrid>
                    {VALUE_PROPS.map((prop) => (
                        <CardGridItem key={prop.key}>
                            <Card padding="md" tone="raised" testID={`landing-value-${prop.key}`}>
                                <Stack space="xs">
                                    <Icon
                                        name={prop.icon}
                                        size="lg"
                                        className="text-content-on-brand-subtle"
                                    />
                                    <Text variant="bodyStrong">
                                        {t(`marketplace:landing.value.${prop.key}.title`)}
                                    </Text>
                                    <Text tone="secondary" variant="caption">
                                        {t(`marketplace:landing.value.${prop.key}.body`)}
                                    </Text>
                                </Stack>
                            </Card>
                        </CardGridItem>
                    ))}
                </CardGrid>
            </Stack>

            <Stack space="sm" testID="landing-featured-kitchens">
                <SectionHeader
                    title={t('marketplace:landing.featuredKitchens')}
                    description={t('marketplace:landing.featuredKitchensBody')}
                    action={{
                        label: t('marketplace:landing.seeAllKitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    }}
                    testID="landing-featured-header"
                />
                <QueryStates
                    query={featured}
                    isEmpty={kitchens.length === 0}
                    emptyTitle={t('marketplace:kitchens.emptyTitle')}
                    emptyBody={t('marketplace:kitchens.emptyBody')}
                    testID="landing-featured"
                >
                    <CardGrid testID="landing-featured-grid">
                        {kitchens.map((kitchen) => (
                            <CardGridItem key={kitchen.id}>
                                <KitchenCard
                                    kitchen={kitchen}
                                    onPress={() => {
                                        router.push(`/kitchens/${String(kitchen.id)}` as never);
                                    }}
                                />
                            </CardGridItem>
                        ))}
                    </CardGrid>
                </QueryStates>
            </Stack>

            <CardGrid testID="landing-teasers">
                <CardGridItem>
                    <Card
                        padding="md"
                        tone="brand"
                        testID="landing-how-it-works-teaser"
                        title={t('marketplace:landing.howItWorksTeaserTitle')}
                        onPress={() => {
                            router.push('/how-it-works');
                        }}
                    >
                        <Text tone="secondary">
                            {t('marketplace:landing.howItWorksTeaserBody')}
                        </Text>
                    </Card>
                </CardGridItem>
                <CardGridItem>
                    <Card
                        padding="md"
                        tone="raised"
                        testID="landing-for-business-teaser"
                        title={t('marketplace:landing.forBusinessTeaserTitle')}
                        onPress={() => {
                            router.push('/for-business');
                        }}
                    >
                        <Text tone="secondary">
                            {t('marketplace:landing.forBusinessTeaserBody')}
                        </Text>
                    </Card>
                </CardGridItem>
            </CardGrid>

            <Card padding="lg" tone="sunken" testID="landing-auth">
                <Stack space="sm">
                    <Heading level={2}>{t('marketplace:landing.authTitle')}</Heading>
                    <Text tone="secondary">{t('marketplace:landing.authBody')}</Text>
                    <Inline space="sm" wrap>
                        <Button
                            testID="landing-register"
                            label={t('marketplace:nav.register')}
                            onPress={() => {
                                router.push('/register');
                            }}
                        />
                        <Button
                            testID="landing-sign-in"
                            variant="secondary"
                            label={t('marketplace:nav.signIn')}
                            onPress={() => {
                                router.push('/sign-in');
                            }}
                        />
                    </Inline>
                </Stack>
            </Card>
        </Stack>
    );
}
