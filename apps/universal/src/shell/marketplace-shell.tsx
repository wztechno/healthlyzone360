import { AppShell, Button, Inline, OfflineIndicator, Stack, Text } from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, View } from 'react-native';

import { DevBanner } from '../dev/dev-banner.tsx';
import { recordResumeIntent } from '../features/marketplace/resume-intent.ts';
import { MARKETPLACE_NAVIGATION } from '../navigation/consumer-items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { usePrototypeAction } from '../prototype/prototype-action.ts';

const SHELL_TEST_ID = 'marketplace-shell';
const CONTENT_TEST_ID = `${SHELL_TEST_ID}-content`;

/**
 * The public marketplace chrome.
 *
 * A sibling of `AreaShell`, not a variant of it, because the two answer different questions.
 * `AreaShell` asks "which staff workspace is this, and may you be here?"; this asks "how does an
 * anonymous visitor understand and move around a catalogue?". Folding them together would mean one
 * component branching on `area === 'public'` in eight places, and a sign-out button one refactor
 * away from appearing on a marketing page.
 *
 * Three things follow from being a *public* surface:
 *
 * * **No sign-out, ever.** The trailing slot offers the two things an anonymous person can do —
 *   sign in, or create an account — and the language switch. An asserted absence, not an oversight:
 *   the Playwright landing test fails if a sign-out control appears here.
 * * **A footer.** No workspace has one; a site does, and it is where the secondary destinations and
 *   the prototype disclosure live.
 * * **A skip link.** A marketing page puts a row of navigation between the top of the document and
 *   the content, which is precisely the case a skip link exists for.
 */
export interface MarketplaceShellProps {
    readonly children: ReactNode;
}

/**
 * Skip to content.
 *
 * Web only, revealed on keyboard focus. A CSS `:focus-visible` hook is not expressible through
 * React Native Web's inline styles, but component state is: while unfocused the link collapses to
 * a clipped 1×1 box (still in the tab order, still announced by screen readers), and the first Tab
 * press expands it in place. On native the whole idea is meaningless — there is no document to
 * skip through — so it renders nothing rather than a control that cannot act.
 */
const SKIP_LINK_HIDDEN = { position: 'absolute', width: 1, height: 1, overflow: 'hidden' } as const;

function SkipToContent() {
    const { t } = useTranslation();
    const [focused, setFocused] = useState(false);

    const focusContent = useCallback(() => {
        const target = globalThis.document.querySelector(`[data-testid="${CONTENT_TEST_ID}"]`);
        if (target instanceof globalThis.HTMLElement) {
            // A scroll container is not focusable by default; -1 makes it programmatically
            // focusable without inserting it into the tab order.
            target.setAttribute('tabindex', '-1');
            target.focus();
            target.scrollIntoView();
        }
    }, []);

    if (Platform.OS !== 'web') return null;

    return (
        <Pressable
            testID="skip-to-content"
            role="link"
            accessibilityRole="link"
            focusable
            onPress={focusContent}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            className="min-h-touch justify-center bg-surface-sunken px-4 py-1"
            style={focused ? undefined : SKIP_LINK_HIDDEN}
        >
            <Text variant="caption" className="text-content-on-brand-subtle underline">
                {t('marketplace:nav.skipToContent')}
            </Text>
        </Pressable>
    );
}

