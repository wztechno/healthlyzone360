import {
    AppShell,
    Button,
    Icon,
    IconButton,
    Inline,
    OfflineIndicator,
    Stack,
    Text,
    useBreakpoint,
    useMotion,
    useTheme,
} from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Platform, Pressable, Text as RNText, View } from 'react-native';

import { recordResumeIntent } from '../features/marketplace/resume-intent.ts';
import { useLogoutMutation } from '../data/hooks.ts';
import { useCartQuery } from '../data/marketplace-hooks.ts';
import { isPathAvailable } from '../features/availability.ts';
import {
    clearPendingAdd,
    readPendingAdd,
    usePendingAdd,
} from '../features/commerce/pending-add.ts';
import { useBasketAdd } from '../features/commerce/use-basket-add.tsx';
import type { BasketAdd } from '../features/commerce/use-basket-add.tsx';
import { LEGAL_PAGES } from '../features/legal/legal-pages.tsx';
import { ShopViewOnlyProvider, isShopViewOnly } from '../features/marketplace/shop-view-only.tsx';
import { marketplaceNavigation } from '../navigation/consumer-items.ts';
import { availableWorkspaceAreas } from '../navigation/items.ts';
import { useCurrentHref, useGoToAuth } from '../navigation/use-return-to.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useAccessState, useSession } from '../session/session-provider.tsx';
import { useScrollPlace } from './use-scroll-place.ts';

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
 * * **Auth-aware trailing actions.** Anonymous visitors get sign-in and register. A signed-in
 *   person gets the account icon and the basket — never a second Sign-in button that pretends they
 *   are still a guest. The basket sits with those account controls because the person just came
 *   from browsing meals on this chrome; burying it only under `/customer` would hide the thing
 *   they just filled.
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

/**
 * The theme glyph, turning in as it changes — the accepted design's sun/moon swap: a quarter turn
 * and a grow from 60%, overshooting a little before it settles. It is keyed on the theme by its
 * caller, so each switch mounts a fresh one. Under reduced motion it is simply there.
 */
function ThemeGlyph({ dark }: { readonly dark: boolean }) {
    const { enabled } = useMotion();
    // State, not a ref: the value is read while rendering (its interpolations), which a ref may not be.
    const [progress] = useState(() => new Animated.Value(enabled ? 0 : 1));

    useEffect(() => {
        if (!enabled) {
            progress.setValue(1);
            return;
        }
        const animation = Animated.timing(progress, {
            toValue: 1,
            duration: 450,
            easing: Easing.bezier(0.34, 1.4, 0.64, 1),
            useNativeDriver: true,
        });
        animation.start();
        return () => {
            animation.stop();
        };
    }, [enabled, progress]);

    return (
        <Animated.View
            style={
                enabled
                    ? {
                          opacity: progress.interpolate({
                              inputRange: [0, 1],
                              outputRange: [0, 1],
                              extrapolate: 'clamp',
                          }),
                          transform: [
                              {
                                  rotate: progress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: ['-90deg', '0deg'],
                                  }),
                              },
                              {
                                  scale: progress.interpolate({
                                      inputRange: [0, 1],
                                      outputRange: [0.6, 1],
                                  }),
                              },
                          ],
                      }
                    : undefined
            }
        >
            <Icon name={dark ? 'sun' : 'moon'} size="lg" className="text-content-primary" />
        </Animated.View>
    );
}

/**
 * The add a signed-out (or unconfirmed) person asked for, made once they can have a basket.
 *
 * `commerce/use-basket-add.tsx` writes the add down before sending the person to sign in, register
 * or confirm their address, and every one of those trips ends back inside this chrome — on the page
 * they left, through `?returnTo=`. So the chrome is where the add is finished, with the same "Added"
 * toast and, if the basket has turned out to hold another kitchen's meals, the same question.
 *
 * It waits for two things: a session that can hold a basket (`contextPending` or `ready` — an
 * unconfirmed account cannot), and the basket's first read, so the kitchen check sees what is
 * actually in it rather than an empty cache.
 *
 * **Cleared before it is made**, and read from the store rather than from the render that scheduled
 * the effect. StrictMode runs an effect twice with the same closure, and a closure that still held
 * the add would make it twice; the store, read again, is already empty the second time.
 */
