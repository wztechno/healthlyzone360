import {
    AppShell,
    Button,
    Icon,
    IconButton,
    Inline,
    OfflineIndicator,
    Stack,
    Text,
    inputControlClassName,
    inputFrameClassName,
    useBreakpoint,
    useTheme,
} from '@healthy360/design-system';
import type { NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, Text as RNText, TextInput, View } from 'react-native';

import { recordResumeIntent } from '../features/marketplace/resume-intent.ts';
import { useCartQuery } from '../data/marketplace-hooks.ts';
import { isPathAvailable } from '../features/availability.ts';
import {
    clearPendingAdd,
    readPendingAdd,
    usePendingAdd,
} from '../features/commerce/pending-add.ts';
import { useBasketAdd } from '../features/commerce/use-basket-add.tsx';
import type { BasketAdd } from '../features/commerce/use-basket-add.tsx';
import { requestMenuSearchFocus } from '../features/catalogue/menu-search-focus.ts';
import { QUERY_PARAM } from '../features/marketplace/filter-bar.tsx';
import { marketplaceNavigation } from '../navigation/consumer-items.ts';
import { availableWorkspaceAreas } from '../navigation/items.ts';
import { withQuery } from '../navigation/return-to.ts';
import { useCurrentHref, useGoToAuth } from '../navigation/use-return-to.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { isBusinessCustomer } from '../session/machine.ts';
import { useAccessState, useSession } from '../session/session-provider.tsx';
import { LocaleToggle } from './locale-toggle.tsx';
import { ThemeToggle } from './theme-toggle.tsx';
import { useScrollPlace } from './use-scroll-place.ts';

/** The catalogue the header search narrows. */
const MENU_PATH = '/meals';

