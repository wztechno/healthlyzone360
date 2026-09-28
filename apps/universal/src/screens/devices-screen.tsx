import { isValidationFailure } from '@healthy360/api-client';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    ListItem,
    PasswordInput,
    Skeleton,
    Stack,
    useToast,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { Device, DeviceId } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useConfirmPasswordMutation,
    useDevicesQuery,
    useRevokeDeviceMutation,
} from '../data/hooks.ts';
import { MarkTile, SettingsPage } from '../ui/settings-page.tsx';

const PLATFORM_KEY: Readonly<Record<Device['platform'], string>> = {
    ios: 'auth:devices.platform.ios',
    android: 'auth:devices.platform.android',
    web: 'auth:devices.platform.web',
};

/** A browser is a screen; an app session is a phone, as far as the platform can say. */
const PLATFORM_MARK: Readonly<Record<Device['platform'], IconName>> = {
    ios: 'smartphone',
    android: 'smartphone',
    web: 'monitor',
};

/**
 * Device and session management.
 *
 * The interesting part is the **step-up flow**. Revocation is a sensitive action, so the server may
 * answer `auth.step_up_required` (HTTP 403, plan §13). Rather than treating that as an error, the
 * screen:
 *
 * 1. remembers which device was being revoked,
 * 2. opens a password-confirmation dialog,
 * 3. confirms the password, and
 * 4. **retries the original revocation automatically**.
 *
 * Making the user find and press "Revoke" again after confirming their password would be a
 * self-inflicted usability bug — the intent was already expressed.
 */
