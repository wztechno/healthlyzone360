import { Button, Callout, Icon, Inline } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { useSubscriptionsQuery } from '../../../data/marketplace-hooks.ts';
import { consumerNavigation } from '../../../navigation/consumer-items.ts';
import type { ConsumerNavigationDescriptor } from '../../../navigation/consumer-items.ts';
import { MedicalDisclaimer } from '../../../safety/medical-disclaimer.tsx';
import { useSession } from '../../../session/session-provider.tsx';
import { isPathAvailable } from '../../availability.ts';
import { useBasketAdd } from '../../commerce/use-basket-add.tsx';
import { formatMoney } from '../format.ts';
import { HomeHero, HomeSectionHeader, HomeSections } from '../home/home-sections.tsx';
import type { HomeOffer } from '../home/home-sections.tsx';
import { useHomeMeals } from '../home/use-home-meals.ts';
import { clearResumeIntent, useResumeIntent } from '../resume-intent.ts';
import { TileGrid, TileGridItem } from '../section-header.tsx';

/**
 * Destinations the customer header already carries, so the page does not list them twice: discover
 * is this page and the header's first item, and the basket is its cart pill.
 */
const IN_HEADER: ReadonlySet<string> = new Set(['discover', 'cart']);

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
 * Discover — the marketplace home, and HealthZone's `home` screen for everybody.
 *
 * It is the only home. `/` sends an anonymous visitor here and the landing kernel sends a signed-in
 * customer here (`ROUTE_PATHS.customerHome`); `/customer` forwards here too. Those three used to be
 * three screens drawing the same sections, which is how the site came to carry one page three times.
 *
 * The design's home top to bottom, through `../home/home-sections.tsx`: the canopy hero beside the
 * photograph, "Browse by category", the top-rated grid, and the offer band beside the
 * recommendation card.
 *
 * ## What a signed-in person's account adds
 *
 * Fitted into places the design already has, so the page keeps the design's shape:
 *
 * - **Where was I** — the resume notice for a marketplace page recorded before sign-in. Transient,
 *   actionable and only ever present right after signing in, so it sits above the hero, where a
 *   notice belongs, and leaves no trace once dismissed.
 * - **The hero's eyebrow** is the next subscription delivery when there is one — the design's
 *   delivery-slot fact, made true for this person. Its second button tracks their latest order
 *   (`HomeHero`); with none it is the other way into the catalogue, by kitchen.
 * - **The running subscription** takes the offer band. The band pitches plans; somebody already on
 *   one is better served by seeing theirs, and the band's button manages it. With no subscription
 *   the band is the plans offer again.
 * - **The account's destinations** close the page as one more section: a titled header row and a
 *   row of tiles like the categories'. They come from `consumerNavigation()`, which drops
 *   destinations with no backend. Subscriptions and profile are reachable from nowhere else in the
 *   customer chrome, which is why the section stays.
 *
 * The cards carry figures and the band can carry a price, so a signed-in page keeps the medical
 * disclaimer at the foot, as every customer surface that prints nutrition does.
 *
 * ## The search field is in the chrome, not on the page
 *
 * It lives in `shell/marketplace-shell.tsx`, reachable from every marketplace screen.
 *
 * ## Add is on every card, for everybody
 *
 * `commerce/use-basket-add.tsx` asks an anonymous visitor the same question the meal page asks:
 * carry on as a guest, or sign in.
 */
export function DiscoverScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { me } = useSession();
    const signedIn = me !== null;

    const basket = useBasketAdd({ labelKey: 'marketplace:nav.discover', testID: 'discover' });
    // Only the shown shelves — see `catalogue/shown-shelves.ts`.
    const meals = useHomeMeals({ shownShelvesOnly: true });
    const subscriptions = useSubscriptionsQuery(signedIn);
    const resume = useResumeIntent();

    const activeSubscription = signedIn
        ? (subscriptions.data?.items ?? []).find((subscription) => subscription.state !== 'cancelled')
        : undefined;

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
                      testID: 'discover-subscription-manage',
                      label: t('marketplace:consumer.subscription.manage'),
                      onPress: () => {
                          router.push(
                              `/customer/subscriptions/${String(activeSubscription.id)}` as never,
                          );
                      },
                  },
              };

    const links: readonly ConsumerNavigationDescriptor[] = signedIn
        ? [
              ...consumerNavigation().filter((item) => !IN_HEADER.has(item.key)),
              ...(isPathAvailable(ACCOUNT_LINK.href) ? [ACCOUNT_LINK] : []),
          ]
        : [];

    return (
        <View testID="discover-screen" className="flex-col pb-11">
            {!signedIn || resume === null ? null : (
                <Callout
                    testID="discover-resume"
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
                                testID="discover-resume-continue"
                                size="sm"
                                label={t('marketplace:consumer.resume.continue')}
                                onPress={() => {
                                    const { href } = resume;
                                    clearResumeIntent();
                                    router.push(href as never);
                                }}
                            />
                            <Button
                                testID="discover-resume-dismiss"
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
                testID="discover-hero"
                meals={meals}
                eyebrow={
                    nextDelivery === null
                        ? undefined
                        : t('marketplace:consumer.subscription.nextDelivery', {
                              date: nextDelivery,
                          })
                }
                primaryTestID="discover-hero-meals"
                secondary={{
                    testID: 'discover-hero-kitchens',
                    label: t('marketplace:landing.browseKitchens'),
                    onPress: () => {
                        router.push('/kitchens');
                    },
                }}
            />

            <HomeSections
                testID="discover"
                meals={meals}
                onAdd={basket.add}
                offer={subscriptionOffer}
            />

            {links.length === 0 ? null : (
                <View testID="discover-links" className="mt-11 flex-col">
                    <HomeSectionHeader
                        testID="discover-links-header"
                        title={t('marketplace:consumer.links.title')}
                    />
                    <View className="mt-4">
                        <TileGrid>
                            {links.map((link) => {
                                const label = t(link.labelKey);
                                return (
                                    <TileGridItem key={link.key}>
                                        <Pressable
                                            testID={`discover-link-${link.key}`}
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

            {signedIn ? <MedicalDisclaimer className="mt-11" /> : null}

            {basket.dialog}
        </View>
    );
}
