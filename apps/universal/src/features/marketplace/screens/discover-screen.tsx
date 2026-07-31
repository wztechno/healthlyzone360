import {
    Button,
    Card,
    Heading,
    Icon,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDietitiansQuery, useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../section-header.tsx';
import { DietitianCard } from '../dietitian-card.tsx';
import { KitchenCard } from '../kitchen-card.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * Catalogue families the catalogue wave owns.
 *
 * They are presented rather than hidden, and pressing one explains what it will be and which
 * endpoint it is waiting on — the visible-but-locked pattern doc 17 (MKT-04) recommends. The
 * alternative, showing a discovery page with a third of the product missing and no acknowledgement,
 * is worse for a reviewer and worse for a person.
 */
// Every family became a real route at the catalogue wave, so these are links, not notices.
const CATALOGUE_FAMILIES: readonly {
    readonly key: string;
    readonly icon: IconName;
    readonly href: string;
}[] = [
    { key: 'meals', icon: 'dot', href: '/meals' },
    { key: 'plans', icon: 'calendar', href: '/plans' },
    { key: 'diets', icon: 'filter', href: '/diets/high-protein' },
    { key: 'tools', icon: 'info', href: '/tools/calorie-calculator' },
];

/**
 * Discover — the marketplace's front door.
 *
 * A hub rather than a fourth listing: it shows a slice of each family and hands off to the screen
 * that does the family properly. The search field is deliberately a *hand-off* too — it navigates
 * to the kitchen directory carrying the query in the URL, so the person lands somewhere they can
 * refine, share and reload, rather than on a results view that only exists in memory.
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [term, setTerm] = useState('');

    const kitchens = useKitchensQuery({ limit: 4, channels: ['marketplace'] });
    const dietitians = useDietitiansQuery({ limit: 3, acceptingClients: true });

    const kitchenItems = kitchens.data?.items ?? [];
    const dietitianItems = dietitians.data?.items ?? [];

    const search = () => {
        const trimmed = term.trim();
        router.push(
            (trimmed === '' ? '/kitchens' : `/kitchens?q=${encodeURIComponent(trimmed)}`) as never,
        );
    };

    return (
        <Stack space="xl" testID="discover-screen">
            <Stack space="sm">
                <Heading level={1} testID="discover-title">
                    {t('marketplace:discover.title')}
                </Heading>
                <Text tone="secondary">{t('marketplace:discover.subtitle')}</Text>
                <TextInputField
                    testID="discover-search"
                    id="discover-search"
                    label={t('marketplace:discover.searchLabel')}
                    placeholder={t('marketplace:discover.searchPlaceholder')}
                    value={term}
                    onChangeText={setTerm}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="search"
                    onSubmitEditing={search}
                    trailing={<Icon name="search" />}
                />
                <Inline space="sm" wrap>
                    <Button
                        testID="discover-search-submit"
                        label={t('marketplace:discover.searchSubmit')}
                        onPress={search}
                    />
                </Inline>
            </Stack>

            <Stack space="sm" testID="discover-kitchens">
                <SectionHeader
                    title={t('marketplace:discover.kitchensTitle')}
                    description={t('marketplace:discover.kitchensBody')}
                    action={{
                        label: t('marketplace:landing.seeAllKitchens'),
                        onPress: () => {
                            router.push('/kitchens');
                        },
                    }}
                    testID="discover-kitchens-header"
                />
                <QueryStates
                    query={kitchens}
                    isEmpty={kitchenItems.length === 0}
                    emptyTitle={t('marketplace:kitchens.emptyTitle')}
                    emptyBody={t('marketplace:kitchens.emptyBody')}
                    testID="discover-kitchens-list"
                >
                    <CardGrid>
                        {kitchenItems.map((kitchen) => (
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

            <Stack space="sm" testID="discover-dietitians">
                <SectionHeader
                    title={t('marketplace:discover.dietitiansTitle')}
                    description={t('marketplace:discover.dietitiansBody')}
                    action={{
                        label: t('marketplace:dietitians.seeAll'),
                        onPress: () => {
                            router.push('/dietitians');
                        },
                    }}
                    testID="discover-dietitians-header"
                />
                <QueryStates
                    query={dietitians}
                    isEmpty={dietitianItems.length === 0}
                    emptyTitle={t('marketplace:dietitians.emptyTitle')}
                    emptyBody={t('marketplace:dietitians.emptyBody')}
                    testID="discover-dietitians-list"
                >
                    <CardGrid>
                        {dietitianItems.map((dietitian) => (
                            <CardGridItem key={dietitian.id}>
                                <DietitianCard
                                    dietitian={dietitian}
                                    onPress={() => {
                                        router.push(`/dietitians/${String(dietitian.id)}` as never);
                                    }}
                                />
                            </CardGridItem>
                        ))}
                    </CardGrid>
                </QueryStates>
            </Stack>

            <Stack space="sm" testID="discover-planned">
                <SectionHeader
                    title={t('marketplace:discover.comingTitle')}
                    description={t('marketplace:discover.comingBody')}
                    testID="discover-planned-header"
                />
                <CardGrid>
                    {CATALOGUE_FAMILIES.map((family) => (
                        <CardGridItem key={family.key}>
                            <Card
                                testID={`discover-family-${family.key}`}
                                padding="md"
                                onPress={() => {
                                    router.push(family.href as never);
                                }}
                                accessibilityLabel={t(`marketplace:discover.family.${family.key}`)}
                            >
                                <Stack space="xs">
                                    <EntityImage
                                        source={resolveMarketingImage(
                                            `discover/${family.key}.tile`,
                                        )}
                                        decorative
                                        seed={`discover-${family.key}`}
                                        label={t(`marketplace:discover.family.${family.key}`)}
                                        aspect="wide"
                                    />
                                    <Icon
                                        name={family.icon}
                                        size="lg"
                                        className="text-content-secondary"
                                    />
                                    <Text variant="bodyStrong">
                                        {t(`marketplace:discover.family.${family.key}`)}
                                    </Text>
                                    <Text tone="secondary" variant="caption">
                                        {t(`marketplace:discover.familyBody.${family.key}`)}
                                    </Text>
                                </Stack>
                            </Card>
                        </CardGridItem>
                    ))}
                </CardGrid>
            </Stack>
        </Stack>
    );
}
