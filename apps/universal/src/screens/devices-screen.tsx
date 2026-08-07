import { isValidationFailure } from '@healthy360/api-client';
import {
    Badge,
    Button,
    Card,
    Dialog,
    EmptyState,
    ErrorState,
    Heading,
    Icon,
    ListItem,
    PasswordInput,
    Skeleton,
    Stack,
    Text,
    useToast,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { Device, DeviceId } from '@healthy360/domain-types';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useConfirmPasswordMutation,
    useDevicesQuery,
    useRevokeDeviceMutation,
} from '../data/hooks.ts';

const PLATFORM_KEY: Readonly<Record<Device['platform'], string>> = {
    ios: 'auth:devices.platform.ios',
    android: 'auth:devices.platform.android',
    web: 'auth:devices.platform.web',
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

    return (
        <Stack testID="devices-screen" space="lg">
            <Stack space="xs">
                <Heading level={1} testID="devices-title">
                    {t('auth:devices.title')}
                </Heading>
                <Text tone="secondary">{t('auth:devices.subtitle')}</Text>
            </Stack>

            {devices.isPending ? (
                <Card padding="md">
                    <Stack space="sm">
                        <Skeleton testID="devices-skeleton-1" heightClassName="h-6" />
                        <Skeleton testID="devices-skeleton-2" heightClassName="h-6" />
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

            {devices.data !== undefined && devices.data.length > 0 ? (
                <Card padding="sm">
                    <Stack space="xs">
                        {devices.data.map((device) => (
                            <ListItem
                                key={device.id}
                                testID={`device-${device.id}`}
                                title={device.name}
                                description={`${t(PLATFORM_KEY[device.platform])} · ${
                                    device.lastUsedAt === null
                                        ? t('auth:devices.neverUsed')
                                        : t('auth:devices.lastUsed', {
                                              when: formatter.formatRelativeTime(device.lastUsedAt),
                                          })
                                }`}
                                leading={<Icon name="device" />}
                                trailing={
                                    device.isCurrent ? (
                                        <Badge
                                            testID={`device-${device.id}-current`}
                                            tone="success"
                                            label={t('auth:devices.current')}
                                        />
                                    ) : (
                                        <Button
                                            testID={`device-${device.id}-revoke`}
                                            variant="danger"
                                            size="sm"
                                            label={t('auth:devices.revoke')}
                                            accessibilityLabel={t('auth:devices.revokeLabel', {
                                                device: device.name,
                                            })}
                                            loading={revoke.isPending}
                                            onPress={() => {
                                                setPendingDevice(device);
                                            }}
                                        />
                                    )
                                }
                            />
                        ))}
                    </Stack>
                </Card>
            ) : null}

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
        </Stack>
    );
}
