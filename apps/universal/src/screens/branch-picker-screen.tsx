import {
    Card,
    EmptyState,
    ErrorState,
    Heading,
    ListItem,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { Branch } from '@healthy360/domain-types';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useSettledCondition } from '../access/use-settled-condition.ts';
import { toFailure, useSetContextMutation } from '../data/hooks.ts';
import { useSession } from '../session/session-provider.tsx';

/**
 * Branch picker.
 *
 * Only reachable when the active membership genuinely spans more than one site. With zero or one
 * branch the server has already applied the answer, so this screen redirects straight to the
 * workspace rather than presenting a choice that has already been made.
 *
 * Branches are grouped under their organisation heading — with two clinics in the picker, "Hamra"
 * on its own is ambiguous.
 */
export function BranchPickerScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { me, isRefreshing } = useSession();
    const setContext = useSetContextMutation();

    const context = me?.activeContext ?? null;
    const membership = me?.memberships.find((candidate) => candidate.id === context?.membershipId);
    const failure = toFailure(setContext.error);
    const missingContextSettled = useSettledCondition(
        me !== null && (context === null || membership === undefined),
    );

    if (me === null) {
        return (
            <Stack testID="branch-picker-screen" space="md">
                <Spinner size="large" showLabel />
            </Stack>
        );
    }

    if (context === null || membership === undefined) {
        // Immediately after choosing an organisation this screen can mount one frame before the
        // session context re-renders with the fresh cache (TanStack notifications are batched;
        // navigation renders synchronously). Hold while the session refreshes and until the
        // missing context has survived one tick; only a settled "no context" genuinely belongs
        // back at the organisation picker.
        if (isRefreshing || !missingContextSettled) {
            return (
                <Stack testID="branch-picker-screen" space="md">
                    <Spinner size="large" showLabel />
                </Stack>
            );
        }
        return <Redirect href="/select-organisation" />;
    }

    const branches = membership.branches;

    if (branches.length <= 1 || context.branchId !== null) {
        return <Redirect href="/workspace" />;
    }

    const choose = (branch: Branch) => {
        setContext.mutate(
            { organisationId: membership.organisation.id, branchId: branch.id },
            {
                onSuccess: () => {
                    router.replace('/workspace');
                },
            },
        );
    };

    if (branches.length === 0) {
        return (
            <Stack testID="branch-picker-screen" space="lg">
                <EmptyState testID="branch-picker-empty" title={t('auth:branchPicker.empty')} />
            </Stack>
        );
    }

    return (
        <Stack testID="branch-picker-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="branch-picker-title">
                    {t('auth:branchPicker.title')}
                </Heading>
                <Text tone="secondary">
                    {t('auth:branchPicker.subtitle', {
                        organisation: membership.organisation.name,
                    })}
                </Text>
            </Stack>

            {failure === null ? null : (
                <ErrorState testID="branch-picker-error" failure={failure} />
            )}

            <Card
                padding="sm"
                title={t('auth:branchPicker.groupLabel', {
                    organisation: membership.organisation.name,
                })}
            >
                <Stack space="xs">
                    {branches.map((branch) => (
                        <ListItem
                            key={branch.id}
                            testID={`branch-${branch.code}`}
                            title={branch.name}
                            description={`${branch.code} · ${branch.timeZone}`}
                            accessibilityLabel={t('auth:branchPicker.openLabel', {
                                branch: branch.name,
                            })}
                            chevron
                            disabled={setContext.isPending}
                            onPress={() => {
                                choose(branch);
                            }}
                        />
                    ))}
                </Stack>
            </Card>
        </Stack>
    );
}
