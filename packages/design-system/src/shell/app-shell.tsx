import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { useIsRtl } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import {
    Animated,
    Easing,
    Platform,
    Pressable,
    ScrollView,
    Text as RNText,
    View,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { showFloatingLabel } from '../actions/floating-label.ts';
import type { FloatingLabel } from '../actions/floating-label.ts';
import { Icon } from '../icons/icon.tsx';
import { CascadeItem } from '../motion/cascade.tsx';
import type { IconName } from '../icons/icon.tsx';
import { useBreakpoint } from '../hooks/use-breakpoint.ts';
import { ContentWidthProvider } from '../hooks/use-content-width.tsx';
import { AnimatedView } from '../internal/animated-view.ts';
import { cx } from '../internal/class-names.ts';
import { startAfterPaint } from '../motion/start-after-paint.ts';
import { useMotion } from '../motion/use-motion.ts';
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
     * A sub-heading inside the module's panel — "Workspaces", "Account". A label is drawn wherever
     * an item's section differs from the one before it; items without one draw no label.
     */
    readonly section?: string | undefined;
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
    /**
     * The area switcher, drawn as the bottom tab bar under the page on `workspace`, `rail` and
     * `kiosk` — every admin page keeps it in the same place, apart from the area's own rail. On a
     * two-pane workspace it runs under the content column only; the rail keeps the full height.
     * `driver` and `consumer` draw `navigation` in that bar instead and ignore this.
     */
    readonly bottomNavigation?: readonly NavigationItem[] | undefined;
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
    /**
     * Where the application is — the route's pathname. The shell does not route, so it cannot see
     * a navigation on its own; told the path, it closes an open navigation drawer when the path
     * changes. Without it, browser Back on a phone navigated *underneath* the open drawer, and the
     * person found the menu still covering a page they had not chosen (CHROME-15).
     */
    readonly pathname?: string | undefined;
    /**
     * The content scroll port — the one `ScrollView` every page under this shell scrolls in. The
     * web document never scrolls (`body` is `overflow: hidden`), so this is the only handle there
     * is on where a reader is. A chrome that keeps each page's place across navigation — the
     * marketplace's, which puts a new page at the top and a page returned to where it was left —
     * holds the ref to move it and reads the three events below to know where it stands.
     *
     * Every variant with a content port forwards it; `auth` does not, because its card is not a
     * page anybody returns to part-way down.
     */
    readonly contentRef?: Ref<ScrollView> | undefined;
    /**
     * Scroll events from the content port, throttled to one per `CONTENT_SCROLL_THROTTLE_MS` while
     * the reader scrolls, plus one when they stop.
     */
    readonly onContentScroll?:
        ((event: NativeSyntheticEvent<NativeScrollEvent>) => void) | undefined;
    /** The content port's content height changed — the page underneath grew or shrank. */
    readonly onContentSizeChange?: ((width: number, height: number) => void) | undefined;
    /** The content port itself was laid out — its own height is the reader's viewport. */
    readonly onContentLayout?: ((event: LayoutChangeEvent) => void) | undefined;
    readonly testID?: string | undefined;
}

/**
 * How often the content port reports a scroll while the reader is scrolling. Remembering a position
 * needs nothing finer than a tenth of a second, and on the web React Native Web reports the resting
 * position once more when scrolling stops, so the last place is never lost to the throttle.
 */
