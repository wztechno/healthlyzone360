import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { showFloatingLabel } from '../actions/floating-label.ts';
import type { FloatingLabel } from '../actions/floating-label.ts';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { cx } from '../internal/class-names.ts';
import { Drawer } from '../overlays/drawer.tsx';
import { ShellDockHost } from './shell-dock.tsx';

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
     * The module's glyph on the collapsed sidebar, where a group is drawn as one icon. The first
     * item in a group that carries one names it; without any, the group's first item's `icon`.
     */
    readonly groupIcon?: IconName | undefined;
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
    /**
     * Replaces the top bar's title text — a breadcrumb trail that already names the page. Omit, or
     * pass `undefined` on a page the trail has nothing to say about, and `title` is drawn instead.
     * Not used by the `marketplace` bar, which draws no title.
     */
    readonly topbarTitle?: ReactNode | undefined;
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
    /** Absolute-fill layer behind the sidebar's content — drawn over the sidebar's flat fill. */
    readonly sidebarBackground?: ReactNode | undefined;
    /** Above the sidebar's navigation — a brand block. Sidebar only; the drawer has a title bar. */
    readonly sidebarStart?: ReactNode | undefined;
    /** `sidebarStart` for the collapsed sidebar — a brand mark without the wordmark. */
    readonly sidebarStartCollapsed?: ReactNode | undefined;
    /** `sidebarEnd` for the collapsed sidebar — the same control as an icon. */
    readonly sidebarEndCollapsed?: ReactNode | undefined;
    /**
     * Pinned at the bottom of the sidebar — a sign-out control. Sidebar only: the drawer is a
     * white overlay with its own title bar. Below `lg`
     * the caller keeps such a control in the top bar instead.
     */
    readonly sidebarEnd?: ReactNode | undefined;
    /**
     * `auth` variant only: a brand panel beside the card from `lg` up — the split-panel auth
     * opening. Dropped below `lg`, where the centred card keeps the whole width.
     */
    readonly authAside?: ReactNode | undefined;
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
export function AppShell(props: AppShellProps) {
    /*
     * The bar a page docks to the content column's bottom edge (`ShellDock`) — the multi-step
     * form's Previous / Next. Held in this thin wrapper so the layout below re-renders to draw it
     * while the page element it was handed as `children` stays the same one.
     */
    const [dock, setDock] = useState<ReactNode>(null);

    return (
        <ShellDockHost value={setDock}>
            <AppShellLayout {...props} dock={dock} />
        </ShellDockHost>
    );
}

