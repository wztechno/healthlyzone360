import { Button, Callout, Icon, Inline } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { isPathAvailable } from '../../availability.ts';
import { consumerNavigation } from '../../../navigation/consumer-items.ts';
import type { ConsumerNavigationDescriptor } from '../../../navigation/consumer-items.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { HomeHero, HomeSectionHeader, HomeSections } from '../home/home-sections.tsx';
import type { HomeOffer } from '../home/home-sections.tsx';
import { useHomeMeals } from '../home/use-home-meals.ts';
import { clearResumeIntent, useResumeIntent } from '../resume-intent.ts';
import { formatMoney } from '../format.ts';
import { TileGrid, TileGridItem } from '../section-header.tsx';

/**
 * Destinations the customer header already carries, so the home does not list them twice: home is
 * this page, discover is the header's first item and the basket is its cart pill.
 */
const IN_HEADER: ReadonlySet<string> = new Set(['home', 'discover', 'cart']);

/**
 * The account record's own screen. It is not in `CONSUMER_NAVIGATION` — the sidebar reached it
 * through the profile menu — so it is listed here beside the table's entries, through the same
 * availability filter.
 */
const ACCOUNT_LINK: ConsumerNavigationDescriptor = {
    key: 'account',
    labelKey: 'marketplace:consumer.nav.account',
    href: '/customer/account',
    icon: 'userCircle',
    area: 'customer',
};

/**
 * The signed-in consumer's home — HealthZone's `home`, which the design draws for a signed-in
 * customer in the first place (its header names "Sam K." and its hero tracks their order).
 *
 * It is the same page as `/discover`, top to bottom, through `../home/home-sections.tsx`. What this
 * person's account adds is fitted into places the design already has, so the page keeps the
 * design's shape:
 *
 * - **Where was I** — the resume notice for a marketplace page recorded before sign-in. Transient,
 *   actionable and only ever present right after signing in, so it sits above the hero, where a
 *   notice belongs, and leaves no trace once dismissed.
 * - **The hero's eyebrow** is the next subscription delivery when there is one — the design's
 *   delivery-slot fact, made true for this person. Its second button tracks their latest order
 *   (`HomeHero`).
 * - **The running subscription** takes the offer band. The band pitches plans; somebody already on
 *   one is better served by seeing theirs — its plan, its state, its next delivery and weekly price
 *   — and the band's button manages it. With no subscription the band is the plans offer again.
 * - **The account's destinations** — the places the sidebar used to list before `/customer` wore the
 *   marketplace header — close the page as one more section in the design's own vocabulary: a
 *   titled, ruled header row and a row of tiles like the categories'. They come from
 *   `consumerNavigation()`, which drops destinations with no backend, so planner, nutrition and the
 *   virtual dietitian return here on the day their endpoints do. Subscriptions and profile are
 *   reachable from nowhere else in the customer chrome, which is why the section stays.
 *
 * The cards carry figures and the band can carry a price, so the medical disclaimer stays at the
 * foot, as it does on every customer surface that prints nutrition.
 */