export function DevicesScreen() {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const router = useRouter();

    const devices = useDevicesQuery();
    const revoke = useRevokeDeviceMutation();
    const confirmPassword = useConfirmPasswordMutation();

    const [pendingDevice, setPendingDevice] = useState<Device | null>(null);
    const [stepUpDevice, setStepUpDevice] = useState<Device | null>(null);
    const [password, setPassword] = useState('');
    const [stepUpError, setStepUpError] = useState<string | null>(null);

    const performRevoke = useCallback(
        (device: Device) => {
            revoke.mutate(device.id as DeviceId, {
                onSuccess: () => {
                    toast.show({
                        message: t('auth:devices.revoked', { device: device.name }),
                        tone: 'success',
                        testID: 'device-revoked-toast',
                    });
                },
                onError: (error: unknown) => {
                    const failure = toFailure(error);
                    if (failure?.code === 'auth.step_up_required') {
                        setStepUpDevice(device);
                        setPassword('');
                        setStepUpError(null);
                        return;
                    }
                    toast.show({
                        message: failure?.message ?? t('errors:generic.body'),
                        tone: 'danger',
                        testID: 'device-revoke-error-toast',
                    });
                },
            });
        },
        [revoke, t, toast],
    );

    const submitStepUp = useCallback(() => {
        const device = stepUpDevice;
        if (device === null) return;

        setStepUpError(null);
        confirmPassword.mutate(
            { password },
            {
                onSuccess: () => {
                    setStepUpDevice(null);
                    setPassword('');
                    performRevoke(device);
                },
                onError: (error: unknown) => {
                    const failure = toFailure(error);
                    setStepUpError(
                        failure !== null && isValidationFailure(failure)
                            ? (failure.fields['password']?.[0] ?? failure.message)
                            : (failure?.message ?? null),
                    );
                },
            },
        );
    }, [confirmPassword, password, performRevoke, stepUpDevice]);

    const listFailure = toFailure(devices.error);
    const current = devices.data?.find((device) => device.isCurrent);
    const others = devices.data?.filter((device) => !device.isCurrent) ?? [];

    const describe = (device: Device) =>
        `${t(PLATFORM_KEY[device.platform])} · ${
            device.lastUsedAt === null
                ? t('auth:devices.neverUsed')
                : t('auth:devices.lastUsed', {
                      when: formatter.formatRelativeTime(device.lastUsedAt),
                  })
        }`;

    return (
        <SettingsPage
            testID="devices-screen"
            titleTestID="devices-title"
            title={t('auth:devices.title')}
            subtitle={t('auth:devices.subtitle')}
        >
            {devices.isPending ? (
                <Card padding="md">
                    <Stack space="sm">
                        <Skeleton testID="devices-skeleton-1" heightClassName="h-10" />
                        <Skeleton testID="devices-skeleton-2" heightClassName="h-10" />
                    </Stack>
                </Card>
            ) : null}

            {listFailure === null ? null : (
                <ErrorState
                    testID="devices-error"
                    failure={listFailure}
                    onRetry={() => {
                        void devices.refetch();
                    }}
                    retrying={devices.isFetching}
                />
            )}

            {devices.data !== undefined && devices.data.length === 0 ? (
                <EmptyState
                    testID="devices-empty"
                    title={t('auth:devices.empty')}
                    body={t('auth:devices.emptyBody')}
                />
            ) : null}

            {/*
             * The session in hand first, on its own. It is the one row with nothing to do here —
             * signing out is how it ends — and set apart it stops reading as the first entry of a
             * list the reader is meant to prune.
             */}
            {current === undefined ? null : (
                <Card title={t('auth:devices.thisSession')} padding="sm">
                    <ListItem
                        testID={`device-${current.id}`}
                        title={current.name}
                        description={describe(current)}
                        leading={<MarkTile name={PLATFORM_MARK[current.platform]} />}
                        trailing={
                            <Badge
                                testID={`device-${current.id}-current`}
                                tone="success"
                                label={t('auth:devices.current')}
                            />
                        }
                    />
                </Card>
            )}

            {devices.data !== undefined && devices.data.length > 0 ? (
                <Card
                    title={t('auth:devices.otherSessions', { count: others.length })}
                    padding="sm"
                    testID="devices-others"
                >
                    {others.length === 0 ? (
                        <EmptyState
                            testID="devices-others-empty"
                            title={t('auth:devices.empty')}
                            body={t('auth:devices.emptyBody')}
                        />
                    ) : (
                        others.map((device) => (
                            <ListItem
                                key={device.id}
                                testID={`device-${device.id}`}
                                title={device.name}
                                description={describe(device)}
                                leading={<MarkTile name={PLATFORM_MARK[device.platform]} />}
                                trailing={
                                    <Button
                                        testID={`device-${device.id}-revoke`}
                                        variant="secondary"
                                        size="sm"
                                        label={t('auth:devices.revoke')}
                                        accessibilityLabel={t('auth:devices.revokeLabel', {
                                            device: device.name,
                                        })}
                                        // Only the row being revoked spins, not every row at once.
                                        loading={revoke.isPending && revoke.variables === device.id}
                                        onPress={() => {
                                            setPendingDevice(device);
                                        }}
                                    />
                                }
                            />
                        ))
                    )}
                </Card>
            ) : null}

            {/*
             * A session nobody recognises takes two steps, and this page is only the first:
             * revoking signs it out, but a password it already knows signs it straight back in. So
             * the note sits under the list it is about, with the second step one press away.
             */}
            {others.length === 0 ? null : (
                <Callout
                    testID="devices-unrecognised"
                    tone="info"
                    title={t('auth:devices.unrecognisedTitle')}
                    body={t('auth:devices.unrecognisedBody')}
                    actions={
                        <Button
                            testID="devices-change-password"
                            variant="secondary"
                            size="sm"
                            label={t('auth:profile.changePassword')}
                            onPress={() => {
                                router.push('/change-password');
                            }}
                        />
                    }
                />
            )}

            <Dialog
                testID="revoke-dialog"
                open={pendingDevice !== null}
                onClose={() => {
                    setPendingDevice(null);
                }}
                title={t('auth:devices.revokeTitle')}
                description={t('auth:devices.revokeBody', {
                    device: pendingDevice?.name ?? '',
                })}
                actions={
                    <>
                        <Button
                            testID="revoke-dialog-cancel"
                            variant="quiet"
                            label={t('common:action.cancel')}
                            onPress={() => {
                                setPendingDevice(null);
                            }}
                        />
                        <Button
                            testID="revoke-dialog-confirm"
                            variant="danger"
                            label={t('auth:devices.revokeConfirm')}
                            loading={revoke.isPending}
                            onPress={() => {
                                const device = pendingDevice;
                                setPendingDevice(null);
                                if (device !== null) performRevoke(device);
                            }}
                        />
                    </>
                }
            />

            <Dialog
                testID="step-up-dialog"
                open={stepUpDevice !== null}
                onClose={() => {
                    setStepUpDevice(null);
                }}
                title={t('auth:stepUp.title')}
                description={t('auth:stepUp.body')}
                actions={
                    <>
                        <Button
                            testID="step-up-cancel"
                            variant="quiet"
                            label={t('common:action.cancel')}
                            onPress={() => {
                                setStepUpDevice(null);
                            }}
                        />
                        <Button
                            testID="step-up-submit"
                            label={t('auth:stepUp.submit')}
                            loading={confirmPassword.isPending}
                            onPress={submitStepUp}
                        />
                    </>
                }
            >
                <PasswordInput
                    testID="step-up-password"
                    id="step-up-password"
                    label={t('auth:stepUp.passwordLabel')}
                    autoComplete="current-password"
                    revealable={false}
                    required
                    value={password}
                    onChangeText={setPassword}
                    {...(stepUpError === null ? {} : { error: stepUpError })}
                />
            </Dialog>
        </SettingsPage>
    );
}
