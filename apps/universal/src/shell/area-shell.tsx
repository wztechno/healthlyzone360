import {
    AppShell,
    Button,
    Icon,
    IconButton,
    Inline,
    OfflineIndicator,
    useBreakpoint,
} from '@healthy360/design-system';
import type { AppShellVariant, NavigationItem } from '@healthy360/design-system';
import type { RouteArea } from '@healthy360/domain-types';
import { Redirect, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useLogoutMutation } from '../data/hooks.ts';
import { isAreaAvailable } from '../features/availability.ts';
import { workspaceGroup } from '../navigation/workspace-group.tsx';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useAccessState } from '../session/session-provider.tsx';
import { LocaleToggle } from './locale-toggle.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

/**
 * Which shell chrome each area gets.
 *
 * Consumers get a plain top bar because a sidebar of one item is noise; everything else is a staff
 * workspace — the KDS board and the driver area included, so every admin page has the same top bar
 * and the same Workspaces button back to the workspace page. Both used to be bare under a bottom bar
 * of areas, which is gone.
 */
export const AREA_SHELL_VARIANT: Readonly<Record<RouteArea, AppShellVariant>> = {
    public: 'public',
    auth: 'auth',
    customer: 'public',
    patient: 'public',
    dietitian: 'workspace',
    clinic: 'workspace',
    kitchen: 'workspace',
    kds: 'workspace',
    driver: 'workspace',
    partner: 'workspace',
    corporate: 'workspace',
    insurance: 'workspace',
    'platform-admin': 'workspace',
};

/** The chromes whose top bar leads back to the workspace page: the staff desks. */
const WORKSPACES_BUTTON_VARIANTS: ReadonlySet<AppShellVariant> = new Set(['workspace', 'rail']);

