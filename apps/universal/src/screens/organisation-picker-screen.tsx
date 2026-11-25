import {
    Badge,
    Button,
    EmptyState,
    ErrorState,
    Icon,
    Inline,
    Spinner,
    Stack,
    Text,
    cx,
} from '@healthy360/design-system';
import type { Membership, MembershipStatus } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { appConfig } from '../config.ts';
import { toFailure, useSetContextMutation } from '../data/hooks.ts';
import { selectableMemberships } from '../session/machine.ts';
import { useSession } from '../session/session-provider.tsx';
import { AuthBadge, AuthTitle } from '../ui/auth-form.tsx';

const STATUS_TONE: Readonly<
    Record<MembershipStatus, 'success' | 'warning' | 'danger' | 'neutral'>
> = {
    active: 'success',
    pending: 'warning',
    suspended: 'warning',
    expired: 'neutral',
    revoked: 'danger',
};

/**
 * Organisation picker, drawn in the sign-in boards' frame (`AuthFrame`, set by the `(auth)`
 * layout): the badge, the title, and one soft box a kitchen — its name on a line of its own, its
 * roles and status as chips under it. The chips used to sit beside the name and left it no width.
 *
 * Three behaviours worth naming:
 *
 * * **Auto-skip with exactly one.** A picker with a single option is a dead click, so the only
 *   active membership is applied automatically and the user never sees this screen.
 * * **Non-active memberships are listed but not selectable.** A pending invitation is information
 *   the user needs ("why can I not see my clinic?"); hiding it makes the answer unavailable.
 * * **No organisation is not an error for consumers.** In `customer` / `all-dev`, a person with
 *   no memberships is a pure consumer and is redirected to `/customer` without a dead-end empty
 *   state. Staff builds still explain the empty list (they need an invite).
 */
