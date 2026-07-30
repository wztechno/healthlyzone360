import { Spinner } from '@healthy360/design-system';
import type { RouteArea } from '@healthy360/domain-types';
import { can, evaluateGates, mergeRequirements, requirementForArea } from '@healthy360/permissions';
import type { DenialReason, GateResult, RouteRequirement } from '@healthy360/permissions';
import { Redirect } from 'expo-router';
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAccessState, useSession } from '../session/session-provider.tsx';
import { useSettledCondition } from './use-settled-condition.ts';
import { ForbiddenScreen } from '../screens/forbidden-screen.tsx';

/**
 * Declarative access guards over the framework-independent kernel in `@healthy360/permissions`.
 *
 * These improve the *experience* only. Laravel remains authoritative and re-authorises every action
 * server-side (05-universal-frontend.md §5.3) — a client guard that were the security boundary
 * would be defeated by a devtools console.
 */

export interface GateProps {
    readonly children: ReactNode;
    /** Guard against a whole area's registry baseline. */
    readonly area?: RouteArea | undefined;
    /** Additional demands on top of the area baseline. Screens may tighten, never loosen. */
    readonly requirement?: Omit<RouteRequirement, 'area'> | undefined;
    /** Replaces the default forbidden page. */
    readonly fallback?: ReactNode | undefined;
    /** Replaces the default restoring splash. */
    readonly pending?: ReactNode | undefined;
    readonly testID?: string | undefined;
}

export function useGate(
    area: RouteArea | undefined,
    override: Omit<RouteRequirement, 'area'> | undefined,
): GateResult {
    const state = useAccessState();

    return useMemo(() => {
        const base: RouteRequirement =
            area === undefined ? { area: 'public' } : requirementForArea(area);
        const requirement = override === undefined ? base : mergeRequirements(base, override);
        return evaluateGates(state, requirement);
    }, [state, area, override]);
}

/**
 * Renders `children` only when every gate passes.
 *
 * A `deny` renders the forbidden page **in place**, keeping the URL the user typed. That is
 * deliberate: redirecting to `/forbidden` loses the address that was refused, which makes a support
 * conversation guesswork and makes the deep-link case untestable.
 */
export function Gate({ children, area, requirement, fallback, pending, testID }: GateProps) {
    const { t } = useTranslation();
    const result = useGate(area, requirement);
    const { isRefreshing } = useSession();
    const redirectSettled = useSettledCondition(result.status === 'redirect');

    if (result.status === 'allow') return <>{children}</>;

    if (result.status === 'pending') {
        return (
            pending ?? (
                <View
                    testID={testID === undefined ? `gate-pending` : `${testID}-pending`}
                    className="flex-1 items-center justify-center p-8"
                >
                    <Spinner
                        testID="session-restoring"
                        size="large"
                        showLabel
                        label={t('common:state.restoringSession')}
                    />
                </View>
            )
        );
    }

    if (result.status === 'redirect') {
        // A context-dependent redirect must not fire off a stale frame: `router.replace` renders
        // the destination synchronously while TanStack delivers cache updates in a batched
        // notification, so the first frame here can be one session update behind and would bounce
        // the user straight back to the picker they just left. Hold while the session refreshes
        // AND until the condition has survived one tick (useSettledCondition).
        if (isRefreshing || !redirectSettled) {
            return (
                <View
                    testID={testID === undefined ? `gate-refreshing` : `${testID}-refreshing`}
                    className="flex-1 items-center justify-center p-8"
                >
                    <Spinner size="large" showLabel label={t('common:state.restoringSession')} />
                </View>
            );
        }
        return <Redirect href={result.href as never} />;
    }

    return (
        fallback ?? (
            <ForbiddenScreen
                reason={result.reason}
                missing={result.missing ?? []}
                testID={testID === undefined ? 'forbidden' : `${testID}-forbidden`}
            />
        )
    );
}

export interface CanProps {
    readonly children: ReactNode;
    /** Permission keys. All are required unless `match="any"`. */
    readonly permission: string | readonly string[];
    readonly match?: 'all' | 'any' | undefined;
    readonly fallback?: ReactNode | undefined;
}

/** Conditional rendering on a permission. Nothing is rendered when the permission is absent. */
export function Can({ children, permission, match = 'all', fallback = null }: CanProps) {
    return <>{useCan(permission, match) ? children : fallback}</>;
}

export function useCan(permission: string | readonly string[], match: 'all' | 'any' = 'all'): boolean {
    const state = useAccessState();
    return can(state, permission, match);
}

export function useDenialReason(
    area: RouteArea | undefined,
    override?: Omit<RouteRequirement, 'area'>,
): DenialReason | null {
    const result = useGate(area, override);
    return result.status === 'deny' || result.status === 'redirect' ? result.reason : null;
}
