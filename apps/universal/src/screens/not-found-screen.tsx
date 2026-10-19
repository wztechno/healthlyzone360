import { Button, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useGoBackOr } from '../navigation/use-return-to.ts';
import { useAccessState } from '../session/session-provider.tsx';
import { MarketplaceShell } from '../shell/marketplace-shell.tsx';
import { shopperHome } from './forbidden-screen.tsx';

/**
 * The page for an address that matches no route (`app/+not-found.tsx`).
 *
 * ## In the shop's own chrome, where the build has a shop
 *
 * It used to be a bare card with one link, "Go to the start", to `/` — the launch resolver, which
 * sent an unconfirmed account to verification and a staff member to a workspace picker (AUTH-18).
 * A stale link to a dish or a mistyped kitchen address is a shopper's dead end far more often than
 * anyone else's, so where this build has the marketplace the page wears its header — the brand,
 * the destinations, search and the basket are all still there — and offers the two ways out a
 * person actually wants: Back to where they were, and the marketplace home.
 *
 * A staff-only build has no marketplace to wear, so there it stays the plain card, and its way on
 * is still `/`, which for staff is the right answer: their workspace.
 *
 * "Go to Discover" replaces rather than pushes: an address that leads nowhere is not worth a Back
 * entry of its own.
 */
export function NotFoundScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const goBackOr = useGoBackOr();
    const home = shopperHome(useAccessState());
    const inShop = home !== '/';

    const body = (
        <Stack space="md" testID="not-found" className="items-start py-10">
            <Heading level={1} testID="not-found-title">
                {t('access:notFound.title')}
            </Heading>
            <Text tone="secondary">{t('access:notFound.body')}</Text>
            <Inline space="sm" wrap>
                <Button
                    testID="not-found-home"
                    label={inShop ? t('access:notFound.toDiscover') : t('access:notFound.home')}
                    onPress={() => {
                        router.replace(home as never);
                    }}
                />
                <Button
                    testID="not-found-back"
                    variant="secondary"
                    label={t('common:action.back')}
                    onPress={() => {
                        goBackOr(home);
                    }}
                />
            </Inline>
        </Stack>
    );

    if (!inShop) {
        return (
            <View className="flex-1 items-center justify-center bg-surface-base p-6">{body}</View>
        );
    }
    return <MarketplaceShell>{body}</MarketplaceShell>;
}