export const CONTENT_SCROLL_THROTTLE_MS = 100;

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
    bottomNavigation = [],
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
    pathname,
    contentRef,
    onContentScroll,
    onContentSizeChange,
    onContentLayout,
    testID,
}: AppShellProps & { readonly dock: ReactNode }) {
    const { t } = useTranslation();
    const { atLeast, width: windowWidth } = useBreakpoint();
    const [drawerOpen, setDrawerOpen] = useState(false);
    /*
     * A change of path closes the drawer (CHROME-15). Adjusted during render rather than in an
     * effect, so the new page never paints one frame with the old menu still over it. A press on a
     * destination already closed it; this catches what no press inside the shell sees — browser
     * Back and Forward, a link inside the page, a redirect.
     */
    const [drawerPathname, setDrawerPathname] = useState(pathname);
    if (drawerPathname !== pathname) {
        setDrawerPathname(pathname);
        setDrawerOpen(false);
    }
    /**
     * Spread onto every variant's content port: one place decides what a caller is handed, so the
     * marketplace's and a workspace's ports can never differ in what they report.
     */
    const contentPort = {
        ref: contentRef,
        onScroll: onContentScroll,
        scrollEventThrottle: onContentScroll === undefined ? undefined : CONTENT_SCROLL_THROTTLE_MS,
        onContentSizeChange,
        onLayout: onContentLayout,
    };
    /**
     * Whether the window has room for the page panel *as well as* a page. Below this the panel
     * starts shut — see `PANEL_OPEN_MIN_WIDTH`.
     */
    const roomyWindow = windowWidth >= PANEL_OPEN_MIN_WIDTH;
    /**
     * The workspace's page panel, slid shut by the top bar's hamburger. Held here, in the shell, so it
     * survives navigation: a layout keeps one shell mounted across every route under it.
     *
     * It opens on the reader's last choice when there is one, and otherwise on the window: open
     * where there is room for it, shut on a laptop, where its 232px is a quarter of the page.
     */
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        const stored = readPersistedPanel();
        return stored === null ? !roomyWindow : stored === 'shut';
    });
    /**
     * The panel's contents stay mounted until the slide has finished, then leave the tree — a shut
     * panel's links must not stay in the tab order behind a zero-width box.
     */
    const [panelContentMounted, setPanelContentMounted] = useState(true);
    /** The module the panel lists. `null` follows the page: the module holding the active item. */
    const [chosenGroup, setChosenGroup] = useState<string | null>(null);
    const wideEnoughForSidebar = atLeast('lg');
    const twoPane = variant === 'workspace' && wideEnoughForSidebar && navigation.length > 0;
    /*
     * What the page loses to the chrome, for `useContentWidth`. The panel term follows the panel's
     * target state, so a page re-lays itself the moment the hamburger is pressed rather than after
     * the slide. The `rail` variant's tablet strip is left out: no desk page renders under it.
     */
    const contentInset = {
        chrome: twoPane
            ? SIDEBAR_COLLAPSED_WIDTH + (sidebarCollapsed ? 0 : (sidebarWidth ?? 260))
            : 0,
        padding: wideEnoughForSidebar ? CONTENT_PADDING_LG : CONTENT_PADDING,
    };

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
    /** The page is an ungrouped destination (Overview) — a module with no pages of its own. */
    const activeUngrouped = navigation.find(
        (item) => item.active === true && item.group === undefined,
    );
    /**
     * `undefined` on an ungrouped destination nobody has picked a module over: the panel says there
     * is nothing under it rather than borrowing the first module's pages. The borrowed list was the
     * bug — the rail lit Overview while the panel showed that module, so pressing its icon read as
     * "the module already listed" and slid the panel shut instead of opening it.
     */
    const shownGroup =
        chosenGroup !== null && groups.includes(chosenGroup)
            ? chosenGroup
            : (activeGroup ?? (activeUngrouped === undefined ? groups[0] : undefined));

    /*
     * Arriving on a page the panel does not list — from the page search, a link in the content, the
     * browser's back button — drops the module the reader last picked, so the panel follows the page
     * to its own module, sliding open if it was shut. Keyed on the page, not on the module, so
     * moving between two pages of the module already listed changes nothing.
     *
     * Only where the window has room for the panel. On a laptop it starts shut to give the page its
     * width back, and reopening it on every page change would undo that on the first click.
     */
    const activeKey = navigation.find((item) => item.active === true)?.key;
    const lastActiveKey = useRef(activeKey);
    useEffect(() => {
        if (lastActiveKey.current === activeKey) return;
        lastActiveKey.current = activeKey;
        setChosenGroup(null);
        if (twoPane && roomyWindow && sidebarCollapsed && activeGroup !== undefined) {
            setCollapsed(false);
        }
    }, [activeKey, activeGroup, twoPane, roomyWindow, sidebarCollapsed, setCollapsed]);

    /** The reader's own open or shut — remembered, unlike the shell following a page. */
    const chooseCollapsed = (next: boolean) => {
        setCollapsed(next);
        persistPanel(next ? 'shut' : 'open');
    };
    const toggleSidebar = () => {
        chooseCollapsed(!sidebarCollapsed);
    };
    /** A module icon: show its pages, opening the panel if it is shut; the same icon again shuts it. */
    const chooseGroup = (group: string) => {
        if (!sidebarCollapsed && shownGroup === group) {
            chooseCollapsed(true);
            return;
        }
        setChosenGroup(group);
        if (sidebarCollapsed) chooseCollapsed(false);
    };
    /** An ungrouped destination: go there, and open the panel on its note if it is shut. */
    const chooseUngrouped = (item: NavigationItem) => {
        setChosenGroup(null);
        if (sidebarCollapsed && groups.length > 0 && roomyWindow) setCollapsed(false);
        item.onPress();
    };

    // One bottom bar, shared by `driver` and `consumer` (their `navigation`) and by the admin
    // variants (their `bottomNavigation`). Extracted rather than duplicated so they can never drift
    // into two subtly different tab semantics.
    //
    // Two elements, not one: the bar is a navigation landmark *and* the row of tabs is a tablist.
    // They cannot be the same element — `role` and `accessibilityRole` on one `View` do not compose,
    // the DOM keeps whichever wins, and the loser takes the other with it. When `navigation` won,
    // every `role="tab"` below sat with no `tablist` ancestor, which is an axe-critical
    // `aria-required-parent` finding on every phone-width screen in the consumer area.
    const renderTabBar = (items: readonly NavigationItem[]) => (
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
                {items.map((item) => (
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

    const tabBar = renderTabBar(navigation);
    /** The admin variants' area switcher — nothing when the caller passes none. */
    const bottomBar = bottomNavigation.length === 0 ? null : renderTabBar(bottomNavigation);

    /*
     * The kiosk and driver variants draw no chrome around the page, but the page still scrolls
     * (HA-25). The web document never scrolls — `body` is `overflow: hidden` and every variant's
     * own scroll port does it — so a board with more tickets than the wall, or a run sheet with
     * more runs than the phone, was cut off under the bottom bar with no way to reach the rest.
     * `flex-grow` keeps a short page filling the screen, as the plain `View` did.
     */
    if (variant === 'kiosk') {
        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}
                <ScrollView
                    {...contentPort}
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    className="flex-1"
                    contentContainerClassName={cx('flex-grow', contentClassName)}
                >
                    {children}
                </ScrollView>
                {bottomBar}
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

    if (variant === 'driver') {
        return (
            <View testID={testID} className="flex-1 bg-surface-base">
                {banner}
                <ScrollView
                    {...contentPort}
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    role="main"
                    className="flex-1"
                    contentContainerClassName={cx('flex-grow', contentClassName)}
                >
                    {children}
                </ScrollView>
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
            /*
             * Raised above the page it heads: on the web every View is its own stacking context, so
             * a panel dropped from the bar — the top bar's Continue list — was painted under the
             * page that follows it.
             */
            className="z-raised flex-row items-center gap-3 border-b border-stroke-subtle bg-surface-raised px-4 py-2 shadow-elevation-1"
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
        // The workspace page panel — one module's pages beside the rail.
        const panel = onlyGroup !== undefined && !compact;
        const source =
            onlyGroup === undefined
                ? navigation
                : navigation.filter((item) => item.group === onlyGroup);

        const renderItem = (item: NavigationItem, index: number) =>
            panel ? (
                /*
                 * The module's pages rise in one after another when its icon is pressed. The list
                 * is keyed by module (below), so choosing another module mounts a fresh cascade;
                 * a page change inside the module keeps the items, which have already arrived.
                 */
                <CascadeItem key={item.key} index={index}>
                    <PanelNavLink
                        item={item}
                        onPress={() => {
                            setDrawerOpen(false);
                            item.onPress();
                        }}
                    />
                </CascadeItem>
            ) : (
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
                key={onlyGroup}
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
                              {source
                                  .filter((item) => item.group === group)
                                  .flatMap((item, index, members) => {
                                      const opensSection =
                                          item.section !== undefined &&
                                          item.section !== members[index - 1]?.section;
                                      return opensSection
                                          ? [
                                                <RNText
                                                    key={`section-${item.section ?? ''}`}
                                                    accessibilityRole="header"
                                                    aria-level={3}
                                                    className={cx(
                                                        // A step under the module heading: the
                                                        // module names the panel, this names a
                                                        // run of pages inside it.
                                                        'px-3 pb-1 pt-2 text-xs font-semibold text-start',
                                                        onSidebar
                                                            ? 'text-content-on-sidebar-muted'
                                                            : 'text-content-secondary',
                                                    )}
                                                >
                                                    {item.section}
                                                </RNText>,
                                                renderItem(item, index),
                                            ]
                                          : [renderItem(item, index)];
                                  })}
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
        const litKey: string | undefined =
            !sidebarCollapsed && chosenGroup !== null && groups.includes(chosenGroup)
                ? `group-${chosenGroup}`
                : activeUngrouped !== undefined
                  ? activeUngrouped.key
                  : activeGroup === undefined
                    ? undefined
                    : `group-${activeGroup}`;
        /*
         * In the order the caller lists them: a destination where it appears, a module where its
         * first page appears. So a module listed before Overview sits above it on the rail.
         */
        const railOrder: (NavigationItem | string)[] = [];
        for (const item of navigation) {
            if (item.group === undefined) railOrder.push(item);
            else if (!railOrder.includes(item.group)) railOrder.push(item.group);
        }
        const entries = railOrder.map((slot) => {
            if (typeof slot !== 'string') {
                const item = slot;
                return {
                    key: item.key,
                    label: item.label,
                    icon: item.icon ?? ('dot' as const),
                    active: litKey === item.key,
                    expanded: undefined as boolean | undefined,
                    testID: item.testID === undefined ? undefined : `${item.testID}-rail`,
                    onPress: () => {
                        chooseUngrouped(item);
                    },
                };
            }
            const group = slot;
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
        });

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
                     * The accepted shop design floats the bar: a raised card with a gap from the
                     * window's edges and fully rounded ends, rather than a hairline across the top
                     * of the document. This outer box is only the gap; the card is the row inside.
                     */
                    className="z-raised bg-surface-base px-3 pb-2 pt-2.5 md:px-6 md:pt-4 lg:px-8"
                >
                    <MarketplaceBarEntrance>
                        {/*
                         * The card: exactly 68px tall from `md` (at least 56px on a phone), 1312px at most, its contents
                         * inset 12px at the start and 10px at the end. `rounded-3xl` below `lg`, where a
                         * long Arabic row may still wrap onto a second line and a pill would pinch it;
                         * fully round from `lg`, where it fits.
                         *
                         * The gap is 16px from `md` to `lg`: at 768px the destinations and the
                         * signed-in controls fit on one line only without the wider gap.
                         */}
                        <View className="mx-auto min-h-[56px] w-full max-w-[1312px] flex-row items-center gap-3 rounded-3xl border border-stroke-subtle bg-surface-raised py-1.5 pe-2.5 ps-3 shadow-elevation-3 md:h-[68px] md:gap-4 md:py-0 lg:gap-[18px] lg:rounded-full">
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
                             * The destinations take the middle of the bar, centred between the brand and
                             * the trailing controls. `web:xl:min-w-max` keeps them on one line from `xl`;
                             * below that there is not always room, and wrapping is what keeps the bar
                             * inside the window.
                             */}
                            <View className="flex-1 flex-row items-center justify-center web:xl:min-w-max">
                                {showTopNav ? (
                                    <View
                                        testID={
                                            testID === undefined
                                                ? undefined
                                                : `${testID}-navigation`
                                        }
                                        role="navigation"
                                        aria-label={t('designSystem:shell.primaryNavigation')}
                                        // `shrink` is load-bearing: react-native-web gives every View
                                        // flex-shrink: 0, so without it the row renders at max-content
                                        // width and overflows the document at 768-1023px instead of
                                        // wrapping (flex-wrap only engages once the box can be narrowed).
                                        //
                                        // The destinations sit in a sunken track, and the active one is a
                                        // filled pill inside it — the accepted design's segmented look.
                                        className="shrink flex-row flex-wrap items-center gap-0.5 rounded-3xl bg-surface-base p-1 lg:rounded-full"
                                    >
                                        <MarketplaceNavItems
                                            navigation={navigation}
                                            pillTestID={
                                                testID === undefined
                                                    ? undefined
                                                    : `${testID}-nav-active-bar`
                                            }
                                        />
                                    </View>
                                ) : null}
                            </View>

                            {topbarEnd}
                        </View>
                    </MarketplaceBarEntrance>
                </View>

                <ScrollView
                    {...contentPort}
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    role="main"
                    className="flex-1"
                    // A measure, not a stretch. Past ~1150px a catalogue row grows to five and six
                    // cards and the eye loses the start of the next line; the gutters are wider
                    // here than in a workspace because there is no sidebar taking the same space.
                    contentContainerClassName={cx(
                        'flex-grow gap-4 p-4 md:px-10 md:pt-8 lg:px-11',
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
                    <View className="mx-auto w-full max-w-[1184px] flex-col gap-4 self-stretch">
                        {children}
                    </View>
                    {footer === undefined ? null : (
                        <View
                            testID={testID === undefined ? undefined : `${testID}-footer`}
                            role="contentinfo"
                            // The accepted shop design ends every page in a rounded panel on the
                            // header's 1312px measure, inset from the window like the header, rather
                            // than a line of small print or a band bleeding to both edges. The panel
                            // itself is the caller's `footer`.
                            className="mx-auto mt-10 w-full max-w-[1312px] self-stretch"
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
                        {...contentPort}
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
                                {shownGroup === undefined &&
                                groups.length > 0 &&
                                activeUngrouped !== undefined ? (
                                    <PanelEmptyNote
                                        item={activeUngrouped}
                                        testID={
                                            testID === undefined
                                                ? undefined
                                                : `${testID}-sidebar-empty`
                                        }
                                    />
                                ) : (
                                    navigationList(false, 'surface', shownGroup)
                                )}
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
                        {...contentPort}
                        testID={testID === undefined ? undefined : `${testID}-content`}
                        role="main"
                        className="flex-1"
                        contentContainerClassName={cx(
                            'flex-grow gap-4 p-4 lg:p-7',
                            contentClassName,
                        )}
                    >
                        <ContentWidthProvider value={contentInset}>{children}</ContentWidthProvider>
                        {footer}
                    </ScrollView>
                    {dockBar}
                    {bottomBar}
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
                    {...contentPort}
                    testID={testID === undefined ? undefined : `${testID}-content`}
                    role="main"
                    className="flex-1"
                    contentContainerClassName={cx('flex-grow gap-4 p-4 lg:p-7', contentClassName)}
                >
                    <ContentWidthProvider value={contentInset}>{children}</ContentWidthProvider>
                    {footer}
                </ScrollView>
            </View>

            {dockBar}
            {bottomBar}

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
 * The narrowest window the page panel opens on by itself.
 *
 * Not a breakpoint: nothing about the *page* changes here, only whether the shell spends 232px on
 * a list the module rail can summon. At 1440 the page keeps ~1100px with the panel open, which is
 * what the admin is drawn at. A 1920×1080 laptop at 150% scaling hands the browser 1280, where the
 * open panel left the page ~920 and shutting it gives back a quarter of the screen. The reader's
 * own choice, once made, outranks this either way.
 */
export const PANEL_OPEN_MIN_WIDTH = 1440;

/** The content column's padding per side: `p-4`, and `lg:p-7` from `lg` up. */
const CONTENT_PADDING = 16;
const CONTENT_PADDING_LG = 28;

/** Web only, beside the theme and locale cookies, and the same one-year, root, Lax shape. */
const PANEL_COOKIE = 'h360_panel';
const PANEL_COOKIE_MAX_AGE = 31_536_000;

type PanelChoice = 'open' | 'shut';

function readPersistedPanel(): PanelChoice | null {
    if (Platform.OS !== 'web') return null;
    try {
        const cookie = globalThis.document?.cookie ?? '';
        const value = new RegExp(`(?:^|;\\s*)${PANEL_COOKIE}=([^;]*)`).exec(cookie)?.[1];
        return value === 'open' || value === 'shut' ? value : null;
    } catch {
        return null;
    }
}

function persistPanel(choice: PanelChoice): void {
    if (Platform.OS !== 'web') return;
    try {
        const document_ = globalThis.document;
        if (document_ === undefined) return;
        document_.cookie = `${PANEL_COOKIE}=${choice}; path=/; max-age=${String(PANEL_COOKIE_MAX_AGE)}; samesite=lax`;
    } catch {
        // A refused cookie still leaves a working toggle; the choice just does not outlive the tab.
    }
}

/**
 * One glyph on the module rail. White on the green strip, and a white pill in green when lit. Its
 * name floats beside it on hover, at the rail's inline end.
 */
/**
 * One destination in the workspace page panel — the module's pages beside the rail.
 *
 * ```
 *  ·   Ingredients
 *  ◉  ( Recipes          )   <- current: brand dot in a soft halo, the pill in brand-subtle
 *  ·   Products              <- hover: the pill takes the sunken tint
 * ```
 *
 * The dot is a sibling of the pill in the row, not an absolutely positioned child hanging out of
 * it: react-native-web clips and stacks an escaped child unpredictably, and the first version of
 * this marker, drawn at `-start-5`, did not paint at all. As a flex sibling it always has a box.
 *
 * Hover is state, not a `hover:` class, because the tint belongs on the pill while the pointer
 * target is the whole row — dot included — and a class on the row would tint the gutter too.
 */
function PanelNavLink({
    item,
    onPress,
}: {
    readonly item: NavigationItem;
    readonly onPress: () => void;
}) {
    const [hovered, setHovered] = useState(false);
    const active = item.active === true;

    return (
        <Pressable
            testID={item.testID}
            role="link"
            accessibilityRole="link"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
            aria-current={active ? 'page' : undefined}
            focusable
            onPress={onPress}
            onHoverIn={() => {
                setHovered(true);
            }}
            onHoverOut={() => {
                setHovered(false);
            }}
            className="flex-row items-center gap-1"
        >
            {/*
             * The same bullet on every page, the current one included. The pill behind the label
             * is what says which page is open; a haloed, brand-filled dot beside it said it twice.
             */}
            <View
                testID={item.testID === undefined ? undefined : `${item.testID}-marker`}
                className="w-4 items-center justify-center"
            >
                <View className="h-1.5 w-1.5 rounded-full bg-stroke-strong" />
            </View>
            <View
                className={cx(
                    'min-h-control-md flex-1 flex-row items-center gap-2 rounded-lg px-3 py-1.5',
                    active
                        ? 'bg-surface-brand-subtle'
                        : hovered
                          ? 'bg-surface-sunken'
                          : 'bg-transparent',
                )}
            >
                {/* A step smaller than the module heading above it, so they read as its pages. */}
                <RNText
                    numberOfLines={1}
                    className={cx(
                        'flex-1 text-xs text-start',
                        active
                            ? 'font-semibold text-content-on-brand-subtle'
                            : 'text-content-primary',
                    )}
                >
                    {item.label}
                </RNText>
                {item.badge}
            </View>
        </Pressable>
    );
}

/**
 * What the page panel says on an ungrouped destination — Overview is one page with nothing under
 * it, so the panel names that and points at the rail rather than standing blank or borrowing
 * another module's pages. Laid out like a module's list: a heading-sized line where the module
 * heading sits, the hint a step down, both at the list's inset.
 */
function PanelEmptyNote({
    item,
    testID,
}: {
    readonly item: NavigationItem;
    readonly testID?: string | undefined;
}) {
    const { t } = useTranslation();
    return (
        // `p-5` is the list's `p-2` plus its heading's `px-3 pt-3`: the note starts where a module
        // heading would.
        <View testID={testID} className="flex-col items-start gap-2 p-5">
            {item.icon === undefined ? null : (
                <View className="h-10 w-10 items-center justify-center rounded-lg bg-surface-sunken">
                    <Icon name={item.icon} size="lg" className="text-content-secondary" />
                </View>
            )}
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="text-sm font-bold text-content-primary text-start"
            >
                {t('designSystem:shell.emptyPanelTitle', { page: item.label })}
            </RNText>
            <RNText className="text-xs text-content-secondary text-start">
                {t('designSystem:shell.emptyPanelBody')}
            </RNText>
        </View>
    );
}

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

/** The accepted shop design's overshoot: the pill grows a little past full size and settles. */
const POP_EASING = Easing.bezier(0.34, 1.4, 0.64, 1);
const POP_MS = 600;
const POP_DELAY_MS = 200;
const DROP_MS = 600;
/** The pill's slide between destinations: the board's 350ms on its settle-in curve. */
const SLIDE_MS = 380;
const SLIDE_EASING = Easing.bezier(0.22, 1, 0.36, 1);

/**
 * The marketplace bar's entrance: it drops 14px into place and grows from 98% as it fades in, once,
 * when the shell mounts. Under reduced motion the final style is rendered directly.
 */
function MarketplaceBarEntrance({ children }: { readonly children: ReactNode }) {
    const { enabled, easing } = useMotion();
    const progress = useRef(new Animated.Value(enabled ? 0 : 1)).current;

    useEffect(() => {
        if (!enabled) {
            progress.setValue(1);
            return;
        }
        progress.setValue(0);
        return startAfterPaint(
            Animated.timing(progress, {
                toValue: 1,
                duration: DROP_MS,
                easing: easing.decelerate,
                useNativeDriver: true,
            }),
        );
    }, [enabled, progress, easing]);

    const style = enabled
        ? {
              opacity: progress,
              transform: [
                  {
                      translateY: progress.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-14, 0],
                      }),
                  },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
              ],
          }
        : { opacity: 1 };

    return (
        <AnimatedView className="w-full" style={style}>
            {children}
        </AnimatedView>
    );
}

interface PillPlace {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

/**
 * Where the pill last stood, kept across mounts. The shop's pages sit in more than one route
 * group, each with its own shell, so going from Discover to the account mounts a new bar — and
 * without this the pill could only pop in there instead of sliding over from the tab left behind.
 */
let lastPillPlace: PillPlace | null = null;

/**
 * The shop's destinations, and one filled pill behind the active one that **slides** to the next
 * destination when the page changes — the accepted design's segmented bar. Each item reports where
 * it sits; the pill moves from where it was to there on the design's easing, and pops in only when
 * there is nowhere to slide from (the first page of a visit). Reduced motion moves it at once.
 */
function MarketplaceNavItems({
    navigation,
    pillTestID,
}: {
    readonly navigation: readonly NavigationItem[];
    readonly pillTestID?: string | undefined;
}) {
    const { enabled } = useMotion();
    const isRtl = useIsRtl();
    const [measured, setPlaces] = useState<Readonly<Record<string, PillPlace>>>({});
    const active = navigation.find((item) => item.active === true);
    /*
     * Layout reports `x` from the physical left. The pill is anchored at the logical start, so in
     * Arabic its offset is measured from the right instead: the track's width (its widest item's
     * far edge plus the track's 4px padding) less the item's far edge.
     */
    const trackWidth =
        Math.max(0, ...Object.values(measured).map((place) => place.x + place.width)) + 4;
    const fromStart = (place: PillPlace): PillPlace =>
        isRtl ? { ...place, x: trackWidth - place.x - place.width } : place;
    const measuredActive = active === undefined ? undefined : measured[active.key];
    const target = measuredActive === undefined ? undefined : fromStart(measuredActive);
    // In Arabic a positive offset from the start runs leftwards.
    const sign = isRtl ? -1 : 1;

    const [from] = useState(() => lastPillPlace);
    const x = useRef(new Animated.Value(from?.x ?? 0)).current;
    const y = useRef(new Animated.Value(from?.y ?? 0)).current;
    const width = useRef(new Animated.Value(from?.width ?? 0)).current;
    const height = useRef(new Animated.Value(from?.height ?? 0)).current;
    const pop = useRef(new Animated.Value(from === null && enabled ? 0 : 1)).current;
    const placed = useRef(from !== null);

    // Plain numbers for the effect, so a re-render with the same place does not slide it again.
    const tx = target?.x;
    const ty = target?.y;
    const tw = target?.width;
    const th = target?.height;

    useEffect(() => {
        if (tx === undefined || ty === undefined || tw === undefined || th === undefined) {
            return undefined;
        }
        const target = { x: tx, y: ty, width: tw, height: th };
        const previous = lastPillPlace;
        lastPillPlace = target;
        if (!enabled) {
            x.setValue(target.x);
            y.setValue(target.y);
            width.setValue(target.width);
            height.setValue(target.height);
            pop.setValue(1);
            placed.current = true;
            return undefined;
        }
        if (!placed.current || previous === null) {
            // Nowhere to slide from: stand in place and pop in, as the design opens the bar.
            x.setValue(target.x);
            y.setValue(target.y);
            width.setValue(target.width);
            height.setValue(target.height);
            placed.current = true;
            pop.setValue(0);
            return startAfterPaint(
                Animated.timing(pop, {
                    toValue: 1,
                    duration: POP_MS,
                    delay: POP_DELAY_MS,
                    easing: POP_EASING,
                    useNativeDriver: false,
                }),
            );
        }
        const slide = (value: Animated.Value, to: number) =>
            Animated.timing(value, {
                toValue: to,
                duration: SLIDE_MS,
                easing: SLIDE_EASING,
                useNativeDriver: false,
            });
        pop.setValue(1);
        return startAfterPaint(
            Animated.parallel([
                slide(x, target.x),
                slide(y, target.y),
                slide(width, target.width),
                slide(height, target.height),
            ]),
        );
    }, [enabled, height, pop, th, tw, tx, ty, width, x, y]);

    return (
        <>
            {active === undefined ? null : (
                <AnimatedView
                    // Named off the *shell*, not off the item: the responsive suite enumerates
                    // `[data-testid^="marketplace-nav-"]` controls and checks each is touch-sized.
                    testID={pillTestID}
                    aria-hidden
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    pointerEvents="none"
                    className="absolute start-0 top-0 rounded-full bg-surface-brand shadow-elevation-2"
                    style={{
                        width,
                        height,
                        opacity: target === undefined ? 0 : pop,
                        transform: [
                            { translateX: Animated.multiply(x, sign) },
                            { translateY: y },
                            {
                                scale: pop.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0.6, 1],
                                }),
                            },
                        ],
                    }}
                />
            )}
            {navigation.map((item) => (
                <Pressable
                    // Keyed by direction too: a tab's size does not change when the bar flips, so
                    // the web would not report its new place — remounting it makes it measure again.
                    key={`${item.key}-${isRtl ? 'rtl' : 'ltr'}`}
                    testID={item.testID}
                    role="link"
                    accessibilityRole="link"
                    accessibilityLabel={item.label}
                    accessibilityState={{
                        selected: item.active === true,
                    }}
                    aria-current={item.active === true ? 'page' : undefined}
                    focusable
                    onPress={item.onPress}
                    onLayout={(event: LayoutChangeEvent) => {
                        const {
                            x: left,
                            y: top,
                            width: wide,
                            height: tall,
                        } = event.nativeEvent.layout;
                        setPlaces((current) => {
                            const known = current[item.key];
                            if (
                                known !== undefined &&
                                known.x === left &&
                                known.y === top &&
                                known.width === wide &&
                                known.height === tall
                            ) {
                                return current;
                            }
                            return {
                                ...current,
                                [item.key]: { x: left, y: top, width: wide, height: tall },
                            };
                        });
                    }}
                    // The design's tabs are one width, 118px, from `lg`, so the pill is the same
                    // size on every destination; narrower bars size each to its word.
                    className={cx(
                        'relative min-h-touch flex-row items-center justify-center rounded-full px-3 lg:w-[118px] lg:px-0',
                        item.active === true
                            ? null
                            : 'transition duration-normal ease-standard hover:bg-surface-brand-subtle',
                    )}
                >
                    {/*
                     * No glyph here, unlike the drawer and the sidebar: a top bar is read as a line
                     * of words, and a row of icons costs the space the row has least of.
                     */}
                    <RNText
                        numberOfLines={1}
                        className={cx(
                            'text-sm font-semibold text-start transition-colors duration-normal',
                            item.active === true
                                ? 'text-content-on-brand'
                                : 'text-content-secondary',
                        )}
                    >
                        {item.label}
                    </RNText>
                </Pressable>
            ))}
        </>
    );
}