/** A search param as one string — the hooks hand back an array for a repeated key. */
function termOf(raw: string | string[] | undefined): string {
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
}

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
    const { phase, me } = useSession();
    const accessState = useAccessState();
    const signedIn = phase !== 'anonymous' && phase !== 'restoring';
    // Count only while signed in: `getCart` opens a basket lazily, and an anonymous visit must not
    // create one just to paint a zero. A signed-out Add asks the person to sign in first, and the
    // add is made here once they have (`usePendingAddReplay`).
    const cart = useCartQuery(signedIn);
    const replayBasket = useBasketAdd({
        labelKey: 'marketplace:resume.thisPage',
        testID: 'marketplace-replay',
    });
    usePendingAddReplay(replayBasket, !cart.isPending);
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
     * Secondary destinations are dropped as well. "How it works" and "For business" are marketing
     * pages, and the seven-item row they made was wide enough to wrap onto a second line and shove
     * the account controls into one another. They are already in the footer below, listed there by
     * the same availability table, so this costs no route a way of being reached.
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

    const businessCustomer = isBusinessCustomer(me?.memberships ?? []);
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
                }))
                .concat(
                    /*
                     * Business customers only: the way from the shop to the corporate area, where
                     * they order at their wholesale prices. A destination rather than an icon, so
                     * it is labelled in the bar and still reachable from the phone menu, where the
                     * bar has no room. `/workspace` picks the organisation first when none is.
                     */
                    businessCustomer
                        ? [
                              {
                                  key: 'workspaces',
                                  label: t('marketplace:nav.workspaces'),
                                  icon: 'layoutGrid' as const,
                                  active: false,
                                  testID: 'marketplace-workspaces',
                                  onPress: () => {
                                      router.push('/workspace' as never);
                                  },
                              },
                          ]
                        : [],
                ),
        [businessCustomer, navigateTo, pathname, router, t],
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
            className="min-h-touch min-w-0 shrink flex-row items-center gap-2 pe-2"
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
            <RNText
                numberOfLines={1}
                className="shrink font-display text-lg font-extrabold tracking-display text-content-primary md:text-xl"
            >
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
     * It holds nothing but the draft term, and `?q=` on `/meals` is the term itself — the same param
     * the catalogue's own search field writes (browse-06), so there is no second query layer here
     * to drift out of step with it:
     *
     * - **On the catalogue** the draft follows `?q=` — a term typed into the page's field, a chip
     *   removed, "Clear all" — and submitting sets `?q=` in place (`setParams`), so a search narrows
     *   the diet, shelf and ranges already applied instead of starting over without them.
     * - **Anywhere else** submitting opens the catalogue on the term alone. An empty term goes to
     *   the bare catalogue rather than to `?q=`, so clearing the box is a route a person can also
     *   reach by hand.
     *
     * The field is drawn from `xl` only. Between `md` and `xl` the four destinations, the field and
     * the controls do not fit on one line — at 820px the row wrapped and the destinations stacked
     * into a 200px header — so there it is a search button that opens the catalogue and puts the
     * cursor in the catalogue's own search field. Below `md` there is no room even for the button;
     * the catalogue is one press away in the menu, and its field is the first thing on it.
     */
    const globalParams = useGlobalSearchParams();
    const onMenu = pathname === MENU_PATH;
    const menuTerm = onMenu ? termOf(globalParams[QUERY_PARAM]) : '';
    const [searchDraft, setSearchDraft] = useState(menuTerm);
    // Adjusted during render rather than in an effect, so the field never paints a stale term.
    const [syncedTerm, setSyncedTerm] = useState(menuTerm);
    if (syncedTerm !== menuTerm) {
        setSyncedTerm(menuTerm);
        setSearchDraft(menuTerm);
    }
    const wideBar = useBreakpoint().atLeast('xl');
    const [searchFocused, setSearchFocused] = useState(false);

    const submitSearch = useCallback(() => {
        const term = searchDraft.trim();
        if (onMenu) {
            router.setParams({ [QUERY_PARAM]: term });
            return;
        }
        router.push(withQuery(MENU_PATH, { [QUERY_PARAM]: term }) as never);
    }, [onMenu, router, searchDraft]);

    const searchField = (
        <View
            className={`${inputFrameClassName({
                invalid: false,
                focused: searchFocused,
                disabled: false,
            })} w-[340px] min-w-0 shrink`}
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

    const searchButton = (
        <View className="hidden md:flex">
            <IconButton
                testID="marketplace-search-button"
                size="sm"
                variant="ghost"
                className="rounded-full border-stroke"
                icon={<Icon name="search" size="lg" className="text-content-primary" />}
                label={t('marketplace:nav.searchLabel')}
                onPress={() => {
                    // The catalogue as a destination — nothing new stacked when already on it —
                    // with the cursor waiting in its field, which is what "search" promised.
                    requestMenuSearchFocus();
                    navigateTo(MENU_PATH);
                }}
            />
        </View>
    );

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

    // The ring and the glyph's own colour match `ThemeToggle` beside it, for the reasons given there.
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
            icon={<Icon name="userCircle" size="lg" className="text-content-primary" />}
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
        <IconButton
            testID="marketplace-basket"
            size="sm"
            variant="primary"
            className="rounded-lg px-3"
            label={cartButtonLabel}
            {...(onBasket ? { 'aria-current': 'page' as const } : {})}
            aria-selected={onBasket}
            icon={
                <View className="flex-row items-center gap-1.5">
                    <Icon name="shoppingBasket" size="lg" className="text-content-on-brand" />
                    <View
                        testID="marketplace-basket-count"
                        className="min-w-[24px] items-center justify-center rounded-full bg-content-on-brand px-2 py-0.5"
                    >
                        <RNText className="text-xs font-semibold tabular-nums text-surface-brand">
                            {String(cartCount)}
                        </RNText>
                    </View>
                </View>
            }
            onPress={() => {
                navigateTo('/customer/cart');
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
            {wideBar ? searchField : searchButton}
            <Inline space="sm" justify="end">
                <View className="hidden lg:flex">
                    <LocaleToggle />
                </View>
                <View className="hidden lg:flex">
                    <ThemeToggle />
                </View>
                {signedIn ? (
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
                        // Sign in from the foot of a page carries the page, like the header's
                        // (AUTH-14); the rest are destinations, like the header's.
                        if (link.href === '/sign-in') goToAuth('/sign-in');
                        else navigateTo(link.href);
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
            // The menu drawer closes when the page changes under it (CHROME-15), and each page
            // opens at its top or where it was left (browse-04, `scroll-memory.ts`).
            pathname={pathname}
            contentRef={scrollPlace.contentRef}
            onContentScroll={scrollPlace.onContentScroll}
            onContentSizeChange={scrollPlace.onContentSizeChange}
            onContentLayout={scrollPlace.onContentLayout}
        >
            {children}
            {/* The replayed add's own question, when the basket holds another kitchen's meals. */}
            {replayBasket.dialog}
        </AppShell>
    );
}
