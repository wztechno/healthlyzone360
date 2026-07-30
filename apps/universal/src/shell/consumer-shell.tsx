import { AppShell, Button, Inline, OfflineIndicator } from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useCartQuery } from '../data/marketplace-hooks.ts';
import { useLogoutMutation } from '../data/hooks.ts';
import { DevBanner } from '../dev/dev-banner.tsx';
import { CONSUMER_NAVIGATION } from '../navigation/consumer-items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { usePrototypeAction } from '../prototype/prototype-action.ts';

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
 * filtered instead is *existence*: see `../navigation/consumer-items.ts` for why destinations a
 * later wave owns are shown, marked and explained rather than hidden or linked into a 404.
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
    const runPrototypeAction = usePrototypeAction();

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
            CONSUMER_NAVIGATION.map((item) => {
                const base = t(item.labelKey);
                const withCount =
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
                    label:
                        item.status === 'available'
                            ? withCount
                            : t('marketplace:nav.plannedSuffix', { label: withCount }),
                    icon: item.icon,
                    active: pathname === item.href,
                    testID: `consumer-nav-${item.key}`,
                    onPress: () => {
                        if (item.status === 'available') {
                            router.push(item.href as never);
                            return;
                        }
                        runPrototypeAction({
                            contract: item.contract ?? item.href,
                            message: t('marketplace:nav.plannedNotice', { label: base }),
                        });
                    },
                };
            }),
        [cartCount, pathname, router, runPrototypeAction, t],
    );

    const banner = (
        <View>
            <DevBanner />
            <OfflineIndicator testID="offline-indicator" state={connectivity} />
        </View>
    );

    const topbarEnd = (
        <Inline space="xs" wrap={false}>
            <Button
                testID="locale-toggle"
                size="sm"
                variant="ghost"
                label={locale.startsWith('ar') ? 'English' : t('common:locale.arabic')}
                onPress={() => {
                    void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                }}
            />
            <Button
                testID="sign-out"
                size="sm"
                variant="secondary"
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