export function OrganisationPickerScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { me } = useSession();
    const setContext = useSetContextMutation();
    const autoSelected = useRef(false);
    const consumerRedirected = useRef(false);

    const memberships = me?.memberships ?? [];
    const selectable = selectableMemberships(memberships);
    const failure = toFailure(setContext.error);
    const consumerWithoutOrg =
        memberships.length === 0 &&
        (appConfig.appMode === 'customer' || appConfig.appMode === 'all-dev');

    const choose = (membership: Membership) => {
        // Choosing the organisation already being worked in keeps its branch. Naming no branch
        // tells the server to forget the one it remembers, and "Switch organisation" with a single
        // membership lands here by itself — which silently cost a manager the kitchen and its
        // display, both of which need a branch.
        const current = me?.activeContext ?? null;
        const keptBranchId = current?.membershipId === membership.id ? current.branchId : null;
        setContext.mutate(
            {
                organisationId: membership.organisation.id,
                ...(keptBranchId === null ? {} : { branchId: keptBranchId }),
            },
            {
                onSuccess: () => {
                    // Always the workspace page: with no branch yet, its top-bar switcher opens
                    // on the choice, so there is no page in between.
                    router.replace('/workspace');
                },
            },
        );
    };

    useEffect(() => {
        if (!consumerWithoutOrg || me === null || consumerRedirected.current) return;
        consumerRedirected.current = true;
        router.replace('/discover');
    }, [consumerWithoutOrg, me, router]);

    useEffect(() => {
        const only = selectable.length === 1 ? selectable[0] : undefined;
        if (only === undefined || autoSelected.current || setContext.isPending) return;
        autoSelected.current = true;
        choose(only);
        // `choose` is stable enough for this one-shot effect; re-running on every render would
        // fire the mutation repeatedly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectable.length, setContext.isPending]);

    if (me === null) {
        return (
            <Stack testID="organisation-picker-screen" space="md">
                <Spinner size="large" showLabel />
            </Stack>
        );
    }

    if (consumerWithoutOrg) {
        return (
            <Stack testID="organisation-picker-screen" space="md">
                <Spinner
                    testID="organisation-picker-consumer-redirect"
                    size="large"
                    showLabel
                    label={t('auth:organisationPicker.emptyAction')}
                />
            </Stack>
        );
    }

    if (memberships.length === 0) {
        return (
            <Stack testID="organisation-picker-screen" space="lg">
                <EmptyState
                    testID="organisation-picker-empty"
                    title={t('auth:organisationPicker.empty')}
                    body={t('auth:organisationPicker.emptyBody')}
                    actions={
                        <Button
                            testID="organisation-picker-continue-personal"
                            variant="primary"
                            label={t('auth:organisationPicker.emptyAction')}
                            onPress={() => {
                                router.replace('/discover');
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (selectable.length === 1) {
        return (
            <Stack testID="organisation-picker-screen" space="md">
                <Spinner
                    testID="organisation-picker-autoskip"
                    size="large"
                    showLabel
                    label={t('auth:organisationPicker.onlyOne')}
                />
            </Stack>
        );
    }

    return (
        <View testID="organisation-picker-screen" className="flex-col gap-3.5">
            <AuthBadge icon="leaf" />
            <AuthTitle testID="organisation-picker-title">
                {t('auth:organisationPicker.title')}
            </AuthTitle>

            {failure === null ? null : (
                <ErrorState testID="organisation-picker-error" failure={failure} />
            )}

            {/* One soft box a kitchen, as the invitation's facts box is drawn. */}
            <View className="mt-1 flex-col gap-2.5">
                {memberships.map((membership) => {
                    const active = membership.status === 'active';
                    const branchCount = membership.branches.length;
                    const disabled = !active || setContext.isPending;
                    return (
                        <Pressable
                            key={membership.id}
                            // Status suffix keeps testIDs unique when the same organisation
                            // appears twice (an active membership plus a pending invitation).
                            testID={
                                active
                                    ? `organisation-${membership.organisation.slug}`
                                    : `organisation-${membership.organisation.slug}-${membership.status}`
                            }
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={t('auth:organisationPicker.openLabel', {
                                organisation: membership.organisation.name,
                            })}
                            accessibilityState={{ disabled }}
                            disabled={disabled}
                            onPress={() => {
                                choose(membership);
                            }}
                            className={cx(
                                'min-h-touch flex-row items-center gap-3 rounded-2xl border border-stroke bg-surface-raised px-4 py-3.5',
                                disabled ? 'opacity-60' : 'hover:border-stroke-strong',
                            )}
                        >
                            {/* The name keeps the whole row; roles and status wrap under it.
                                    Beside it, three chips left the name no width at all. */}
                            <View className="min-w-0 flex-1 flex-col gap-1.5">
                                <View className="flex-col">
                                    <Text variant="bodyStrong">{membership.organisation.name}</Text>
                                    <Text variant="caption" tone="secondary">
                                        {branchCount === 0
                                            ? t('auth:organisationPicker.noBranches')
                                            : t('auth:organisationPicker.branchCount', {
                                                  count: branchCount,
                                              })}
                                    </Text>
                                </View>
                                <Inline space="xs" wrap>
                                    {membership.roles.map((role) => (
                                        <Badge
                                            key={role.id}
                                            testID={`organisation-${membership.organisation.slug}-role-${role.key}`}
                                            tone="neutral"
                                            // The role as the invitations word it ("Owner",
                                            // "Manager"); one the catalogue does not know
                                            // keeps the name the server sent.
                                            label={t(`invitations:invite.role.${role.key}`, {
                                                defaultValue: role.name,
                                            })}
                                        />
                                    ))}
                                    <Badge
                                        testID={`organisation-${membership.organisation.slug}-status`}
                                        tone={STATUS_TONE[membership.status]}
                                        label={membership.status}
                                    />
                                </Inline>
                            </View>
                            {active ? (
                                <Icon name="chevronForward" className="text-content-secondary" />
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>
        </View>
    );
}
