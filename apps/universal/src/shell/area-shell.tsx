import { AppShell, Button, Inline, OfflineIndicator, useBreakpoint } from '@healthy360/design-system';
import type { AppShellVariant, NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import type { RouteArea } from '@healthy360/domain-types';
import { Redirect, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useLogoutMutation } from '../data/hooks.ts';
import { isAreaAvailable } from '../features/availability.ts';
import { permittedNavigation } from '../navigation/items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useAccessState } from '../session/session-provider.tsx';

/**
 * Which shell chrome each area gets.
 *
 * Kiosk hardware (the KDS ticket board) is bare by design; drivers get thumb-reachable tabs;
 * consumers get a plain top bar because a sidebar of one item is noise; everything else is a staff
 * workspace.
 */
export const AREA_SHELL_VARIANT: Readonly<Record<RouteArea, AppShellVariant>> = {
    public: 'public',
    auth: 'auth',
    customer: 'public',
    patient: 'public',
    dietitian: 'workspace',
    clinic: 'workspace',
    kitchen: 'workspace',
    kds: 'kiosk',
    driver: 'driver',
    partner: 'workspace',
    corporate: 'workspace',
    insurance: 'workspace',
    'platform-admin': 'workspace',
};

export interface AreaShellProps {
    readonly area: RouteArea;
    readonly children: ReactNode;
    /** Overrides the area's default chrome — the auth flow uses this for the card variant. */
    readonly variant?: AppShellVariant | undefined;
    readonly title?: string | undefined;
    /** Skip the gate. Only the auth area does this; everything else must be guarded. */
    readonly unguarded?: boolean | undefined;
    /**
     * Replaces the workspace destinations with an area-owned rail — the kitchen family rail.
     * The default stays `permittedNavigation`, which is what every other area wants.
     */
    readonly navigation?: readonly NavigationItem[] | undefined;
    readonly sidebarWidth?: number | undefined;
    readonly sidebarBackground?: ReactNode | undefined;
    readonly sidebarStart?: ReactNode | undefined;
    /**
     * Move Sign out from the top bar to the bottom of the sidebar (KITCHEN.md sidebar spec). Only
     * where the sidebar exists: below `lg` the top bar keeps it, because the drawer is a light
     * overlay and a canopy-styled control inside it would be mint on white.
     */
    readonly signOutInSidebar?: boolean | undefined;
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
    signOutInSidebar = false,
    testID = 'app-shell',
}: AreaShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();
    const { state: connectivity } = useOnlineStatus();
    const { locale, setLocale } = useLocale();
    const logout = useLogoutMutation();
    const { atLeast } = useBreakpoint();

    const resolvedVariant = variant ?? AREA_SHELL_VARIANT[area];
    // Same threshold AppShell uses to swap the sidebar for the drawer: when there is no sidebar,
    // Sign out must stay in the top bar or it stops existing.
    const sidebarPresent = signOutInSidebar && atLeast('lg');

    const navigation = useMemo<readonly NavigationItem[]>(() => {
        if (resolvedVariant === 'auth' || resolvedVariant === 'kiosk') return [];
        if (navigationOverride !== undefined) return navigationOverride;
        return permittedNavigation(accessState).map((item) => ({
            key: item.key,
            label: t(item.labelKey),
            icon: item.icon,
            active: pathname === item.href,
            testID: `nav-${item.key}`,
            onPress: () => {
                router.push(item.href as never);
            },
        }));
    }, [accessState, navigationOverride, pathname, resolvedVariant, router, t]);

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
                <Button
                    testID="locale-toggle"
                    size="sm"
                    variant="ghost"
                    label={locale.startsWith('ar') ? 'English' : t('common:locale.arabic')}
                    onPress={() => {
                        void setLocale(locale.startsWith('ar') ? 'en' : 'ar');
                    }}
                />
                {/*
                 * Sign out is quiet here and the primary slot is left *empty*. Rule 4 is explicit
                 * that a staff area with no single core-loop action gets no top-bar primary at
                 * all: promoting navigation into the slot, or letting a destructive action sit
                 * there, is worse than leaving it alone. The areas that do have one — the kitchen
                 * workbench, the editors — carry it on the screen that owns it.
                 *
                 * When the area pins Sign out to its sidebar, this control moves there — but only
                 * while the sidebar is on screen.
                 */}
                {sidebarPresent ? null : (
                    <Button
                        testID="sign-out"
                        size="sm"
                        variant="quiet"
                        label={t('common:action.signOut')}
                        loading={logout.isPending}
                        onPress={signOut}
                    />
                )}
            </Inline>
        );

    // KITCHEN.md sidebar spec: quiet, translucent border, never filled. On the canopy the quiet
    // button's white fill would glow, so this control states its own colours — the same
    // translucent pair PageHero's chips use.
    const sidebarSignOut = !sidebarPresent ? undefined : (
        <View className="border-t border-content-on-canopy-muted/30 p-3">
            <Pressable
                testID="sign-out"
                role="button"
                accessibilityRole="button"
                accessibilityLabel={t('common:action.signOut')}
                accessibilityState={{ disabled: logout.isPending }}
                disabled={logout.isPending}
                focusable
                onPress={signOut}
                className="min-h-touch items-center justify-center rounded-lg border border-content-on-canopy-muted/30"
            >
                <RNText className="text-sm font-semibold text-content-on-canopy-muted/80">
                    {t('common:action.signOut')}
                </RNText>
            </Pressable>
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
            {...(sidebarWidth === undefined ? {} : { sidebarWidth })}
            {...(sidebarBackground === undefined ? {} : { sidebarBackground })}
            {...(sidebarStart === undefined ? {} : { sidebarStart })}
            {...(sidebarSignOut === undefined ? {} : { sidebarEnd: sidebarSignOut })}
        >
            {children}
        </AppShell>
    );

    if (unguarded) return shell;

    return <Gate area={area}>{shell}</Gate>;
}