export function MarketplaceShell({ children }: MarketplaceShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const { locale, setLocale } = useLocale();
    const { state: connectivity } = useOnlineStatus();
    const runPrototypeAction = usePrototypeAction();

    const navigation = useMemo<readonly NavigationItem[]>(
        () =>
            MARKETPLACE_NAVIGATION.map((item) => ({
                key: item.key,
                // A destination a later wave owns says so in its own label. Doc 17, MKT-04:
                // show the capability, and state what unlocks it.
                label:
                    item.status === 'available'
                        ? t(item.labelKey)
                        : t('marketplace:nav.plannedSuffix', { label: t(item.labelKey) }),
                icon: item.icon,
                active: pathname === item.href,
                testID: `marketplace-nav-${item.key}`,
                onPress: () => {
                    if (item.status === 'available') {
                        router.push(item.href as never);
                        return;
                    }
                    runPrototypeAction({
                        contract: item.contract ?? item.href,
                        message: t('marketplace:nav.plannedNotice', { label: t(item.labelKey) }),
                    });
                },
            })),
        [pathname, router, runPrototypeAction, t],
    );

    /** Remember the page the person was on, then send them to authenticate. */
    const goToAuth = useCallback(
        (href: '/sign-in' | '/register') => {
            recordResumeIntent({ href: pathname, labelKey: 'marketplace:resume.thisPage' });
            router.push(href);
        },
        [pathname, router],
    );

    const banner = (
        <View>
            <SkipToContent />
            <DevBanner />
            <OfflineIndicator testID="offline-indicator" state={connectivity} />
        </View>
    );

    const brand = (
        <Pressable
            testID="brand-mark"
            role="link"
            accessibilityRole="link"
            accessibilityLabel={t('marketplace:brand.homeLabel')}
            focusable
            onPress={() => {
                router.push('/');
            }}
            className="min-h-touch justify-center pe-2"
        >
            <Text variant="bodyStrong" className="text-lg text-content-primary">
                {t('marketplace:brand.name')}
            </Text>
        </Pressable>
    );

    /*
     * Two changes from `wrap={false}`, and both are needed — either alone does nothing.
     *
     * These three controls are 263 px wide together, which is most of a 320 px phone before the
     * brand mark has had any. With `wrap={false}` the *document* was 472 px wide inside a 390 px
     * window at every viewport below `md`, so the whole page drifted sideways under the thumb.
     *
     * `wrap` (the `Inline` default, and it says why: unwrapped rows overflow) lets the group use a
     * second line. `shrink` is what makes that possible at all: React Native Web gives every `View`
     * `flex-shrink: 0`, so a wrapping row still takes its max-content width and never reaches the
     * point where wrapping would happen. The pair is the smallest change that makes the top bar fit.
     */
    const topbarEnd = (
        <Inline space="xs" justify="end" className="shrink">
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
                testID="marketplace-register"
                size="sm"
                variant="ghost"
                label={t('marketplace:nav.register')}
                onPress={() => {
                    goToAuth('/register');
                }}
            />
            <Button
                testID="marketplace-sign-in"
                size="sm"
                variant="primary"
                label={t('marketplace:nav.signIn')}
                onPress={() => {
                    goToAuth('/sign-in');
                }}
            />
        </Inline>
    );

    const footerLinks: readonly {
        readonly key: string;
        readonly labelKey: string;
        readonly href: string;
    }[] = [
        { key: 'discover', labelKey: 'marketplace:nav.discover', href: '/discover' },
        { key: 'kitchens', labelKey: 'marketplace:nav.kitchens', href: '/kitchens' },
        { key: 'dietitians', labelKey: 'marketplace:nav.dietitians', href: '/dietitians' },
        { key: 'how-it-works', labelKey: 'marketplace:nav.howItWorks', href: '/how-it-works' },
        { key: 'for-business', labelKey: 'marketplace:nav.forBusiness', href: '/for-business' },
        { key: 'sign-in', labelKey: 'marketplace:nav.signIn', href: '/sign-in' },
    ];

    const footer = (
        <Stack space="sm" testID="marketplace-footer">
            <Text variant="bodyStrong">{t('marketplace:brand.name')}</Text>
            <Text tone="secondary" variant="caption">
                {t('marketplace:footer.about')}
            </Text>
            <Inline space="sm" wrap>
                {footerLinks.map((link) => (
                    <Pressable
                        key={link.key}
                        testID={`footer-${link.key}`}
                        role="link"
                        accessibilityRole="link"
                        focusable
                        onPress={() => {
                            router.push(link.href as never);
                        }}
                        className="min-h-touch justify-center pe-3"
                    >
                        <Text variant="caption" className="text-content-on-brand-subtle underline">
                            {t(link.labelKey)}
                        </Text>
                    </Pressable>
                ))}
            </Inline>
            {/*
             * There are no published terms, privacy notice or licence to link to: this is a
             * prototype over synthetic data and linking to a page that does not exist would be a
             * dead control in the one place a person is most entitled to expect a real document.
             * Saying so is the honest substitute.
             */}
            <Text testID="footer-legal" tone="secondary" variant="caption">
                {t('marketplace:footer.legalPrototype')}
            </Text>
        </Stack>
    );

    return (
        <AppShell
            testID={SHELL_TEST_ID}
            variant="marketplace"
            title={t('marketplace:brand.tagline')}
            navigation={navigation}
            banner={banner}
            topbarStart={brand}
            topbarEnd={topbarEnd}
            footer={footer}
        >
            {children}
        </AppShell>
    );
}