function AppShellLayout({
    dock,
    variant,
    children,
    title,
    navigation = [],
    topbarStart,
    topbarTitle,
    topbarEnd,
    banner,
    footer,
    sidebarWidth,
    sidebarBackground,
    sidebarStart,
    sidebarEnd,
    sidebarStartCollapsed,
    sidebarEndCollapsed,
    authAside,
    contentClassName,
    testID,
}: AppShellProps & { readonly dock: ReactNode }) {
    const { t } = useTranslation();
    const { atLeast } = useBreakpoint();
    const [drawerOpen, setDrawerOpen] = useState(false);
    /**
     * The workspace's page panel, slid shut by the top bar's hamburger. Held here, in the shell, so it
     * survives navigation: a layout keeps one shell mounted across every route under it.
     */
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    /**
     * The panel's contents stay mounted until the slide has finished, then leave the tree — a shut
     * panel's links must not stay in the tab order behind a zero-width box.
     */
    const [panelContentMounted, setPanelContentMounted] = useState(true);
    /** The module the panel lists. `null` follows the page: the module holding the active item. */
    const [chosenGroup, setChosenGroup] = useState<string | null>(null);
    const wideEnoughForSidebar = atLeast('lg');
    const twoPane = variant === 'workspace' && wideEnoughForSidebar && navigation.length > 0;

    const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
    useEffect(
        () => () => {
            for (const timer of timers.current) clearTimeout(timer);
        },
        [],
    );
    const setCollapsed = useCallback((next: boolean) => {
        setSidebarCollapsed(next);
        for (const timer of timers.current) clearTimeout(timer);
        timers.current = [];
        if (!next) setPanelContentMounted(true);
        const settle = () => {
            if (next) setPanelContentMounted(false);
            // Lists that fit their columns to the port measure on `resize`. The port changed width
            // with the panel but the window did not, so they are told once the slide has settled.
            if (Platform.OS === 'web' && typeof window !== 'undefined') {
                window.dispatchEvent(new Event('resize'));
            }
        };
        timers.current.push(setTimeout(settle, SIDEBAR_TRANSITION_MS + 20));
    }, []);

    const groups: string[] = [];
    for (const item of navigation) {
        if (item.group !== undefined && !groups.includes(item.group)) groups.push(item.group);
    }
    const activeGroup = navigation.find(
        (item) => item.active === true && item.group !== undefined,
    )?.group;
    const shownGroup =
        chosenGroup !== null && groups.includes(chosenGroup)
            ? chosenGroup
            : (activeGroup ?? groups[0]);

    const toggleSidebar = () => {
        setCollapsed(!sidebarCollapsed);
    };
    /** A module icon: show its pages, opening the panel if it is shut; the same icon again shuts it. */
    const chooseGroup = (group: string) => {
        if (!sidebarCollapsed && shownGroup === group) {
            setCollapsed(true);
            return;
        }
        setChosenGroup(group);
        if (sidebarCollapsed) setCollapsed(false);
    };

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
                <View className="flex-1 flex-row">
                    {authAside !== undefined && wideEnoughForSidebar ? (
                        <View
                            testID={testID === undefined ? undefined : `${testID}-aside`}
                            className="w-[440px] shrink-0 overflow-hidden"
                        >
                            {authAside}
                        </View>
                    ) : null}
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

    /** The docked bar, on the content column's bottom edge and outside its scroll port. */
    const dockBar =
        dock === null ? null : (
            <View testID={testID === undefined ? undefined : `${testID}-dock`}>{dock}</View>
        );

    const topBar = (
        <View
            testID={testID === undefined ? undefined : `${testID}-topbar`}
            role="banner"
            className="flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-raised px-4 py-2 shadow-elevation-1"
        >
            {twoPane ? (
                <IconButton
                    testID={testID === undefined ? undefined : `${testID}-sidebar-toggle`}
                    label={
                        sidebarCollapsed
                            ? t('designSystem:shell.showNavigation')
                            : t('designSystem:shell.hideNavigation')
                    }
                    aria-expanded={!sidebarCollapsed}
                    // The menu while the panel is open; an arrow pointing the way it will slide out
                    // once it is shut.
                    icon={<Icon name={sidebarCollapsed ? 'chevronEnd' : 'menu'} />}
                    onPress={toggleSidebar}
                />
            ) : null}
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
            {topbarTitle === undefined ? (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-title`}
                    accessibilityRole="header"
                    aria-level={1}
                    numberOfLines={1}
                    className="flex-1 text-base font-semibold text-content-primary text-start"
                >
                    {title ?? t('common:app.name')}
                </RNText>
            ) : (
                // `flex-1` as the text title has it: the trail's column pushes the trailing controls
                // to the inline end, and `min-w-0` lets a long trail wrap rather than shove them off.
                <View className="min-w-0 flex-1 flex-row items-center">{topbarTitle}</View>
            )}
            {topbarEnd}
        </View>
    );

    /**
     * The navigation list, in one of two tones.
     *
     * `sidebar` is the module panel (`surface-sidebar`, the primary green in light mode):
     * `on-sidebar` item text, `on-sidebar-muted` headings and icons, and the active item a pill
     * (`surface-sidebar-active`, white) in green text. `surface` is the drawer, a white overlay with
     * its own title bar, where the active item takes the subtle green. Every pair is gated in
     * `colour.test.ts`.
     */
    const navigationList = (
        compact: boolean,
        tone: 'sidebar' | 'surface' = 'surface',
        /** Draw one module only — its heading and pages. The workspace page panel. */
        onlyGroup?: string,
    ) => {
        const onSidebar = tone === 'sidebar';
        const source =
            onlyGroup === undefined
                ? navigation
                : navigation.filter((item) => item.group === onlyGroup);

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
                        : onSidebar
                          ? 'bg-surface-sidebar-active'
                          : 'bg-surface-brand-subtle',
                )}
            >
                {/*
                 * The item's own icon only on the compact rail, where it is the whole item. With
                 * labels, every destination takes the same bullet: the module heading above names
                 * the group, so a distinct glyph per item was a second thing to read.
                 */}
                {compact && item.icon === undefined ? null : (
                    <Icon
                        name={compact && item.icon !== undefined ? item.icon : 'dot'}
                        {...(compact ? {} : { size: 'sm' as const })}
                        className={
                            item.active === true
                                ? onSidebar
                                    ? 'text-content-on-sidebar-active'
                                    : 'text-content-on-brand-subtle'
                                : onSidebar
                                  ? 'text-content-on-sidebar-muted'
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
                                ? onSidebar
                                    ? 'text-content-on-sidebar-active font-bold'
                                    : 'text-content-on-brand-subtle font-medium'
                                : onSidebar
                                  ? 'text-content-on-sidebar font-medium'
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
        const ungrouped = source.filter((item) => item.group === undefined);
        const groups: string[] = [];
        for (const item of source) {
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
                {(showGroups ? ungrouped : source).map(renderItem)}
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
                                      // Sentence case, a step *above* the items it heads (`text-base`
                                      // bold over their `text-sm`), so a module reads as the parent
                                      // of the destinations under it. It was `uppercase
                                      // tracking-widest`, one of the five shapes this product used to
                                      // draw a demoted label in; size and weight carry it now.
                                      'px-3 pb-1 pt-3 text-base font-bold text-start',
                                      onSidebar
                                          ? 'text-content-on-sidebar-muted'
                                          : 'text-content-secondary',
                                  )}
                              >
                                  {group}
                              </RNText>
                              {source.filter((item) => item.group === group).map(renderItem)}
                          </View>
                      ))}
            </View>
        );
    };

    /**
     * The module rail: the fixed green strip down the workspace's leading edge, full height.
     *
     * Ungrouped destinations (Overview) keep their own icon and navigate. A module is one icon — its
     * `groupIcon`, else its first item's. Pressing it lists that module's pages in the white panel
     * beside the rail, sliding the panel open if it is shut; pressing the module already listed
     * slides it shut. Every icon's name shows on hover.
     *
     * Exactly one icon is lit. A module the reader picked while the panel is open wins; otherwise the
     * page decides — its own ungrouped destination (Overview), or the module holding it. Choosing an
     * ungrouped destination clears the pick, so Overview never stays lit beside a module.
     */
    const moduleRail = () => {
        const activeUngrouped = navigation.find(
            (item) => item.active === true && item.group === undefined,
        );
        const litKey: string | undefined =
            !sidebarCollapsed && chosenGroup !== null && groups.includes(chosenGroup)
                ? `group-${chosenGroup}`
                : activeUngrouped !== undefined
                  ? activeUngrouped.key
                  : activeGroup === undefined
                    ? undefined
                    : `group-${activeGroup}`;
        const entries = [
            ...navigation
                .filter((item) => item.group === undefined)
                .map((item) => ({
                    key: item.key,
                    label: item.label,
                    icon: item.icon ?? ('dot' as const),
                    active: litKey === item.key,
                    expanded: undefined as boolean | undefined,
                    testID: item.testID === undefined ? undefined : `${item.testID}-rail`,
                    onPress: () => {
                        setChosenGroup(null);
                        item.onPress();
                    },
                })),
            ...groups.map((group) => {
                const members = navigation.filter((item) => item.group === group);
                return {
                    key: `group-${group}`,
                    label: group,
                    icon:
                        members.find((item) => item.groupIcon !== undefined)?.groupIcon ??
                        members[0]?.icon ??
                        ('dot' as const),
                    active: litKey === `group-${group}`,
                    expanded: !sidebarCollapsed && shownGroup === group,
                    testID: testID === undefined ? undefined : `${testID}-rail-group-${group}`,
                    onPress: () => {
                        chooseGroup(group);
                    },
                };
            }),
        ];

        return (
            <View
                testID={testID === undefined ? undefined : `${testID}-rail`}
                role="navigation"
                aria-label={t('designSystem:shell.modules')}
                className="flex-col items-center gap-1 py-2"
            >
                {entries.map((entry) => (
                    <RailButton
                        key={entry.key}
                        label={entry.label}
                        icon={entry.icon}
                        active={entry.active}
                        expanded={entry.expanded}
                        onPress={entry.onPress}
                        testID={entry.testID}
                    />
                ))}
            </View>
        );
    };

    /** The `rail` variant's permanent strip — unchanged by the workspace's two panes. */
    const sidebar = (
        <View
            testID={testID === undefined ? undefined : `${testID}-sidebar`}
            className={cx(
                // The fill is the edge: a green panel against the page needs no hairline as well.
                'h-full flex-col overflow-hidden bg-surface-sidebar',
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
            <ScrollView
                testID={testID === undefined ? undefined : `${testID}-sidebar-scroll`}
                className="flex-1"
            >
                {navigationList(variant === 'rail', 'sidebar')}
            </ScrollView>
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
                    /*
                     * Flat on the page, not a raised plane. The bar carries a hairline and takes
                     * the page surface, so the chrome reads as an edge of the document rather than
                     * as a card floating over it — a shadow here competes with the elevation the
                     * content cards use to mean "this is a thing you can pick up".
                     *
                     * The gutters track the content gutters below (`p-4 md:px-10 lg:px-11`) so the
                     * brand mark sits on the same vertical line as the first card in the grid.
                     * They were fixed at `px-4`, which left the bar inset by 16px against content
                     * inset by 44px, and the misalignment is visible on every wide viewport.
                     */
                    className="flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-base px-4 py-3.5 md:gap-7 md:px-10 lg:px-11"
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

                    {/*
                     * No title in this bar, unlike every other variant.
                     *
                     * It was rendering a tagline as `aria-level={1}` beside the wordmark — but
                     * every screen under this shell opens with a `PageHero` that renders its own
                     * level-1 heading, so each marketplace page shipped *two* h1s, and the first
                     * one named the product rather than the page. A screen-reader user landing on
                     * the meals catalogue heard the tagline before the word "Meals".
                     *
                     * The brand mark in `topbarStart` is a link to home and carries its own
                     * accessible name, so nothing is lost by dropping the text: the banner
                     * landmark is still a banner, and the page's heading is now the page's own.
                     */}

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
                                        className="relative min-h-touch flex-row items-center justify-center bg-transparent px-3 py-2"
                                    >
                                        {/*
                                         * No glyph here, unlike the drawer and the sidebar.
                                         *
                                         * A top bar is read as a line of words, and a row of
                                         * icons in front of them is decoration that costs about
                                         * 140px of the space the row has least of — which is what
                                         * pushed this nav onto a second line and the trailing
                                         * controls into each other. The glyphs also carried no
                                         * meaning: a diamond for Kitchens and a half-circle for
                                         * Meals name nothing a reader could guess.
                                         *
                                         * The drawer keeps them (`item.icon` is still rendered
                                         * there): a stacked vertical list is scanned down an edge,
                                         * where a leading glyph genuinely helps.
                                         */}
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

                {dockBar}
                {showTabs ? tabBar : null}
            </View>
        );
    }

    if (twoPane) {
        const panelWidth = sidebarWidth ?? 260;
        /*
         * Smooth, not laggy: only the panel's *width* animates, as a CSS transition on the web — one
         * property, run by the browser, with no React work per frame. Its contents never reflow while
         * it moves: they are laid out at the panel's full width inside the clipping box, so shutting
         * slides the edge over a list that is already in place, and opening reveals one already laid
         * out.
         *
         * It runs under reduced motion too, by the product owner's choice: a 200ms change of one
         * panel's width, started by the reader's own press, with no travel, parallax or looping.
         */
        const transition =
            Platform.OS === 'web'
                ? ({
                      transitionProperty: 'width',
                      transitionDuration: `${String(SIDEBAR_TRANSITION_MS)}ms`,
                      transitionTimingFunction: 'cubic-bezier(0.2, 0, 0, 1)',
                  } as object)
                : undefined;

        return (
            <View testID={testID} className="flex-1 flex-row bg-surface-base">
                {/* The rail and the panel run the full height of the page: their edge is the
                    window's, and the top bar begins beside them. */}
                <View
                    testID={testID === undefined ? undefined : `${testID}-rail-panel`}
                    className="h-full flex-col bg-surface-sidebar"
                    style={{ width: SIDEBAR_COLLAPSED_WIDTH }}
                >
                    {sidebarBackground === undefined ? null : (
                        <View className="absolute inset-0" pointerEvents="none">
                            {sidebarBackground}
                        </View>
                    )}
                    {sidebarStartCollapsed}
                    <ScrollView
                        testID={testID === undefined ? undefined : `${testID}-rail-scroll`}
                        className="flex-1"
                    >
                        {moduleRail()}
                    </ScrollView>
                    {sidebarEndCollapsed}
                </View>

                <View
                    testID={testID === undefined ? undefined : `${testID}-sidebar`}
                    aria-hidden={sidebarCollapsed}
                    className={cx(
                        // The width class is the default the style overrides; the style is what moves.
                        'h-full w-[260px] overflow-hidden bg-surface-raised',
                        sidebarCollapsed ? null : 'border-e border-stroke-subtle',
                    )}
                    style={{ width: sidebarCollapsed ? 0 : panelWidth, ...transition }}
                >
                    {panelContentMounted ? (
                        <View className="h-full flex-col" style={{ width: panelWidth }}>
                            {sidebarStart}
                            <ScrollView
                                testID={
                                    testID === undefined ? undefined : `${testID}-sidebar-scroll`
                                }
                                className="flex-1"
                            >
                                {navigationList(false, 'surface', shownGroup)}
                            </ScrollView>
                            {/* A caller with no rail-sized end control keeps its full one here. */}
                            {sidebarEndCollapsed === undefined ? sidebarEnd : null}
                        </View>
                    ) : null}
                </View>

                <View className="min-w-0 flex-1 flex-col">
                    {banner}
                    {topBar}
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
                    {dockBar}
                </View>
            </View>
        );
    }

    const sidebarVisible = navigation.length > 0 && variant === 'rail';

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

            {dockBar}

            {variant === 'workspace' && !wideEnoughForSidebar && navigation.length > 0
                ? navigationDrawer
                : null}
        </View>
    );
}

