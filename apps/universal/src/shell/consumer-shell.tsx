import { AppShell, Button, Icon, Inline, OfflineIndicator } from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useCartQuery } from '../data/marketplace-hooks.ts';
import { useLogoutMutation } from '../data/hooks.ts';
import { DevBanner } from '../dev/dev-banner.tsx';
import { consumerNavigation } from '../navigation/consumer-items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';

/**
 * The signed-in consumer chrome.
 *
 * A sibling of `AreaShell` and of `MarketplaceShell`. What makes it its own component is the
 * *shape* of the navigation rather than its contents: the consumer area is a **task** surface, so
 * its destinations belong under the thumb on a phone and beside the content on a desktop. That is
 * the design system's `consumer` variant — a sidebar at `lg` and above, bottom tabs below it —
 * which no workspace area uses.
 *
 * The customer area is authenticated-and-verified for every screen in it and carries no
 * per-destination permission, so unlike `AreaShell` there is nothing here to filter by. What is
 * filtered instead is *existence*: `consumerNavigation()` drops the destinations whose feature has
 * no backend yet, so this list never offers a screen the area layout would redirect away from.
 */
export interface ConsumerShellProps {
    readonly children: ReactNode;
    /** Skip the gate. Only used by tests that render the chrome without a session. */
    readonly unguarded?: boolean | undefined;
}

export function ConsumerShell({ children, unguarded = false }: ConsumerShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const { locale, setLocale } = useLocale();
    const { state: connectivity } = useOnlineStatus();
    const logout = useLogoutMutation();

    /**
     * The cart count.
     *
     * `NavigationItem` has no badge slot — the design system's navigation is label-and-icon — so the
     * count goes into the label, where it is both visible and part of the accessible name. That is
     * the correct fallback rather than a workaround: a count rendered only as a coloured dot fails
     * the same "never colour alone" rule the nutrition components follow. A badge slot on
     * `NavigationItem` is recorded as a design-system follow-up.
     */
    const cart = useCartQuery(!unguarded);
    const cartCount = cart.data?.itemCount ?? 0;

    const navigation = useMemo<readonly NavigationItem[]>(
        () =>
            consumerNavigation().map((item) => {
                const base = t(item.labelKey);
                const label =
                    item.badge === 'cart' && cartCount > 0
                        ? // `items`, not `count`: `count` is i18next's pluralisation trigger and
                          // this string is a label with a number in it, not a plural form.
                          t('marketplace:consumer.nav.cartWithCount', {
                              label: base,
                              items: cartCount,
                          })
                        : base;

                return {
                    key: item.key,
                    label,
                    icon: item.icon,
                    active: pathname === item.href,
                    testID: `consumer-nav-${item.key}`,
                    onPress: () => {
                        router.push(item.href as never);
                    },
                };
            }),
        [cartCount, pathname, router, t],
    );

    const banner = (
        <View>
            <DevBanner />
            <OfflineIndicator testID="offline-indicator" state={connectivity} />
        </View>
    );

    const cartLabel = t('marketplace:consumer.nav.cart');
    const basketLabel =
        cartCount > 0
            ? t('marketplace:consumer.nav.cartWithCount', { label: cartLabel, items: cartCount })
            : cartLabel;

    const topbarEnd = (
        <Inline space="xs" wrap className="shrink">
            <Button
                testID="locale-toggle"
                size="sm"
                variant="ghost"
                label={locale.startsWith('ar') ? 'English' : t('common:locale.arabic')}
                onPress={() => {
                    void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                }}
            />
            {/*
             * The basket, which this shell did not have. Rule 4 gives the customer area's primary
             * slot to the revenue action, and until now the only way to the basket from a customer
             * screen was the navigation list — which is under the thumb on a phone but a long way
             * from the eye on a desktop, where the sidebar is a column of eight.
             */}
            <Button
                testID="consumer-basket"
                size="sm"
                variant="primary"
                label={basketLabel}
                iconStart={<Icon name="basket" />}
                iconEnd={
                    cartCount === 0 ? undefined : (
                        <View
                            testID="consumer-basket-count"
                            className="min-w-[20px] items-center justify-center rounded-full bg-surface-raised px-1.5"
                        >
                            <RNText className="text-xs font-bold text-surface-brand">
                                {String(cartCount)}
                            </RNText>
                        </View>
                    )
                }
                onPress={() => {
                    router.push('/customer/cart' as never);
                }}
            />
            <Button
                testID="sign-out"
                size="sm"
                variant="quiet"
                label={t('common:action.signOut')}
                loading={logout.isPending}
                onPress={() => {
                    logout.mutate(undefined, {
                        onSuccess: () => {
                            router.replace('/sign-in');
                        },
                    });
                }}
            />
        </Inline>
    );

    const shell = (
        <AppShell
            testID="consumer-shell"
            variant="consumer"
            title={t('marketplace:consumer.title')}
            navigation={navigation}
            banner={banner}
            topbarEnd={topbarEnd}
        >
            {children}
        </AppShell>
    );

    if (unguarded) return shell;

    // Guard outside the chrome, exactly as `AreaShell` does: a refusal must never paint a sidebar
    // full of destinations that belong to somebody else.
    return <Gate area="customer">{shell}</Gate>;
}
