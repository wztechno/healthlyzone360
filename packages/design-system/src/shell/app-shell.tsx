import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { cx } from '../internal/class-names.ts';
import { Drawer } from '../overlays/drawer.tsx';

export const APP_SHELL_VARIANTS = [
    'public',
    'auth',
    'workspace',
    'rail',
    'kiosk',
    'driver',
    'marketplace',
    'consumer',
] as const;
export type AppShellVariant = (typeof APP_SHELL_VARIANTS)[number];

export interface NavigationItem {
    readonly key: string;
    readonly label: string;
    readonly icon?: IconName | undefined;
    readonly active?: boolean | undefined;
    /**
     * Heading this item sits under in the sidebar. Items sharing a group are drawn together under
     * one heading, in caller order; items with no group come first, unheaded. A workspace with
     * twenty destinations is a list nobody scans — "Workbench, Catalogue, Commercial, Operations"
     * is what turns it back into four short ones.
     *
     * Only the sidebar honours it. The drawer, the rail and the bottom tabs are too narrow or too
     * short for headings to buy anything.
     */
    readonly group?: string | undefined;
    /**
     * Trailing slot on the item row — a count badge for a queue destination. Honoured by the
     * sidebar and the drawer; the rail and the bottom tabs have no room for one.
     */
    readonly badge?: ReactNode | undefined;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}

export interface AppShellProps {
    readonly variant: AppShellVariant;
    readonly children: ReactNode;
    readonly title?: string | undefined;
    /**
     * Already filtered by the caller. The shell renders what it is given — permission filtering is
     * the application's job, and a shell that could hide items would be a second, weaker guard.
     */
    readonly navigation?: readonly NavigationItem[] | undefined;
    /** Leading topbar slot — brand, back control. */
    readonly topbarStart?: ReactNode | undefined;
    /** Trailing topbar slot — locale switch, avatar, sign out. */
    readonly topbarEnd?: ReactNode | undefined;
    /** Full-width strip above everything: offline indicator, mock-data banner. */
    readonly banner?: ReactNode | undefined;
    readonly footer?: ReactNode | undefined;
    /**
     * Sidebar width in pixels. Applied as a style so the default `w-[260px]`/`w-[88px]` classes —
     * and the suites that assert them — stay exactly as they are when this is not passed.
     */
    readonly sidebarWidth?: number | undefined;
    /** Absolute-fill layer behind the sidebar's content — a gradient over the flat canopy. */
    readonly sidebarBackground?: ReactNode | undefined;
    /** Above the sidebar's navigation — a brand block. Sidebar only; the drawer has a title bar. */
    readonly sidebarStart?: ReactNode | undefined;
    /** Pinned at the bottom of the sidebar, and after the drawer's list — a sign-out control. */
    readonly sidebarEnd?: ReactNode | undefined;
    readonly contentClassName?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Application shell.
 *
 * One component, six chromes, because "which chrome" is a *routing* decision (which area am I in?)
 * crossed with a *viewport* decision (is there room for a sidebar?), and putting that crossing in
 * one place is the only way the answer stays consistent.
 *
 * | variant       | chrome                                                                |
 * | ------------- | --------------------------------------------------------------------- |
 * | `public`      | top bar, centred content, no navigation                               |
 * | `auth`        | no navigation at all — a centred card on a sunken background          |
 * | `workspace`   | sidebar at `lg` and above; below that a top bar with a drawer         |
 * | `rail`        | permanent narrow icon rail — tablets, where a full sidebar is greedy  |
 * | `kiosk`       | bare: no chrome whatsoever (POS/KDS hardware)                         |
 * | `driver`      | bottom tab bar, thumb-reachable                                       |
 * | `marketplace` | public site chrome: brand, horizontal nav at `md`+, menu below, footer |
 * | `consumer`    | signed-in customer: sidebar at `lg`+, bottom tabs below               |
 *
 * Every variant that has to choose between two navigation shapes *switches* rather than rendering
 * both and hiding one with a responsive class. Hidden navigation is still in the accessibility tree
 * and still in the tab order, which axe reports and which strands keyboard users in an invisible
 * menu.
 *
 * The two Phase 2 variants differ from `workspace` in what the viewport buys. A marketplace is a
 * *reading* surface: its navigation belongs in the top bar where it costs no width, and it needs a
 * footer, which no workspace does. A consumer app is a *task* surface: below `lg` its destinations
 * belong under the thumb, which is the same bottom bar the `driver` variant uses — and it is
 * literally the same code, so the two cannot drift.
 */
export function AppShell({
    variant,
    children,
    title,
    navigation = [],
    topbarStart,
    topbarEnd,
    banner,
    footer,
    sidebarWidth,
    sidebarBackground,
    sidebarStart,
    sidebarEnd,
    contentClassName,
    testID,
}: AppShellProps) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const wideEnoughForSidebar = atLeast('lg');

