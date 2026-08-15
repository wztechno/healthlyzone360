import { AppShell, Button, Inline, OfflineIndicator } from '@healthy360/design-system';
import type { AppShellVariant, NavigationItem } from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import type { RouteArea } from '@healthy360/domain-types';
import { Redirect, usePathname, useRouter } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../access/gate.tsx';
import { useLogoutMutation } from '../data/hooks.ts';
import { isAreaAvailable } from '../features/availability.ts';
import { permittedNavigation } from '../navigation/items.ts';
import { useOnlineStatus } from '../online/online-status.tsx';
import { useAccessState } from '../session/session-provider.tsx';

/**
 * Which shell chrome each area gets.
 *
 * Kiosk hardware (POS, KDS) is bare by design; drivers get thumb-reachable tabs; consumers get a
 * plain top bar because a sidebar of one item is noise; everything else is a staff workspace.
 */
export const AREA_SHELL_VARIANT: Readonly<Record<RouteArea, AppShellVariant>> = {
    public: 'public',
    auth: 'auth',
    customer: 'public',
    patient: 'public',
    dietitian: 'workspace',
    clinic: 'workspace',
    kitchen: 'workspace',
    pos: 'kiosk',
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
 * on `/pos` never mounts a query, a logout mutation or a line of chrome on its way back to `/`.
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
    testID = 'app-shell',
}: AreaShellProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const accessState = useAccessState();
    const { state: connectivity } = useOnlineStatus();
    const { locale, setLocale } = useLocale();
    const logout = useLogoutMutation();

    const resolvedVariant = variant ?? AREA_SHELL_VARIANT[area];

    const navigation = useMemo<readonly NavigationItem[]>(() => {
        if (resolvedVariant === 'auth' || resolvedVariant === 'kiosk') return [];
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
    }, [accessState, pathname, resolvedVariant, router, t]);

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
                 */}
                <Button
                    testID="sign-out"
                    size="sm"
                    variant="quiet"
                    label={t('common:action.signOut')}
                    loading={logout.isPending}
                    onPress={() => {
                        logout.mutate(undefined, {
                            onSuccess: () => {
                                router.replace('/sign-in');
                            },
                        });
                    }}
                />
            </Inline>
        );

    const shell = (
        <AppShell
            testID={testID}
            variant={resolvedVariant}
            title={title ?? t(`access:area.${area}`)}
            navigation={navigation}
            banner={banner}
            topbarEnd={topbarEnd}
        >
            {children}
        </AppShell>
    );

    if (unguarded) return shell;

    return <Gate area={area}>{shell}</Gate>;
}
