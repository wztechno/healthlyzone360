import {
    Badge,
    Button,
    Card,
    EmptyState,
    ErrorState,
    Heading,
    Inline,
    ListItem,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Membership, MembershipStatus } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { appConfig } from '../config.ts';
import { toFailure, useSetContextMutation } from '../data/hooks.ts';
import { selectableMemberships } from '../session/machine.ts';
import { useSession } from '../session/session-provider.tsx';

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
 * Organisation picker.
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
        setContext.mutate(
            { organisationId: membership.organisation.id },
            {
                onSuccess: (context) => {
                    router.replace(context.branchId === null ? '/select-branch' : '/workspace');
                },
            },
        );
    };

    useEffect(() => {
        if (!consumerWithoutOrg || me === null || consumerRedirected.current) return;
        consumerRedirected.current = true;
        router.replace('/customer');
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
                                router.replace('/customer');
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
        <Stack testID="organisation-picker-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="organisation-picker-title">
                    {t('auth:organisationPicker.title')}
                </Heading>
                <Text tone="secondary">{t('auth:organisationPicker.subtitle')}</Text>
            </Stack>

            {failure === null ? null : (
                <ErrorState testID="organisation-picker-error" failure={failure} />
            )}

            <Card padding="sm">
                <Stack space="xs">
                    {memberships.map((membership) => {
                        const active = membership.status === 'active';
                        const branchCount = membership.branches.length;
                        return (
                            <ListItem
                                key={membership.id}
                                // Status suffix keeps testIDs unique when the same organisation
                                // appears twice (an active membership plus a pending invitation).
                                testID={
                                    active
                                        ? `organisation-${membership.organisation.slug}`
                                        : `organisation-${membership.organisation.slug}-${membership.status}`
                                }
                                title={membership.organisation.name}
                                description={
                                    branchCount === 0
                                        ? t('auth:organisationPicker.noBranches')
                                        : t('auth:organisationPicker.branchCount', {
                                              count: branchCount,
                                          })
                                }
                                accessibilityLabel={t('auth:organisationPicker.openLabel', {
                                    organisation: membership.organisation.name,
                                })}
                                disabled={!active || setContext.isPending}
                                chevron={active}
                                trailing={
                                    <Inline space="xs">
                                        {membership.roles.map((role) => (
                                            <Badge
                                                key={role.id}
                                                testID={`organisation-${membership.organisation.slug}-role-${role.key}`}
                                                tone="neutral"
                                                label={role.name}
                                            />
                                        ))}
                                        <Badge
                                            testID={`organisation-${membership.organisation.slug}-status`}
                                            tone={STATUS_TONE[membership.status]}
                                            label={membership.status}
                                        />
                                    </Inline>
                                }
                                {...(active
                                    ? {
                                          onPress: () => {
                                              choose(membership);
                                          },
                                      }
                                    : {})}
                            />
                        );
                    })}
                </Stack>
            </Card>
        </Stack>
    );
}