export interface AreaShellProps {
    readonly area: RouteArea;
    readonly children: ReactNode;
    /** Overrides the area's default chrome — the auth flow uses this for the card variant. */
    readonly variant?: AppShellVariant | undefined;
    readonly title?: string | undefined;
    /** Skip the gate. Only the auth area does this; everything else must be guarded. */
    readonly unguarded?: boolean | undefined;
    /**
     * The area's own rail — the kitchen family rail. Without one the area draws no rail at all:
     * the workspace switcher is the bottom bar, not a rail module.
     */
    readonly navigation?: readonly NavigationItem[] | undefined;
    readonly sidebarWidth?: number | undefined;
    readonly sidebarBackground?: ReactNode | undefined;
    readonly sidebarStart?: ReactNode | undefined;
    /** `sidebarStart` for the collapsed sidebar — the brand mark alone. */
    readonly sidebarStartCollapsed?: ReactNode | undefined;
    /** Drawn in the top bar in place of the area title — the kitchen's breadcrumb trail. */
    readonly topbarTitle?: ReactNode | undefined;
    /** Leads the top bar's trailing controls — the kitchen area's page search. */
    readonly topbarSearch?: ReactNode | undefined;
    /**
     * Move Sign out from the top bar to the bottom of the sidebar (KITCHEN.md sidebar spec). Only
     * where the sidebar exists: below `lg` the top bar keeps it, because the drawer is a light
     * overlay with its own title bar.
     */
    readonly signOutInSidebar?: boolean | undefined;
    /** `auth` variant only: the brand panel beside the card from `lg` up. */
    readonly authAside?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

/**
 * One wrapper every area layout uses: guard first, then chrome.
 *
 * The order matters. Rendering the shell around a `<Gate>` would paint a sidebar full of
 * destinations before discovering the user may not be here at all; guarding outside it means a
 * refusal never shows navigation that does not belong to the refused person.
 *
 * ## Two guards, and the availability one runs first
 *
 * An area with no backend behind it (`../features/availability.ts`) is not a permission question —
 * nobody may be there, however entitled they are — so it is answered before the session is even
 * consulted. Splitting it into this outer component rather than an early return inside the body is
 * what keeps the hooks unconditional: the redirect happens with no hook having run, so a direct hit
 * on `/driver` never mounts a query, a logout mutation or a line of chrome on its way back to `/`.
 */
export function AreaShell(props: AreaShellProps) {
    if (!isAreaAvailable(props.area)) return <Redirect href="/" />;
    return <GuardedAreaShell {...props} />;
}

function GuardedAreaShell({
    area,
    children,
    variant,
    title,
    unguarded = false,
    navigation: navigationOverride,
    sidebarWidth,
    sidebarBackground,
    sidebarStart,
    sidebarStartCollapsed,
    topbarTitle,
    topbarSearch,
    signOutInSidebar = false,
    authAside,
    testID = 'app-shell',
}: AreaShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();
    const { state: connectivity } = useOnlineStatus();
    const logout = useLogoutMutation();
    const { atLeast } = useBreakpoint();

    const resolvedVariant = variant ?? AREA_SHELL_VARIANT[area];
    // Same threshold AppShell uses to swap the sidebar for the drawer: when there is no sidebar,
    // Sign out must stay in the top bar or it stops existing.
    const sidebarPresent = signOutInSidebar && atLeast('lg');

    /*
     * The driver chrome's tabs, when a caller asks for that chrome: the areas and the account pages.
     * No area uses it any more — the admin pages lead back to the workspace page from their top bar
     * instead, where every area and the account pages are.
     */
    const switcher = useMemo<readonly NavigationItem[]>(() => {
        if (resolvedVariant !== 'driver') return [];
        return workspaceGroup({
            state: accessState,
            t,
            pathname,
            currentArea: area,
            navigate: (href) => {
                router.push(href as never);
            },
        });
    }, [accessState, area, pathname, resolvedVariant, router, t]);

    const navigation = useMemo<readonly NavigationItem[]>(() => {
        if (resolvedVariant === 'auth' || resolvedVariant === 'kiosk') return [];
        if (resolvedVariant === 'driver') return switcher;
        return navigationOverride ?? [];
    }, [navigationOverride, resolvedVariant, switcher]);
    // Not on the workspace page itself, which is where it leads.
    const showWorkspacesButton =
        WORKSPACES_BUTTON_VARIANTS.has(resolvedVariant) && pathname !== '/workspace';

    const signOut = () => {
        logout.mutate(undefined, {
            onSuccess: () => {
                router.replace('/sign-in');
            },
        });
    };

    const banner = (
        <View>
            <OfflineIndicator testID="offline-indicator" state={connectivity} />
        </View>
    );

    const topbarEnd =
        resolvedVariant === 'auth' || resolvedVariant === 'kiosk' ? undefined : (
            <Inline space="xs" wrap={false}>
                {topbarSearch}
                <LocaleToggle />
                <ThemeToggle />
                {/*
                 * Back to the workspace page, to choose another area. Labelled, because it is the
                 * one way between areas. Filled green, like Sign out beside it: the top bar's two
                 * ways off the page are drawn alike on every staff page and on the workspace page.
                 */}
                {showWorkspacesButton ? (
                    <Button
                        testID="workspaces-button"
                        size="sm"
                        variant="primary"
                        label={t('marketplace:nav.workspaces')}
                        onPress={() => {
                            router.push('/workspace' as never);
                        }}
                    />
                ) : null}
                {/*
                 * Sign out is filled green, as Workspaces is — a deliberate departure from Rule 4,
                 * which would keep it quiet and leave the top-bar primary empty. The areas with a
                 * core-loop action — the kitchen workbench, the editors — still carry it on the
                 * screen that owns it, never in this bar.
                 *
                 * When the area pins Sign out to its sidebar, this control moves there — but only
                 * while the sidebar is on screen.
                 */}
                {sidebarPresent ? null : (
                    <Button
                        testID="sign-out"
                        size="sm"
                        variant="primary"
                        label={t('common:action.signOut')}
                        loading={logout.isPending}
                        onPress={signOut}
                    />
                )}
            </Inline>
        );

    // KITCHEN.md sidebar spec: quiet, bordered, never filled — a filled button would compete with
    // the active item.
    const sidebarSignOut = !sidebarPresent ? undefined : (
        <View className="border-t border-content-on-sidebar-muted/30 p-3">
            <Pressable
                testID="sign-out"
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('common:action.signOut')}
                accessibilityState={{ disabled: logout.isPending }}
                disabled={logout.isPending}
                focusable
                onPress={signOut}
                className="min-h-touch items-center justify-center rounded-lg border border-content-on-sidebar-muted/60"
            >
                <RNText className="text-sm font-semibold text-content-on-sidebar">
                    {t('common:action.signOut')}
                </RNText>
            </Pressable>
        </View>
    );

    // The same control on the collapsed sidebar: its glyph, named on hover.
    const sidebarSignOutCollapsed = !sidebarPresent ? undefined : (
        <View className="items-center border-t border-content-on-sidebar-muted/30 py-3">
            <IconButton
                testID="sign-out-rail"
                label={t('common:action.signOut')}
                disabled={logout.isPending}
                icon={<Icon name="signOut" size="lg" className="text-content-on-sidebar" />}
                onPress={signOut}
            />
        </View>
    );

    const shell = (
        <AppShell
            testID={testID}
            variant={resolvedVariant}
            title={title ?? t(`access:area.${area}`)}
            navigation={navigation}
            banner={banner}
            topbarEnd={topbarEnd}
            {...(topbarTitle === undefined ? {} : { topbarTitle })}
            {...(sidebarWidth === undefined ? {} : { sidebarWidth })}
            {...(sidebarBackground === undefined ? {} : { sidebarBackground })}
            {...(sidebarStart === undefined ? {} : { sidebarStart })}
            {...(sidebarStartCollapsed === undefined ? {} : { sidebarStartCollapsed })}
            {...(sidebarSignOut === undefined ? {} : { sidebarEnd: sidebarSignOut })}
            {...(sidebarSignOutCollapsed === undefined
                ? {}
                : { sidebarEndCollapsed: sidebarSignOutCollapsed })}
            {...(authAside === undefined ? {} : { authAside })}
        >
            {children}
        </AppShell>
    );

    if (unguarded) return shell;

    return <Gate area={area}>{shell}</Gate>;
}