/**
 * The module rail's width: a 40px icon and 8px either side. The workspace is a desk surface driven
 * with a mouse (CLAUDE.md), so the rail sizes to the pointer rather than to the 44px touch floor.
 */
export const SIDEBAR_COLLAPSED_WIDTH = 56;
/** How long the page panel takes to slide shut or open. */
export const SIDEBAR_TRANSITION_MS = 200;

/**
 * One glyph on the module rail. White on the green strip, and a white pill in green when lit. Its
 * name floats beside it on hover, at the rail's inline end.
 */
function RailButton({
    label,
    icon,
    active,
    expanded,
    onPress,
    testID,
}: {
    readonly label: string;
    readonly icon: IconName;
    readonly active: boolean;
    /** A module icon whose pages the panel lists. `undefined` on a plain destination. */
    readonly expanded?: boolean | undefined;
    readonly onPress: () => void;
    readonly testID?: string | undefined;
}) {
    const floating = useRef<FloatingLabel | null>(null);
    const hide = useCallback(() => {
        floating.current?.hide();
        floating.current = null;
    }, []);
    useEffect(() => hide, [hide]);

    return (
        <Pressable
            testID={testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={label}
            accessibilityState={{ selected: active }}
            aria-current={active ? 'page' : undefined}
            focusable
            {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
            onPress={() => {
                hide();
                onPress();
            }}
            onHoverIn={(event) => {
                if (Platform.OS !== 'web') return;
                hide();
                floating.current = showFloatingLabel(
                    (event as unknown as { currentTarget?: unknown }).currentTarget,
                    label,
                    testID === undefined ? undefined : `${testID}-hover-label`,
                    'end',
                );
            }}
            onHoverOut={hide}
            className={cx(
                'h-10 w-10 items-center justify-center rounded-lg',
                active ? 'bg-surface-sidebar-active' : 'bg-transparent',
            )}
        >
            {/* 20px in the 40px button — the rail's marks are drawn, and read best at full size. */}
            <Icon
                name={icon}
                size="lg"
                className={active ? 'text-content-on-sidebar-active' : 'text-content-on-sidebar'}
            />
        </Pressable>
    );
}