export function ConsumerHomeScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();

    const subscriptions = useSubscriptionsQuery(true);
    const resume = useResumeIntent();
    const meals = useHomeMeals();
    const basket = useBasketAdd({ labelKey: 'marketplace:consumer.nav.home', testID: 'consumer' });

    const activeSubscription = (subscriptions.data?.items ?? []).find(
        (subscription) => subscription.state !== 'cancelled',
    );

    const nextDelivery =
        activeSubscription?.nextDeliveryDate === undefined ||
        activeSubscription.nextDeliveryDate === null
            ? null
            : formatter.formatDate(`${activeSubscription.nextDeliveryDate}T12:00:00.000Z`, {
                  day: 'numeric',
                  month: 'long',
              });

    const subscriptionOffer: HomeOffer | undefined =
        activeSubscription === undefined
            ? undefined
            : {
                  eyebrow: t('marketplace:consumer.subscription.eyebrow', {
                      state: t(`marketplace:subscriptionStates.${activeSubscription.state}`),
                  }),
                  title: activeSubscription.planName,
                  body: `${
                      nextDelivery === null
                          ? t('marketplace:consumer.subscription.noNextDelivery')
                          : t('marketplace:consumer.subscription.nextDelivery', {
                                date: nextDelivery,
                            })
                  } · ${t('marketplace:consumer.subscription.weeklyPrice', {
                      price: formatMoney(formatter, activeSubscription.weeklyPrice),
                  })}`,
                  action: {
                      testID: 'consumer-subscription-manage',
                      label: t('marketplace:consumer.subscription.manage'),
                      onPress: () => {
                          router.push(
                              `/customer/subscriptions/${String(activeSubscription.id)}` as never,
                          );
                      },
                  },
              };

    const links: readonly ConsumerNavigationDescriptor[] = [
        ...consumerNavigation().filter((item) => !IN_HEADER.has(item.key)),
        ...(isPathAvailable(ACCOUNT_LINK.href) ? [ACCOUNT_LINK] : []),
    ];

    return (
        <View testID="consumer-home-screen" className="flex-col pb-11">
            {resume === null ? null : (
                <Callout
                    testID="consumer-resume"
                    role="status"
                    tone="info"
                    className="mb-6"
                    title={t('marketplace:consumer.resume.title')}
                    body={t('marketplace:consumer.resume.body', {
                        destination: resume.name ?? t(resume.labelKey),
                    })}
                    actions={
                        <Inline space="sm" wrap>
                            <Button
                                testID="consumer-resume-continue"
                                size="sm"
                                label={t('marketplace:consumer.resume.continue')}
                                onPress={() => {
                                    const { href } = resume;
                                    clearResumeIntent();
                                    router.push(href as never);
                                }}
                            />
                            <Button
                                testID="consumer-resume-dismiss"
                                size="sm"
                                variant="ghost"
                                label={t('marketplace:consumer.resume.dismiss')}
                                onPress={clearResumeIntent}
                            />
                        </Inline>
                    }
                />
            )}

            <HomeHero
                testID="consumer-hero"
                meals={meals}
                eyebrow={
                    nextDelivery === null
                        ? undefined
                        : t('marketplace:consumer.subscription.nextDelivery', {
                              date: nextDelivery,
                          })
                }
                primaryTestID="consumer-hero-meals"
                secondary={{
                    testID: 'consumer-hero-kitchens',
                    label: t('marketplace:landing.browseKitchens'),
                    onPress: () => {
                        router.push('/kitchens');
                    },
                }}
            />

            <HomeSections
                testID="consumer"
                meals={meals}
                onAdd={basket.add}
                offer={subscriptionOffer}
            />

            {links.length === 0 ? null : (
                <View testID="consumer-links" className="mt-11 flex-col">
                    <HomeSectionHeader
                        testID="consumer-links-header"
                        title={t('marketplace:consumer.links.title')}
                    />
                    <View className="mt-4">
                        <TileGrid>
                            {links.map((link) => {
                                const label = t(link.labelKey);
                                return (
                                    <TileGridItem key={link.key}>
                                        <Pressable
                                            testID={`consumer-link-${link.key}`}
                                            role="link"
                                            accessibilityRole="link"
                                            accessibilityLabel={label}
                                            onPress={() => {
                                                router.push(link.href as never);
                                            }}
                                            className="grow gap-3 rounded-panel border border-stroke-subtle bg-surface-raised p-3 hover:border-surface-brand"
                                        >
                                            <View className="h-24 items-center justify-center rounded bg-surface-brand-subtle">
                                                <Icon
                                                    name={link.icon}
                                                    size="lg"
                                                    className="text-content-on-brand-subtle"
                                                />
                                            </View>
                                            <RNText
                                                numberOfLines={1}
                                                className="font-display text-base font-bold tracking-display text-content-primary text-start"
                                            >
                                                {label}
                                            </RNText>
                                        </Pressable>
                                    </TileGridItem>
                                );
                            })}
                        </TileGrid>
                    </View>
                </View>
            )}

            <MedicalDisclaimer className="mt-11" />

            {basket.dialog}
        </View>
    );
}
