import {
    AppShell,
    Button,
    Icon,
    Inline,
    OfflineIndicator,
    Stack,
    Text,
    inputControlClassName,
    Menu,
    inputFrameClassName,
    useBreakpoint,
    useTheme,
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
                    // A section, not a page: HealthZone keeps "Menu" underlined on a meal and
                    // "Kitchens" on a storefront, so a destination owns everything beneath it.
                    active: pathname === item.href || pathname.startsWith(`${item.href}/`),
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
            <View className="h-[26px] w-[26px] rounded rounded-es-xs border-[1.5px] border-surface-canopy bg-surface-brand" />
            <RNText className="font-display text-xl font-extrabold tracking-display text-content-primary">
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
    const wideBar = useBreakpoint().atLeast('xl');
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
     * The account control: the design's bordered name button, opening the account menu.
     *
     * HealthZone's header ends in exactly two controls — the person's name and the cart — and the
     * row used to carry six (name, basket, language, appearance, sign out, plus search). The four
     * that are not destinations moved behind the name, which is where a person looks for "me":
     * their account, their home, the language and appearance switches, and sign out. The language
     * and appearance switches are also in the footer, so a signed-out visitor still has them and
     * nobody has to open a menu to find the one control they cannot read the page without.
     *
     * `displayName` is the field the profile keeps for naming a person, so mononyms and non-Latin
     * name orders come through as entered rather than being reassembled from given and family parts.
     */
    const { isDark, toggleTheme } = useTheme();
    const toggleLocale = useCallback(() => {
        void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
    }, [locale, setLocale]);
    const otherLocaleLabel = locale.startsWith('ar') ? 'English' : t('common:locale.arabic');
    const themeLabel = isDark ? t('common:theme.switchToLight') : t('common:theme.switchToDark');
    const accountMenuLabel = t('marketplace:nav.accountMenu', { name: accountName });

    const accountMenu = (
        <Menu
            testID="marketplace-account-menu"
            label={accountMenuLabel}
            align="end"
            sections={[
                {
                    items: [
                        {
                            key: 'account',
                            label: t('marketplace:nav.account'),
                            testID: 'marketplace-account',
                            onSelect: () => {
                                router.push('/customer/account' as never);
                            },
                        },
                        {
                            key: 'my-home',
                            label: t('marketplace:nav.myHome'),
                            testID: 'marketplace-my-home',
                            onSelect: () => {
                                router.push('/customer' as never);
                            },
                        },
                        // The person's own details card — name, email, organisations, devices. It
                        // was one press away from the old sidebar, so it is one press away here.
                        {
                            key: 'profile',
                            label: t('marketplace:consumer.nav.profile'),
                            testID: 'marketplace-profile',
                            onSelect: () => {
                                router.push('/profile' as never);
                            },
                        },
                    ],
                },
                {
                    items: [
                        {
                            key: 'locale',
                            label: otherLocaleLabel,
                            testID: 'locale-toggle',
                            onSelect: toggleLocale,
                        },
                        {
                            key: 'theme',
                            label: themeLabel,
                            testID: 'theme-toggle',
                            onSelect: toggleTheme,
                        },
                    ],
                },
                {
                    items: [
                        {
                            key: 'sign-out',
                            label: t('common:action.signOut'),
                            testID: 'marketplace-sign-out',
                            disabled: logout.isPending,
                            onSelect: () => {
                                logout.mutate(undefined, {
                                    onSuccess: () => {
                                        router.replace('/' as never);
                                    },
                                });
                            },
                        },
                    ],
                },
            ]}
            trigger={({ triggerProps, toggle }) => (
                <Pressable
                    {...triggerProps}
                    testID="marketplace-account-trigger"
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={accountMenuLabel}
                    focusable
                    onPress={toggle}
                    // The design's name button: outlined on the strong stroke, 10px radius, the
                    // name at 14px medium. Outlined, not borderless — a bordered box is what tells
                    // you the name is a control and not a label saying who is signed in.
                    className="min-h-touch max-w-[180px] flex-row items-center rounded-lg border border-stroke-strong bg-transparent px-3.5"
                >
                    <RNText
                        numberOfLines={1}
                        className="text-sm font-medium text-content-primary text-start"
                    >
                        {accountName}
                    </RNText>
                </Pressable>
            )}
        />
    );

    /*
     * The cart: the word and its count, always. The design draws the count chip even at zero, and a
     * chip that appears only once something is added makes the button change width under the
     * pointer at the moment of the first add. The chip is the button's colours inverted.
     */
    const cartButton = (
        <Button
            testID="marketplace-basket"
            size="sm"
            variant="primary"
            label={cartLabel}
            accessibilityLabel={cartButtonLabel}
            iconEnd={
                <View
                    testID="marketplace-basket-count"
                    className="min-w-[24px] items-center justify-center rounded-full bg-content-on-brand px-2 py-0.5"
                >
                    <RNText className="text-xs font-semibold tabular-nums text-surface-brand">
                        {String(cartCount)}
                    </RNText>
                </View>
            }
            onPress={() => {
                router.push('/customer/cart' as never);
            }}
        />
    );

    /*
     * One line from `xl`. A wrapping row breaks a line *before* it lets a child shrink, so at 1280px
     * the search dropped onto a second line at full width instead of narrowing. From `xl` the bar
     * keeps the destinations on one line (see `AppShell`), and the search — which is `min-w-0
     * shrink` — is the part that yields, as HealthZone draws it. Below `xl` the group may wrap:
     * React Native Web gives every `View` `flex-shrink: 0`, so without `shrink` and `wrap` the row
     * would take its max-content width and push the document sideways on a phone.
     */
    const topbarEnd = (
        <Inline space="md" justify="end" wrap={!wideBar} className="min-w-0 shrink">
            {searchField}
            <Inline space="sm" justify="end">
                {signedIn ? (
                    <>
                        {accountMenu}
                        {cartButton}
                    </>
                ) : (
                    <>
                        <Button
                            testID="marketplace-register"
                            size="sm"
                            variant="secondary"
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
        signedIn
            ? { key: 'my-home', labelKey: 'marketplace:nav.myHome', href: '/customer' }
            : { key: 'sign-in', labelKey: 'marketplace:nav.signIn', href: '/sign-in' },
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
     * switches a signed-out visitor has nowhere else to find, and the prototype disclosure — in the
     * design's 12px muted type rather than as a second band of chrome.
     */
    const footer = (
        <Stack space="xs" testID="marketplace-footer" className="pb-6 pt-3">
            <Inline space="md" wrap>
                {footerLinks.map((link) =>
                    footerLink(link.key, t(link.labelKey), () => {
                        router.push(link.href as never);
                    }),
                )}
                {footerLink('locale', otherLocaleLabel, toggleLocale)}
                {footerLink('theme', themeLabel, toggleTheme)}
            </Inline>
            {/*
             * There are no published terms, privacy notice or licence to link to: this is a
             * prototype over synthetic data and linking to a page that does not exist would be a
             * dead control in the one place a person is most entitled to expect a real document.
             * Saying so is the honest substitute.
             */}
            <RNText testID="footer-legal" className="text-xs text-content-secondary">
                {`${t('marketplace:footer.about')} ${t('marketplace:footer.legalPrototype')}`}
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
