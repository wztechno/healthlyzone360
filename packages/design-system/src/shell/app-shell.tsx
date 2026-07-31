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

    const navigationList = (compact: boolean) => (
        <View
            testID={testID === undefined ? undefined : `${testID}-navigation`}
            role="navigation"
            aria-label={t('designSystem:shell.primaryNavigation')}
            className="flex-col gap-1 p-2"
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
                    onPress={() => {
                        setDrawerOpen(false);
                        item.onPress();
                    }}
                    className={cx(
                        'min-h-touch flex-row items-center gap-2 rounded-lg px-3 py-2',
                        compact ? 'justify-center' : null,
                        item.active === true ? 'bg-surface-brand-subtle' : 'bg-transparent',
                    )}
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
                    {compact ? null : (
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'flex-1 text-sm text-start',
                                item.active === true
                                    ? 'text-content-on-brand-subtle font-medium'
                                    : 'text-content-primary',
                            )}
                        >
                            {item.label}
                        </RNText>
                    )}
                </Pressable>
            ))}
        </View>
    );

    const sidebar = (
        <View
            testID={testID === undefined ? undefined : `${testID}-sidebar`}
            className={cx(
                'h-full border-e border-stroke-subtle bg-surface-raised',
                variant === 'rail' ? 'w-[88px]' : 'w-[260px]',
            )}
        >
            {navigationList(variant === 'rail')}
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

                    <View className="flex-1 flex-row items-center">
                        {showTopNav ? (
                            <View
                                testID={testID === undefined ? undefined : `${testID}-navigation`}
                                role="navigation"
                                aria-label={t('designSystem:shell.primaryNavigation')}
                                // `shrink` is load-bearing: react-native-web gives every View
                                // flex-shrink: 0, so without it the row renders at max-content
                                // width and overflows the document at 768-1023px instead of
                                // wrapping (flex-wrap only engages once the box can be narrowed).
                                className="flex-row flex-wrap items-center gap-1 shrink"
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
                                        className={cx(
                                            'min-h-touch flex-row items-center gap-2 rounded-lg px-3 py-2',
                                            item.active === true
                                                ? 'bg-surface-brand-subtle'
                                                : 'bg-transparent',
                                        )}
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
                                            numberOfLines={1}
                                            className={cx(
                                                'text-sm text-start',
                                                item.active === true
                                                    ? 'text-content-on-brand-subtle font-medium'
                                                    : 'text-content-primary',
                                            )}
                                        >
                                            {item.label}
                                        </RNText>
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
                    contentContainerClassName={cx('flex-grow p-4 gap-4', contentClassName)}
                >
                    {children}
                    {footer === undefined ? null : (
                        <View
                            testID={testID === undefined ? undefined : `${testID}-footer`}
                            role="contentinfo"
                            className="border-t border-stroke-subtle pt-4"
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
                        contentContainerClassName={cx('flex-grow p-4 gap-4', contentClassName)}
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
                    contentContainerClassName={cx('flex-grow p-4 gap-4', contentClassName)}
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
