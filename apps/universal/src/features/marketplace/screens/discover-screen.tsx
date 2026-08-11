import { Button, Card, Icon, Stack, Text, TextInputField } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import { isPathAvailable } from '../../availability.ts';
import { EntityImage, resolveMarketingImage } from '../../../media/entity-image.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../section-header.tsx';
import { PageHero } from '../../../ui/page-hero.tsx';
import { KitchenCard } from '../kitchen-card.tsx';
import { QueryStates } from '../query-states.tsx';

/**
 * Catalogue families, each a real route.
 *
 * The table lists every family the marketplace has; `isPathAvailable` decides which of them has a
 * backend today. `diets` and `tools` do not, so they are absent rather than shown as tiles that
 * would bounce a person straight back to this page.
 */
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

const AVAILABLE_FAMILIES = CATALOGUE_FAMILIES.filter((family) => isPathAvailable(family.href));

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

    const kitchens = useKitchensQuery({ limit: 4, channels: ['b2c', 'marketplace'] });

    const kitchenItems = kitchens.data?.items ?? [];

    const search = () => {
        const trimmed = term.trim();
        router.push(
            (trimmed === '' ? '/kitchens' : `/kitchens?q=${encodeURIComponent(trimmed)}`) as never,
        );
    };

    return (
        <Stack space="xl" testID="discover-screen">
            {/*
             * Rule 3, on the surface that most needed it: this is the front door, and it opened
             * with a heading, a line of grey text and a form field. The search panel moves into
             * the band's trailing column, which is the arrangement the hero exists for — the page
             * says what it is and offers the one thing you came to do, in the same breath.
             */}
            <PageHero
                testID="discover"
                title={t('marketplace:discover.title')}
                subtitle={t('marketplace:discover.subtitle')}
                trailing={
                    <View className="flex-col gap-2 rounded-xl bg-surface-raised p-3 shadow-elevation-3">
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
                        <Button
                            testID="discover-search-submit"
                            block
                            label={t('marketplace:discover.searchSubmit')}
                            onPress={search}
                        />
                    </View>
                }
            />

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

            {/*
             * The families that resolve, with no section header above them.
             *
             * `discover.comingTitle` read "Also on the way" and its body said these parts of the
             * catalogue were being built — true when every family below was a prototype notice,
             * and a lie now that the two remaining ones are real routes to real screens. Removing
             * the header is the whole fix; each tile already names itself and says what it holds.
             */}
            {AVAILABLE_FAMILIES.length === 0 ? null : (
                <Stack space="sm" testID="discover-planned">
                    <CardGrid>
                        {AVAILABLE_FAMILIES.map((family) => (
                            <CardGridItem key={family.key}>
                                <Card
                                    testID={`discover-family-${family.key}`}
                                    padding="md"
                                    onPress={() => {
                                        router.push(family.href as never);
                                    }}
                                    accessibilityLabel={t(
                                        `marketplace:discover.family.${family.key}`,
                                    )}
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
            )}
        </Stack>
    );
}
