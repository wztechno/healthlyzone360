import {
    AppShell,
    Button,
    Icon,
    Inline,
    OfflineIndicator,
    Stack,
    Text,
    inputControlClassName,
    inputFrameClassName,
} from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';

import { recordResumeIntent } from '../features/marketplace/resume-intent.ts';
import { useLogoutMutation } from '../data/hooks.ts';
import { useCartQuery } from '../data/marketplace-hooks.ts';
import { isPathAvailable } from '../features/availability.ts';
import { QUERY_PARAM } from '../features/marketplace/filter-bar.tsx';
import { marketplaceNavigation } from '../navigation/consumer-items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useSession } from '../session/session-provider.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

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
 *   person gets "My home", basket and sign-out — never a second Sign-in button that pretends they
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

export function MarketplaceShell({ children }: MarketplaceShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const { locale, setLocale } = useLocale();
    const { state: connectivity } = useOnlineStatus();
    const { phase, me } = useSession();
    const logout = useLogoutMutation();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    // Count only while signed in: `getCart` opens a basket lazily, and an anonymous visit must not
    // create one just to paint a zero. Guests who add a meal are steered through the guest-entry
    // dialog onto checkout instead.
    const cart = useCartQuery(signedIn);
    const cartCount = cart.data?.itemCount ?? 0;
    const cartLabel = t('marketplace:consumer.nav.cart');
    const cartButtonLabel =
        cartCount > 0
            ? t('marketplace:consumer.nav.cartWithCount', {
                  label: cartLabel,
                  items: cartCount,
              })
            : cartLabel;

    // Falls back to the generic destination label rather than to an empty control: `me` is null for
    // one render after a cold start, and a trigger with no name is a button nobody can describe.
    const accountName = me?.profile.displayName ?? t('marketplace:nav.myHome');

    /*
     * Available destinations only — the table keeps every destination the product will have, and
     * `../features/availability.ts` decides which of them has a backend to reach today.
     *
     * Secondary destinations are dropped as well. "How it works" and "For business" are marketing
     * pages, and the seven-item row they made was wide enough to wrap onto a second line and shove
     * the account controls into one another. They are already in the footer below, listed there by
     * the same availability table, so this costs no route a way of being reached.
     */
    const navigation = useMemo<readonly NavigationItem[]>(
        () =>
            marketplaceNavigation()
                .filter((item) => item.secondary !== true)
                .map((item) => ({
                    key: item.key,
                    label: t(item.labelKey),
                    icon: item.icon,
                    active: pathname === item.href,
                    testID: `marketplace-nav-${item.key}`,
                    onPress: () => {
                        router.push(item.href as never);
                    },
                })),
        [pathname, router, t],
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
            className="min-h-touch flex-row items-center gap-2 pe-2"
        >
            {/*
             * A solid mark with one squared corner, not a gradient tile carrying a letter.
             *
             * The asymmetry *is* the mark: three corners at the default 8px radius with the
             * bottom-start at 2px reads as a plate set down on an edge, and it survives at 28px,
             * where a single letter would just be a smudge. `rounded-es-xs` is the logical corner,
             * so the squared edge mirrors under RTL rather than stranding itself on the wrong side.
             *
             * Fill and ring are semantic roles, not HealthZone's lime and ink — the structure
             * lands now and the palette pass reaches this without reopening the file. Retiring the
             * gradient also hands violet back to its one job, marking machine-generated content.
             */}
            <View className="h-7 w-7 rounded rounded-es-xs border-[1.5px] border-content-primary bg-surface-brand" />
            <RNText className="text-xl tracking-display text-content-primary">
                {t('marketplace:brand.name')}
            </RNText>
        </Pressable>
    );

    /*
     * Search belongs to the chrome, not to one screen.
     *
     * It used to live in `PageHero`'s trailing panel, which put it on the four screens that use a
     * hero and nowhere else: from a meal detail page there was no way to start a new search but
     * the back button. In the bar it is reachable from every marketplace surface.
     *
     * It holds nothing but the draft term. Submitting pushes `/meals?q=`, and
     * `useMarketplaceFilters` already reads that param — so the catalogue's existing search,
     * filter, sort and pagination behaviour picks the term up unchanged and there is no second
     * query layer here to drift out of step with it. An empty term goes to the bare catalogue
     * rather than to `?q=`, so clearing the box is a route a person can also reach by hand.
     *
     * Hidden below `md`: 340px of input cannot share a phone bar with a brand mark and a basket,
     * and the catalogue keeps its own search field on the screen where it belongs.
     */
    const [searchDraft, setSearchDraft] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);

    const submitSearch = useCallback(() => {
        const term = searchDraft.trim();
        router.push(
            (term === '' ? '/meals' : `/meals?${QUERY_PARAM}=${encodeURIComponent(term)}`) as never,
        );
    }, [router, searchDraft]);

    const searchField = (
        <View
            className={`${inputFrameClassName({
                invalid: false,
                focused: searchFocused,
                disabled: false,
            })} hidden w-[340px] min-w-0 shrink md:flex`}
        >
            <Icon name="search" className="text-content-disabled" />
            <TextInput
                testID="marketplace-search"
                accessibilityLabel={t('marketplace:nav.searchLabel')}
                placeholder={t('marketplace:nav.searchPlaceholder')}
                value={searchDraft}
                onChangeText={setSearchDraft}
                onFocus={() => {
                    setSearchFocused(true);
                }}
                onBlur={() => {
                    setSearchFocused(false);
                }}
                onSubmitEditing={submitSearch}
                returnKeyType="search"
                className={inputControlClassName}
            />
        </View>
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
    /*
     * Two groups, not one run of six controls.
     *
     * At `xs` (4px) the search box, the account card and the basket sat hard against one another
     * and read as a single undifferentiated block — the eye could not tell where one control ended
     * and the next began. The design separates the search from the account controls by a clear
     * margin and spaces the controls themselves more loosely than that, so the nesting here mirrors
     * it: 16px between the two groups, 8px inside the action group.
     */
    const topbarEnd = (
        <Inline space="md" justify="end" className="min-w-0 shrink">
            {searchField}
            <Inline space="sm" justify="end">
                {signedIn ? (
                    <>
                        {/*
                         * The account controls sit in the row, not behind a menu.
                         *
                         * A menu was tried and taken back out: it collapses four controls into one,
                         * but it also hides the language switch and the appearance switch behind a
                         * press, and those are the two people reach for without being told where
                         * they are. Sign out likewise — a way out that has to be hunted for is a
                         * worse trade than a denser row.
                         *
                         * The cost is real and known: this row carries six controls plus a search
                         * field, so it is tighter than the design's, which draws two. If it ever
                         * crowds again, the fix is the menu — the `Popover` still supports it
                         * (`triggerVariant="button"`, `align="end"`) — not narrower gaps.
                         *
                         * `displayName` is the field the profile keeps for naming a person, so
                         * mononyms and non-Latin name orders come through as entered rather than
                         * being reassembled from given and family parts.
                         */}
                        <Button
                            testID="marketplace-my-home"
                            size="sm"
                            // Outlined, not borderless: a bordered box is what tells you the name
                            // is a control and not a label saying who is signed in.
                            variant="secondary"
                            label={accountName}
                            onPress={() => {
                                router.push('/customer' as never);
                            }}
                        />
                        <Button
                            testID="marketplace-basket"
                            size="sm"
                            variant="primary"
                            label={cartButtonLabel}
                            /*
                             * No leading glyph. The design's cart is the word and the count, nothing
                             * else, and the basket icon in front of the word "Basket" was saying the
                             * same thing twice while squeezing the count into the corner.
                             *
                             * The count is a filled pill against the button's own fill — light chip on
                             * the strong fill here, the design's lime chip on ink once the palette
                             * lands. It needs the width and the vertical padding to read as a chip
                             * rather than as a stray character: at `min-w-[20px] px-1.5` with no
                             * `py`, a single digit rendered as a cramped white square.
                             */
                            iconEnd={
                                cartCount === 0 ? undefined : (
                                    <View
                                        testID="marketplace-basket-count"
                                        className="min-w-[24px] items-center justify-center rounded-full bg-surface-raised px-2 py-0.5"
                                    >
                                        <RNText className="text-xs font-semibold text-surface-brand">
                                            {String(cartCount)}
                                        </RNText>
                                    </View>
                                )
                            }
                            onPress={() => {
                                router.push('/customer/cart' as never);
                            }}
                        />
                    </>
                ) : (
                    <>
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
                    </>
                )}
                {/*
                 * Shared by both states, and last in the row — after the destination the person
                 * came for. Sign out stays `quiet`: outlined so it does not read as disabled, but
                 * never the strongest control in a row that contains the basket.
                 */}
                <Button
                    testID="locale-toggle"
                    size="sm"
                    variant="ghost"
                    label={locale.startsWith('ar') ? 'English' : t('common:locale.arabic')}
                    onPress={() => {
                        void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                    }}
                />
                <ThemeToggle />
                {signedIn ? (
                    <Button
                        testID="marketplace-sign-out"
                        size="sm"
                        variant="quiet"
                        label={t('common:action.signOut')}
                        loading={logout.isPending}
                        onPress={() => {
                            logout.mutate(undefined, {
                                onSuccess: () => {
                                    router.replace('/' as never);
                                },
                            });
                        }}
                    />
                ) : null}
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
        signedIn
            ? { key: 'my-home', labelKey: 'marketplace:nav.myHome', href: '/customer' }
            : { key: 'sign-in', labelKey: 'marketplace:nav.signIn', href: '/sign-in' },
    ].filter((link) => isPathAvailable(link.href));

    const footer = (
        <Stack
            space="sm"
            testID="marketplace-footer"
            className="bg-surface-canopy p-8 md:px-10 lg:px-11"
        >
            <RNText className="text-base text-content-on-canopy">
                {t('marketplace:brand.name')}
            </RNText>
            <RNText className="text-sm text-content-on-canopy-muted">
                {t('marketplace:footer.about')}
            </RNText>
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
                        <RNText className="text-sm text-content-on-canopy-muted underline">
                            {t(link.labelKey)}
                        </RNText>
                    </Pressable>
                ))}
            </Inline>
            {/*
             * There are no published terms, privacy notice or licence to link to: this is a
             * prototype over synthetic data and linking to a page that does not exist would be a
             * dead control in the one place a person is most entitled to expect a real document.
             * Saying so is the honest substitute.
             */}
            <RNText testID="footer-legal" className="text-xs text-content-on-canopy-muted">
                {t('marketplace:footer.legalPrototype')}
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
        >
            {children}
        </AppShell>
    );
}