    if (variant === 'kiosk') {
        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}
                <View className={cx('flex-1', contentClassName)}>{children}</View>
            </View>
        );
    }

    if (variant === 'auth') {
        return (
            <View testID={testID} className="flex-1 bg-surface-sunken">
                {banner}
                <ScrollView contentContainerClassName="flex-grow items-center justify-center p-4">
                    <View
                        testID={testID === undefined ? undefined : `${testID}-card`}
                        role="main"
                        className={cx(
                            'w-full max-w-[440px] flex-col gap-6 rounded-xl bg-surface-base p-6 shadow-elevation-2',
                            contentClassName,
                        )}
                    >
                        {title === undefined ? null : (
                            <RNText
                                accessibilityRole="header"
                                aria-level={1}
                                className="text-2xl font-semibold text-content-primary text-start"
                            >
                                {title}
                            </RNText>
                        )}
                        {children}
                    </View>
                    {footer}
                </ScrollView>
            </View>
        );
    }

    // One bottom bar, shared by `driver` and `consumer`. Extracted rather than duplicated so the
    // two can never drift into two subtly different tab semantics.
    //
    // Two elements, not one: the bar is a navigation landmark *and* the row of tabs is a tablist.
    // They cannot be the same element — `role` and `accessibilityRole` on one `View` do not compose,
    // the DOM keeps whichever wins, and the loser takes the other with it. When `navigation` won,
    // every `role="tab"` below sat with no `tablist` ancestor, which is an axe-critical
    // `aria-required-parent` finding on every phone-width screen in the consumer area.
    const tabBar = (
        <View
            role="navigation"
            aria-label={t('designSystem:shell.primaryNavigation')}
            className="border-t border-stroke-subtle bg-surface-raised"
        >
            <View
                testID={testID === undefined ? undefined : `${testID}-tabs`}
                role="tablist"
                accessibilityRole="tablist"
                aria-label={t('designSystem:shell.primaryNavigation')}
                className="flex-row"
            >
                {navigation.map((item) => (
                    <Pressable
                        key={item.key}
                        testID={item.testID}
                        role="tab"
                        accessibilityRole="tab"
                        accessibilityLabel={item.label}
                        accessibilityState={{ selected: item.active === true }}
                        aria-selected={item.active === true}
                        focusable
                        onPress={item.onPress}
                        className="min-h-touch flex-1 items-center justify-center gap-0.5 py-2"
                    >
                        {item.icon === undefined ? null : (
                            <Icon
                                name={item.icon}
                                className={
                                    item.active === true
                                        ? 'text-content-on-brand-subtle'
                                        : 'text-content-secondary'
                                }
                            />
                        )}
                        <RNText
                            className={cx(
                                'text-xs',
                                item.active === true
                                    ? 'text-content-on-brand-subtle font-medium'
                                    : 'text-content-secondary',
                            )}
                        >
                            {item.label}
                        </RNText>
                    </Pressable>
                ))}
            </View>
        </View>
    );

    if (variant === 'driver') {
        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}
                <View role="main" className={cx('flex-1', contentClassName)}>
                    {children}
                </View>
                {tabBar}
            </View>
        );
    }

    const topBar = (
        <View
            testID={testID === undefined ? undefined : `${testID}-topbar`}
            role="banner"
            className="flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-raised px-4 py-2 shadow-elevation-1"
        >
            {variant === 'workspace' && !wideEnoughForSidebar && navigation.length > 0 ? (
                <IconButton
                    testID={testID === undefined ? undefined : `${testID}-menu`}
                    label={t('designSystem:shell.openNavigation')}
                    icon={<Icon name="menu" />}
                    onPress={() => {
                        setDrawerOpen(true);
                    }}
                />
            ) : null}
            {topbarStart}
            <RNText
                testID={testID === undefined ? undefined : `${testID}-title`}
                accessibilityRole="header"
                aria-level={1}
                numberOfLines={1}
                className="flex-1 text-base font-semibold text-content-primary text-start"
            >
                {title ?? t('common:app.name')}
            </RNText>
            {topbarEnd}
        </View>
    );

    /**
     * The navigation list, in one of two tones.
     *
     * `canopy` is the sidebar: a deep forest panel that reads as chrome rather than as content, so
     * the eye goes to the page and not to the menu. `surface` is the drawer, which is a light
     * overlay with its own light title bar — canopy items inside it would be mint-on-white.
     *
     * Both alphas clear the §1.3 floor: text on the canopy must be at least 0.62 opaque
     * (`rgba(220,252,231,0.62)` is 5.42:1; 0.45 is 3.60:1 and fails). Items sit at 80 and headings
     * at 65, which is the documented 0.74–0.78 band and the floor plus a little air.
     */
    const navigationList = (compact: boolean, tone: 'canopy' | 'surface' = 'surface') => {
        const onCanopy = tone === 'canopy';

        const renderItem = (item: NavigationItem) => (
            <Pressable
                key={item.key}
                testID={item.testID}
                role="link"
                accessibilityRole="link"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: item.active === true }}
                aria-current={item.active === true ? 'page' : undefined}
                focusable
                onPress={() => {
                    setDrawerOpen(false);
                    item.onPress();
                }}
                className={cx(
                    'min-h-touch flex-row items-center gap-2 rounded-lg px-3 py-2',
                    compact ? 'justify-center' : null,
                    item.active !== true
                        ? 'bg-transparent'
                        : // A filled `surface-brand` pill, not `brand-500`: this carries 14px
                          // white text, and white on brand-500 is 3.05:1 (§1.3).
                          onCanopy
                          ? 'bg-surface-brand'
                          : 'bg-surface-brand-subtle',
                )}
            >
                {item.icon === undefined ? null : (
                    <Icon
                        name={item.icon}
                        className={
                            item.active === true
                                ? onCanopy
                                    ? 'text-content-on-brand'
                                    : 'text-content-on-brand-subtle'
                                : onCanopy
                                  ? 'text-content-on-canopy-muted/80'
                                  : 'text-content-secondary'
                        }
                    />
                )}
                {compact ? null : (
                    <RNText
                        numberOfLines={1}
                        className={cx(
                            'flex-1 text-sm text-start',
                            item.active === true
                                ? onCanopy
                                    ? 'text-content-on-brand font-bold'
                                    : 'text-content-on-brand-subtle font-medium'
                                : onCanopy
                                  ? 'text-content-on-canopy-muted/80'
                                  : 'text-content-primary',
                        )}
                    >
                        {item.label}
                    </RNText>
                )}
                {compact ? null : item.badge}
            </Pressable>
        );

        // Grouped by first appearance rather than by sorting, so the caller's order survives and a
        // group split across the table stays split rather than being silently reassembled.
        const ungrouped = navigation.filter((item) => item.group === undefined);
        const groups: string[] = [];
        for (const item of navigation) {
            if (item.group !== undefined && !groups.includes(item.group)) groups.push(item.group);
        }
        const showGroups = !compact && groups.length > 0;

        return (
            <View
                testID={testID === undefined ? undefined : `${testID}-navigation`}
                role="navigation"
                aria-label={t('designSystem:shell.primaryNavigation')}
                className="flex-col gap-1 p-2"
            >
                {(showGroups ? ungrouped : navigation).map(renderItem)}
                {!showGroups
                    ? null
                    : groups.map((group) => (
                          <View key={group} className="flex-col gap-1">
                              <RNText
                                  testID={
                                      testID === undefined
                                          ? undefined
                                          : `${testID}-navigation-group-${group}`
                                  }
                                  // A heading, not a label: it names the section that follows, and
                                  // a screen reader should be able to jump between them.
                                  accessibilityRole="header"
                                  aria-level={2}
                                  className={cx(
                                      'px-3 pb-1 pt-3 text-xs font-bold uppercase tracking-widest text-start',
                                      onCanopy
                                          ? 'text-content-on-canopy-muted/65'
                                          : 'text-content-secondary',
                                  )}
                              >
                                  {group}
                              </RNText>
                              {navigation.filter((item) => item.group === group).map(renderItem)}
                          </View>
                      ))}
            </View>
        );
    };

    const sidebar = (
        <View
            testID={testID === undefined ? undefined : `${testID}-sidebar`}
            className={cx(
                'h-full flex-col overflow-hidden bg-surface-canopy',
                variant === 'rail' ? 'w-[88px]' : 'w-[260px]',
            )}
            style={sidebarWidth === undefined ? undefined : { width: sidebarWidth }}
        >
            {sidebarBackground === undefined ? null : (
                <View className="absolute inset-0" pointerEvents="none">
                    {sidebarBackground}
                </View>
            )}
            {sidebarStart}
            {/* The list scrolls; the brand block above and the control below stay put. A
                workspace rail of thirty destinations is taller than most viewports. */}
            <ScrollView className="flex-1">{navigationList(variant === 'rail', 'canopy')}</ScrollView>
            {sidebarEnd}
        </View>
    );

    const navigationDrawer = (
        <Drawer
            testID={testID === undefined ? undefined : `${testID}-drawer`}
            open={drawerOpen}
            onClose={() => {
                setDrawerOpen(false);
            }}
            title={t('designSystem:shell.primaryNavigation')}
        >
            {navigationList(false)}
            {sidebarEnd}
        </Drawer>
    );

    if (variant === 'marketplace') {
        // A marketing surface earns its navigation a top bar rather than a sidebar: horizontal
        // space is what the content wants back, and `md` is where a row of destinations still fits
        // beside the brand. Below that it is the same drawer every other variant collapses to.
        const wideEnoughForTopNav = atLeast('md');
        const showTopNav = wideEnoughForTopNav && navigation.length > 0;

        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}

                <View
                    testID={testID === undefined ? undefined : `${testID}-topbar`}
                    role="banner"
                    className="flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-raised px-4 py-2 shadow-elevation-1"
                >
                    {!wideEnoughForTopNav && navigation.length > 0 ? (
                        <IconButton
                            testID={testID === undefined ? undefined : `${testID}-menu`}
                            label={t('designSystem:shell.openNavigation')}
                            icon={<Icon name="menu" />}
                            onPress={() => {
                                setDrawerOpen(true);
                            }}
                        />
                    ) : null}
                    {topbarStart}
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-title`}
                        accessibilityRole="header"
                        aria-level={1}
                        numberOfLines={1}
                        className="text-base font-semibold text-content-primary text-start"
                    >
                        {title ?? t('common:app.name')}
                    </RNText>

                    {/*
                     * `self-stretch` on the wrapper, not just on the row inside it. The top bar
                     * centres its children, so without this the wrapper is only as tall as its
                     * own content (28px) and every stretch below it inherits that ceiling — the
                     * active underline then floats mid-bar instead of sitting on its edge.
                     */}
                    <View className="flex-1 flex-row items-stretch self-stretch">
                        {showTopNav ? (
                            <View
                                testID={testID === undefined ? undefined : `${testID}-navigation`}
                                role="navigation"
                                aria-label={t('designSystem:shell.primaryNavigation')}
                                // `shrink` is load-bearing: react-native-web gives every View
                                // flex-shrink: 0, so without it the row renders at max-content
                                // width and overflows the document at 768-1023px instead of
                                // wrapping (flex-wrap only engages once the box can be narrowed).
                                //
                                // `-my-2` cancels the bar's own vertical padding for this row
                                // only, so a stretched item's bottom edge *is* the bar's bottom
                                // edge — which is where the active underline has to sit. The
                                // padding comes back on each item, so the touch target is unchanged.
                                //
                                // `content-stretch` is the other half and is easy to miss:
                                // react-native-web defaults `align-content` to `flex-start`, so
                                // with `flex-wrap` on, a single line sits at its natural height and
                                // `items-stretch` has nothing to stretch into. When the row *does*
                                // wrap, each line stretches to its own height and the underline
                                // tracks the active item's line, which is what it should do.
                                className="-my-2 flex-row flex-wrap content-stretch items-stretch gap-1 shrink"
                            >
                                {navigation.map((item) => (
                                    <Pressable
                                        key={item.key}
                                        testID={item.testID}
                                        role="link"
                                        accessibilityRole="link"
                                        accessibilityLabel={item.label}
                                        accessibilityState={{ selected: item.active === true }}
                                        aria-current={item.active === true ? 'page' : undefined}
                                        focusable
                                        onPress={item.onPress}
                                        className="relative min-h-touch flex-row items-center justify-center gap-2 bg-transparent px-3 py-2"
                                    >
                                        {item.icon === undefined ? null : (
                                            <Icon
                                                name={item.icon}
                                                className={
                                                    item.active === true
                                                        ? 'text-surface-brand'
                                                        : 'text-content-secondary'
                                                }
                                            />
                                        )}
                                        <RNText
                                            numberOfLines={1}
                                            className={cx(
                                                'text-sm text-start',
                                                item.active === true
                                                    ? 'text-surface-brand font-bold'
                                                    : 'text-content-primary',
                                            )}
                                        >
                                            {item.label}
                                        </RNText>
                                        {/*
                                         * A bar rather than a filled pill. A pill in a top bar
                                         * reads as a button among links; an underline on the bar's
                                         * edge reads as "you are here", which is what it means.
                                         * brand-500 is legal here because it carries no text — it
                                         * is a graphic, and §1.3 keeps brand-500 for exactly this.
                                         */}
                                        {item.active === true ? (
                                            <View
                                                // Named off the *shell*, not off the item. The
                                                // responsive suite enumerates controls with
                                                // `[data-testid^="marketplace-nav-"]` and checks
                                                // each one is touch-sized; an item-derived name put
                                                // this 2px decoration in that set. Exactly one item
                                                // is ever active, so one handle is enough.
                                                testID={
                                                    testID === undefined
                                                        ? undefined
                                                        : `${testID}-nav-active-bar`
                                                }
                                                aria-hidden
                                                accessibilityElementsHidden
                                                importantForAccessibility="no-hide-descendants"
                                                // eslint-disable-next-line no-restricted-syntax -- §1.3 keeps brand-500 for underline bars precisely: this View carries no text, so the 3.05:1 that rules it out as a text surface does not apply. The rule cannot see that, so it is waived here rather than weakened everywhere.
                                                className="absolute bottom-0 start-0 end-0 h-0.5 bg-brand-500"
                                            />
                                        ) : null}
                                    </Pressable>
                                ))}
                            </View>
                        ) : null}
                    </View>

                    {topbarEnd}
                </View>

                <ScrollView
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    role="main"
                    className="flex-1"
                    // A measure, not a stretch. Past ~1150px a catalogue row grows to five and six
                    // cards and the eye loses the start of the next line; the gutters are wider
                    // here than in a workspace because there is no sidebar taking the same space.
                    contentContainerClassName={cx(
                        'flex-grow gap-4 p-4 md:px-10 lg:px-11',
                        contentClassName,
                    )}
                >
                    {/*
                     * `self-stretch` then capped, not `self-center`. `align-self: center` makes
                     * the box shrink to its own content in the cross axis, which collapsed the
                     * whole catalogue column to 237px and stacked a forty-card grid one card
                     * wide. Stretch fills the container, `max-w` caps it, and the auto inline
                     * margins centre what is left over.
                     *
                     * `w-full` is what keeps that stretch honest below the cap. React Native
                     * defaults `flexShrink` to 0, so without an explicit width this box takes its
                     * own max-content size whenever that exceeds the space available — 405px
                     * against a 343px content box on a 375px phone — and since `body` sets
                     * `overflow-x: hidden`, the excess is not scrollable but simply cut off. Every
                     * page in the shell lost its right edge on any viewport under ~437px.
                     * `width: 100%` resolves against the parent's content box, so the box now
                     * tracks the space it is given and `max-w` still caps it on wide screens.
                     */}
                    <View className="mx-auto w-full max-w-[1152px] flex-col gap-4 self-stretch">
                        {children}
                    </View>
                    {footer === undefined ? null : (
                        <View
                            testID={testID === undefined ? undefined : `${testID}-footer`}
                            role="contentinfo"
                            // Bled back out through the content gutters so the band reaches both
                            // page edges. The negative margins mirror the padding above exactly —
                            // a footer inset by 44px reads as a misplaced card rather than as the
                            // end of the page. No rule above it either: a hairline between the
                            // page and a dark band draws a line on an edge that is already there.
                            className="-mx-4 -mb-4 self-stretch md:-mx-10 lg:-mx-11"
                        >
                            {footer}
                        </View>
                    )}
                </ScrollView>

                {!wideEnoughForTopNav && navigation.length > 0 ? navigationDrawer : null}
            </View>
        );
    }

    if (variant === 'consumer') {
        const showSidebar = wideEnoughForSidebar && navigation.length > 0;
        const showTabs = !wideEnoughForSidebar && navigation.length > 0;

        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}
                {topBar}

                <View className="flex-1 flex-row">
                    {showSidebar ? sidebar : null}

                    <ScrollView
                        testID={testID === undefined ? undefined : `${testID}-content`}
                        role="main"
                        className="flex-1"
                        contentContainerClassName={cx(
                            'flex-grow gap-4 p-4 lg:p-7',
                            contentClassName,
                        )}
                    >
                        {children}
                        {footer}
                    </ScrollView>
                </View>

                {showTabs ? tabBar : null}
            </View>
        );
    }

    const sidebarVisible =
        navigation.length > 0 &&
        (variant === 'rail' || (variant === 'workspace' && wideEnoughForSidebar));

    return (
        <View testID={testID} className="flex-1 bg-surface-base">
            {banner}
            {topBar}

            <View className="flex-1 flex-row">
                {sidebarVisible ? sidebar : null}

                <ScrollView
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    role="main"
                    className="flex-1"
                    contentContainerClassName={cx('flex-grow gap-4 p-4 lg:p-7', contentClassName)}
                >
                    {children}
                    {footer}
                </ScrollView>
            </View>

            {variant === 'workspace' && !wideEnoughForSidebar && navigation.length > 0
                ? navigationDrawer
                : null}
        </View>
    );
}
