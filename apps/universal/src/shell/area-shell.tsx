import {
    AppShell,
    Button,
    DensityProvider,
    Icon,
    IconButton,
    Inline,
    IssueTrayButton,
    OfflineIndicator,
    RailAccount,
    ShellRailButton,
    useBreakpoint,
} from '@healthy360/design-system';
import type { AppShellVariant, NavigationItem } from '@healthy360/design-system';
import type { RouteArea } from '@healthy360/domain-types';
import { Redirect, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useLogoutMutation } from '../data/hooks.ts';
import { isAreaAvailable } from '../features/availability.ts';
import { isShopViewOnly } from '../features/marketplace/shop-view-only.tsx';
import { workspaceGroup } from '../navigation/workspace-group.tsx';
import { guardNavigation } from '../navigation/use-unsaved-guard.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useAccessState, useSession } from '../session/session-provider.tsx';
import { accountIdentity } from './account-identity.ts';
import { LocaleToggle } from './locale-toggle.tsx';
import { KeptWorkButton, KeptWorkDock } from './kept-work-dock.tsx';
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
    /** After the trail in the top bar — the kitchen area's page search. */
    readonly topbarSearch?: ReactNode | undefined;
    /** Beside the kept-work and issue-tray buttons — the kitchen's staff alerts. */
    readonly topbarActions?: ReactNode | undefined;
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
    topbarActions,
    authAside,
    testID = 'app-shell',
}: AreaShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();
    const { me } = useSession();
    const { state: connectivity } = useOnlineStatus();
    const logout = useLogoutMutation();
    const { atLeast } = useBreakpoint();

    const resolvedVariant = variant ?? AREA_SHELL_VARIANT[area];

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
    /*
     * The same test AppShell draws its module rail on. Where the rail is, Workspaces and the account
     * avatar sit at its foot and Sign out lives in the avatar's card; without it — a phone, or an
     * area with no modules — the top bar keeps Sign out, or it would stop existing.
     */
    const railPresent = resolvedVariant === 'workspace' && navigation.length > 0 && atLeast('lg');
    // Not on the workspace page itself, which is where it leads, and never for a shopper, who has
    // none: they reach `/devices` from their account.
    const showWorkspacesButton =
        WORKSPACES_BUTTON_VARIANTS.has(resolvedVariant) &&
        pathname !== '/workspace' &&
        isShopViewOnly(accessState);
    // The bar sits outside `KitchenOpsShell`'s compact provider, so on a staff page its two buttons
    // would otherwise come out at the customer app's 44px. Every staff area takes the 28px pair —
    // the KDS and the driver area included, by the user's choice on 2026-10-25.
    const barDensity = WORKSPACES_BUTTON_VARIANTS.has(resolvedVariant) ? 'compact' : 'comfortable';
    // On a phone the staff bar's two labelled buttons pushed it 33px past the window, so below `md`
    // they are their glyphs, named for a screen reader and on hover.
    const iconsOnly = WORKSPACES_BUTTON_VARIANTS.has(resolvedVariant) && !atLeast('md');
    const toWorkspace = () => {
        guardNavigation(() => {
            router.push('/workspace' as never);
        });
    };

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

    const workspacesLabel = t('marketplace:nav.workspaces');
    const topbarEnd =
        resolvedVariant === 'auth' || resolvedVariant === 'kiosk' ? undefined : (
            <Inline space="xs" wrap={false}>
                {/*
                 * The way back into unfinished work — a process stepped out of, editors kept for
                 * later — when its card at the bottom of the page is minimised (`kept-work-dock.tsx`),
                 * then the page's issue tray: what is left to fix here, from anywhere on the page.
                 * Each is drawn only when it has something to hold.
                 */}
                <KeptWorkButton />
                <IssueTrayButton />
                {topbarActions}
                <LocaleToggle round={WORKSPACES_BUTTON_VARIANTS.has(resolvedVariant)} />
                {/*
                 * Back to the workspace page, to choose another area. Labelled, because it is the
                 * one way between areas; `self-center`, because `Button` is `self-start` by default.
                 */}
                <DensityProvider value={barDensity}>
                    {!showWorkspacesButton ? null : iconsOnly ? (
                        <IconButton
                            testID="workspaces-button"
                            label={workspacesLabel}
                            icon={<Icon name="gridDots" />}
                            onPress={toWorkspace}
                        />
                    ) : (
                        <Button
                            testID="workspaces-button"
                            size="sm"
                            variant="secondary"
                            label={workspacesLabel}
                            iconStart={
                                <Icon name="gridDots" size="sm" className="text-content-primary" />
                            }
                            className="!h-11 !min-h-0 self-center !rounded-full !px-4"
                            onPress={toWorkspace}
                        />
                    )}
                </DensityProvider>
                <ThemeToggle />
                <DensityProvider value={barDensity}>
                    {railPresent ? null : iconsOnly ? (
                        <IconButton
                            testID="sign-out"
                            label={t('common:action.signOut')}
                            disabled={logout.isPending}
                            icon={<Icon name="signOut" />}
                            onPress={signOut}
                        />
                    ) : (
                        <Button
                            testID="sign-out"
                            size="sm"
                            // The workspace page's bar is the quiet one its board draws.
                            variant={pathname === '/workspace' ? 'secondary' : 'primary'}
                            label={t('common:action.signOut')}
                            loading={logout.isPending}
                            {...(pathname === '/workspace'
                                ? {
                                      iconStart: (
                                          <Icon
                                              name="signOut"
                                              size="sm"
                                              className="text-content-primary"
                                          />
                                      ),
                                      className: '!h-11 !min-h-0 self-center !rounded-full !px-4',
                                  }
                                : { className: 'self-center' })}
                            onPress={signOut}
                        />
                    )}
                </DensityProvider>
            </Inline>
        );

    const identity = accountIdentity(me);
    /*
     * The rail's foot (avatar option B, 2026-11-07): Workspaces as a rail glyph, then the avatar,
     * whose card holds who is signed in and Sign out — nothing else.
     */
    const railEnd = !railPresent ? undefined : (
        <>
            {showWorkspacesButton ? (
                <ShellRailButton
                    testID="workspaces-rail"
                    label={workspacesLabel}
                    icon="gridDots"
                    onPress={toWorkspace}
                />
            ) : null}
            <RailAccount
                testID="account"
                name={identity.name || t('designSystem:shell.account')}
                detail={identity.detail}
                label={t('designSystem:shell.accountFor', {
                    name: identity.name || t('designSystem:shell.account'),
                })}
                menuLabel={t('designSystem:shell.account')}
                signOutLabel={t('common:action.signOut')}
                signingOut={logout.isPending}
                onSignOut={signOut}
            />
        </>
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
            {...(topbarSearch === undefined ? {} : { topbarSearch })}
            {...(railEnd === undefined ? {} : { railEnd })}
            {...(sidebarWidth === undefined ? {} : { sidebarWidth })}
            {...(sidebarBackground === undefined ? {} : { sidebarBackground })}
            {...(sidebarStart === undefined ? {} : { sidebarStart })}
            {...(sidebarStartCollapsed === undefined ? {} : { sidebarStartCollapsed })}
            {...(authAside === undefined ? {} : { authAside })}
        >
            {children}
        </AppShell>
    );

    /*
     * The kept work's card floats over the page, so it sits beside the shell rather than in its
     * scroll port. Not on a sign-in page or a kiosk, which have no top bar to minimise it into.
     */
    const framed =
        resolvedVariant === 'auth' || resolvedVariant === 'kiosk' ? (
            shell
        ) : (
            <View className="flex-1">
                {shell}
                <KeptWorkDock />
            </View>
        );

    if (unguarded) return framed;

    return <Gate area={area}>{framed}</Gate>;
}