function usePendingAddReplay(basket: BasketAdd, basketSettled: boolean): void {
    const { phase } = useSession();
    const pending = usePendingAdd();
    const ready = phase === 'contextPending' || phase === 'ready';
    const waiting = pending?.recordedAt ?? null;

    const replay = useEffectEvent(() => {
        const next = readPendingAdd();
        if (next === null) return;
        clearPendingAdd();
        basket.add(
            {
                id: next.mealId,
                ...(next.kitchenId === undefined ? {} : { kitchenId: next.kitchenId }),
                ...(next.choices === undefined ? {} : { choices: next.choices }),
            },
            next.quantity,
        );
    });

    useEffect(() => {
        if (waiting === null || !ready || !basketSettled) return;
        replay();
    }, [basketSettled, ready, waiting]);
}

export function MarketplaceShell({ children }: MarketplaceShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const here = useCurrentHref();
    const scrollPlace = useScrollPlace(pathname);
    const goToAuthWith = useGoToAuth();
    const { locale, setLocale } = useLocale();
    const { state: connectivity } = useOnlineStatus();
    const { phase } = useSession();
    const accessState = useAccessState();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    /** Staff look at the shop as customers see it, and act on nothing (`shop-view-only.tsx`). */
    const viewOnly = signedIn && isShopViewOnly(accessState);
    const logout = useLogoutMutation();
    // Count only while signed in: `getCart` opens a basket lazily, and an anonymous visit must not
    // create one just to paint a zero. A signed-out Add asks the person to sign in first, and the
    // add is made here once they have (`usePendingAddReplay`). Neither for a view-only shopper, who
    // has no basket to count and may not add — the server refuses both.
    const cart = useCartQuery(signedIn && !viewOnly);
    const replayBasket = useBasketAdd({
        labelKey: 'marketplace:resume.thisPage',
        testID: 'marketplace-replay',
    });
    usePendingAddReplay(replayBasket, !viewOnly && !cart.isPending);
    const cartCount = cart.data?.itemCount ?? 0;
    const cartLabel = t('marketplace:consumer.nav.cart');
    const cartButtonLabel =
        cartCount > 0
            ? t('marketplace:consumer.nav.cartWithCount', {
                  label: cartLabel,
                  items: cartCount,
              })
            : cartLabel;

    /*
     * Available destinations only — the table keeps every destination the product will have, and
     * `../features/availability.ts` decides which of them has a backend to reach today.
     *
     * Secondary destinations are dropped as well. "How it works" is a marketing page, and a longer
     * row wraps onto a second line and shoves the account controls into one another; it is in the
     * footer below, listed there by the same availability table. "Business" is a header destination
     * since the accepted shop design (it opens `/for-business`).
     */
    /*
     * A header destination is a place, not an action (CHROME-11). Pressing the one you are on used
     * to push it again: a second copy in history, so the next Back seemed to do nothing, and a
     * fresh mount that dropped the page's query — the filters on `/meals`, the section on the
     * account page. Already there, it does nothing; anywhere else `navigate` reuses an entry for the
     * same route rather than stacking one.
     */
    const navigateTo = useCallback(
        (href: string) => {
            if (pathname === href) return;
            router.navigate(href as never);
        },
        [pathname, router],
    );

    const navigation = useMemo<readonly NavigationItem[]>(
        () =>
            marketplaceNavigation()
                .filter((item) => item.secondary !== true)
                .map((item) => ({
                    key: item.key,
                    label: t(item.labelKey),
                    icon: item.icon,
                    // A section, not a page: HealthZone keeps "Menu" underlined on a meal and
                    // "Kitchens" on a storefront, so a destination owns everything beneath it.
                    active: pathname === item.href || pathname.startsWith(`${item.href}/`),
                    testID: `marketplace-nav-${item.key}`,
                    onPress: () => {
                        navigateTo(item.href);
                    },
                })),
        [navigateTo, pathname, t],
    );

    /*
     * Remember the page the person was on, then send them to authenticate with it as the return.
     * The return is what brings them back; the resume intent is the fallback for a trip that ends
     * somewhere the return cannot follow (see `resume-intent.ts`), and it is the whole href, query
     * included, so the filters come back with the page (AUTH-13).
     */
    const goToAuth = useCallback(
        (href: '/sign-in' | '/register') => {
            recordResumeIntent({ href: here, labelKey: 'marketplace:resume.thisPage' });
            goToAuthWith(href);
        },
        [goToAuthWith, here],
    );

    const onAccount = pathname === '/customer/account' || pathname.startsWith('/customer/account/');
    const onBasket = pathname === '/customer/cart';

    const banner = (
        <View>
            <SkipToContent />
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
                // The marketplace home itself, not `/`: `/` is the launch resolver, which drew a
                // blank frame first and sent an unconfirmed account to verification (browse-10).
                navigateTo('/discover');
            }}
            className="min-h-touch min-w-0 shrink flex-row items-center gap-2 pe-2 lg:shrink-0"
        >
            {/*
             * The accepted design's mark: a round brand disc carrying a leaf, sized to the pill
             * bar's other round controls. Fill and glyph are semantic roles, so a palette change
             * reaches it without reopening the file.
             */}
            <View className="h-9 w-9 items-center justify-center rounded-full bg-surface-brand md:h-10 md:w-10">
                <Icon name="leaf" className="text-content-on-brand" />
            </View>
            <RNText
                numberOfLines={1}
                className="shrink font-display text-lg font-bold tracking-display text-content-primary md:text-xl lg:shrink-0"
            >
                {t('marketplace:brand.name')}
            </RNText>
        </Pressable>
    );

    /*
     * No search in the bar: the accepted design ends it in the destinations, the two switches,
     * the account and the cart. The menu and Discover carry their own search fields.
     */
    const wideBar = useBreakpoint().atLeast('xl');

    /*
     * The trailing controls: language, appearance, the account and the basket.
     *
     * They used to sit behind the person's name in an account menu — account, profile, language,
     * appearance and sign out in one dropdown. The common pattern is flatter, so each is one press
     * from the bar: the two switches are small controls here (and still links in the footer), the
     * account is an icon that opens the account page, and Sign out lives at the foot of that page's
     * own menu. Staff also get a second icon, to their staff profile.
     */
    const { isDark, toggleTheme } = useTheme();
    const toggleLocale = useCallback(() => {
        void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
    }, [locale, setLocale]);
    const otherLocaleLabel = locale.startsWith('ar') ? 'English' : t('common:locale.arabic');
    const themeLabel = isDark ? t('common:theme.switchToLight') : t('common:theme.switchToDark');

    /*
     * The language switch as the bar draws it: a round button beside the theme switch, showing the
     * other language's mark — "ع" on an English page, "EN" on an Arabic one — and named in full
     * for a screen reader. The staff shells keep the worded `LocaleToggle`; the testID is the same,
     * because it is the same control.
     */
    const themeButton = (
        <IconButton
            testID="theme-toggle"
            size="sm"
            variant="ghost"
            className="rounded-full border-stroke"
            icon={<ThemeGlyph key={isDark ? 'dark' : 'light'} dark={isDark} />}
            label={themeLabel}
            onPress={toggleTheme}
        />
    );

    const localeButton = (
        <IconButton
            testID="locale-toggle"
            size="sm"
            variant="ghost"
            className="rounded-full border-stroke"
            icon={
                <RNText className="font-display text-base font-bold text-content-primary">
                    {locale.startsWith('ar') ? 'EN' : 'ع'}
                </RNText>
            }
            label={otherLocaleLabel}
            onPress={toggleLocale}
        />
    );

    // A ring and its own glyph colour, like the theme switch beside it.
    // "You are here" on the account pages, as the destinations show it with their underline.
    const accountButton = (
        <IconButton
            testID="marketplace-account"
            size="sm"
            variant="ghost"
            className={
                onAccount
                    ? 'rounded-full border-stroke-strong bg-surface-sunken'
                    : 'rounded-full border-stroke'
            }
            icon={<Icon name="user" size="lg" className="text-content-primary" />}
            label={t('marketplace:nav.account')}
            {...(onAccount ? { 'aria-current': 'page' as const } : {})}
            aria-selected={onAccount}
            onPress={() => {
                navigateTo('/customer/account');
            }}
        />
    );

    /*
     * Staff only: their profile, from which the admin bottom bar reaches every workspace. "Staff" is
     * any workspace beyond the customer one — the same list `/workspace` draws its tiles from — so a
     * plain customer never sees an icon that would lead them to a page of roles and permissions.
     */
    const isStaff = availableWorkspaceAreas(accessState).some(
        (option) => option.area !== 'customer',
    );
    const staffProfileButton = isStaff ? (
        <IconButton
            testID="marketplace-staff-profile"
            size="sm"
            variant="ghost"
            className="rounded-full border-stroke"
            icon={<Icon name="shield" size="lg" className="text-content-primary" />}
            label={t('common:nav.profile')}
            onPress={() => {
                router.push('/profile' as never);
            }}
        />
    ) : null;

    /*
     * The cart: a basket and its count, always. The design draws the count chip even at zero, and a
     * chip that appears only once something is added makes the button change width under the
     * pointer at the moment of the first add. The chip is the button's colours inverted.
     */
    const cartButton = (
        <Pressable
            testID="marketplace-basket"
            role="link"
            accessibilityRole="link"
            accessibilityLabel={cartButtonLabel}
            {...(onBasket ? { 'aria-current': 'page' as const } : {})}
            aria-selected={onBasket}
            focusable
            onPress={() => {
                navigateTo('/customer/cart');
            }}
            // The accepted design's cart: an ink pill, 48px tall, the word beside the basket glyph
            // and the count in a brand disc. The word hides on a phone, where the pill is the glyph
            // and the count.
            className="h-12 flex-row items-center gap-2 rounded-full bg-content-primary pe-2.5 ps-3.5 transition duration-normal ease-standard active:opacity-80 md:pe-3"
        >
            <Icon name="shoppingBasket" className="text-surface-base" />
            <RNText className="hidden text-sm font-semibold text-surface-base md:flex">
                {cartLabel}
            </RNText>
            <View
                testID="marketplace-basket-count"
                className="h-[22px] min-w-[22px] items-center justify-center rounded-full bg-surface-brand px-1.5"
            >
                <RNText className="text-xs font-bold tabular-nums text-content-on-brand">
                    {String(cartCount)}
                </RNText>
            </View>
        </Pressable>
    );

    /*
     * Staff, viewing the shop: the way back to the workspace page, and Sign out — in place of the
     * account, the staff profile and the basket, which are a customer's. Labelled buttons at every
     * width: they are the only two things staff do here.
     */
    const staffControls = (
        <>
            <Button
                testID="marketplace-workspaces-button"
                size="sm"
                variant="secondary"
                label={t('marketplace:nav.workspaces')}
                onPress={() => {
                    router.push('/workspace' as never);
                }}
            />
            <Button
                testID="marketplace-sign-out"
                size="sm"
                variant="quiet"
                label={t('common:action.signOut')}
                loading={logout.isPending}
                onPress={() => {
                    logout.mutate(undefined, {
                        onSuccess: () => {
                            router.replace('/sign-in' as never);
                        },
                    });
                }}
            />
        </>
    );

    /*
     * One line from `xl`. A wrapping row breaks a line *before* it lets a child shrink, so at 1280px
     * the search dropped onto a second line at full width instead of narrowing. From `xl` the bar
     * keeps the destinations on one line (see `AppShell`), and the search — which is `min-w-0
     * shrink` — is the part that yields, as HealthZone draws it. Below `xl` the group may wrap:
     * React Native Web gives every `View` `flex-shrink: 0`, so without `shrink` and `wrap` the row
     * would take its max-content width and push the document sideways on a phone.
     *
     * Narrower bars carry fewer controls rather than wrapping. The language and appearance switches
     * and Register wait for `lg`: both switches are links in the footer at every width, and the
     * sign-in page leads to registration. The staff profile icon waits for `lg` too — at 768px it
     * pushed "Plans" onto a second line in Arabic. What is left on a
     * phone is the menu, the brand and the account and basket (or Sign in) — the controls a person
     * reaches for mid-order. They are hidden by class, not left unrendered, so the bar is the same
     * tree at every width and only its paint changes.
     */
    const topbarEnd = (
        <Inline space="md" justify="end" wrap={!wideBar} className="min-w-0 shrink">
            <Inline space="sm" justify="end">
                <View className="hidden lg:flex">{localeButton}</View>
                <View className="hidden lg:flex">{themeButton}</View>
                {viewOnly ? (
                    staffControls
                ) : signedIn ? (
                    <>
                        {staffProfileButton === null ? null : (
                            <View className="hidden lg:flex">{staffProfileButton}</View>
                        )}
                        {accountButton}
                        {cartButton}
                    </>
                ) : (
                    <>
                        <View className="hidden lg:flex">
                            <Button
                                testID="marketplace-register"
                                size="sm"
                                variant="secondary"
                                label={t('marketplace:nav.register')}
                                onPress={() => {
                                    goToAuth('/register');
                                }}
                            />
                        </View>
                        <Button
                            testID="marketplace-sign-in"
                            size="sm"
                            variant="primary"
                            label={t('marketplace:nav.signIn')}
                            onPress={() => {
                                goToAuth('/sign-in');
                            }}
                        />
                    </>
                )}
            </Inline>
        </Inline>
    );

    // Filtered by the same availability table the navigation uses: the footer is the one place a
    // dead link survives a redesign, because nobody looks at it.
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
        // Not decoration: CC BY and CC BY-SA ask for attribution reasonable to the medium, and for
        // the images that cannot carry a credit beside them — a grid card, a tile, a 20px
        // catalogue thumbnail — this link is where that obligation is actually discharged.
        { key: 'image-credits', labelKey: 'marketplace:nav.imageCredits', href: '/image-credits' },
        // No "My home" when signed in: the home is Discover, which leads this list already.
        ...(signedIn
            ? []
            : [{ key: 'sign-in', labelKey: 'marketplace:nav.signIn', href: '/sign-in' }]),
        // Empty until the owner supplies the text: nothing links to a page that does not exist.
        ...LEGAL_PAGES.map((page) => ({
            key: `legal-${page.slug}`,
            labelKey: page.titleKey,
            href: `/legal/${page.slug}`,
        })),
    ].filter((link) => isPathAvailable(link.href));

    /** A footer link: small muted print, underlined, with a touch target around it. */
    const footerLink = (key: string, label: string, onPress: () => void) => (
        <Pressable
            key={key}
            testID={`footer-${key}`}
            role="link"
            accessibilityRole="link"
            focusable
            onPress={onPress}
            className="min-h-touch justify-center"
        >
            <RNText className="text-xs text-content-secondary underline">{label}</RNText>
        </Pressable>
    );

    /*
     * The design's foot of the page: one quiet block of small print under a hairline, on the
     * page's measure (`AppShell` draws the rule). It carries what a footer must — the secondary
     * destinations, the image credits the CC licences ask for, the language and appearance
     * switches a signed-out visitor has nowhere else to find, and who we are — in the
     * design's 12px muted type rather than as a second band of chrome.
     */
    const footer = (
        <Stack space="xs" testID="marketplace-footer" className="pb-6 pt-3">
            <Inline space="md" wrap>
                {footerLinks.map((link) =>
                    footerLink(link.key, t(link.labelKey), () => {
                        // Sign in from the foot of a page carries the page, like the header's
                        // (AUTH-14); the rest are destinations, like the header's.
                        if (link.href === '/sign-in') goToAuth('/sign-in');
                        else navigateTo(link.href);
                    }),
                )}
                {footerLink('locale', otherLocaleLabel, toggleLocale)}
                {footerLink('theme', themeLabel, toggleTheme)}
            </Inline>
            <RNText testID="footer-legal" className="text-xs text-content-secondary">
                {t('marketplace:footer.about')}
            </RNText>
        </Stack>
    );

    return (
        <AppShell
            testID={SHELL_TEST_ID}
            variant="marketplace"
            navigation={navigation}
            banner={banner}
            topbarStart={brand}
            topbarEnd={topbarEnd}
            footer={footer}
            // The menu drawer closes when the page changes under it (CHROME-15), and each page
            // opens at its top or where it was left (browse-04, `scroll-memory.ts`).
            pathname={pathname}
            contentRef={scrollPlace.contentRef}
            onContentScroll={scrollPlace.onContentScroll}
            onContentSizeChange={scrollPlace.onContentSizeChange}
            onContentLayout={scrollPlace.onContentLayout}
        >
            <ShopViewOnlyProvider value={viewOnly}>{children}</ShopViewOnlyProvider>
            {/* The replayed add's own question, when the basket holds another kitchen's meals. */}
            {replayBasket.dialog}
        </AppShell>
    );
}
