import type { PlatformKitchenOwner } from '@healthy360/api-client/contracts';
import { Button, Callout, Dialog, TextInputField, useToast } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import {
    useInviteOwnerMutation,
    useReactivateKitchenMutation,
    useRevokeOwnerMutation,
    useSuspendKitchenMutation,
} from '../../data/platform-admin-hooks.ts';

/**
 * The four things the platform does to a kitchen, each as the desk's card dialog (Platform admin
 * canvas, 2026-11-23). Opened from a row's ⋯ menu and from the kitchen's pop-up alike, so each one
 * carries its own mutation and toast.
 *
 * The bodies are not "are you sure" — they state the consequence: what leaves the marketplace,
 * what the kitchen's staff keep, and, for the last owner, that nobody will be able to run it.
 * Ending the last membership is a warning and not a block: the API allows it deliberately, and
 * refusing here would put the client in disagreement with the server about what is legal.
 *
 * `lockVersion` travels from the record on screen: if someone changed the kitchen meanwhile, the
 * write is refused with a conflict rather than applied to a version nobody looked at.
 */

export interface KitchenTarget {
    readonly slug: string;
    readonly name: string;
    readonly lockVersion: number;
}

function Failure({ message, testID }: { readonly message: string; readonly testID: string }) {
    return <Callout testID={testID} role="alert" tone="danger" icon="warning" title={message} />;
}

export function SuspendKitchenDialog({
    kitchen,
    onClose,
}: {
    readonly kitchen: KitchenTarget;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const suspend = useSuspendKitchenMutation();
    const [reason, setReason] = useState('');
    const failure = toFailure(suspend.error);

    return (
        <Dialog
            open
            look="card"
            onClose={onClose}
            testID="platform-admin-suspend-dialog"
            title={t('platformAdmin:lifecycle.suspendTitle', { name: kitchen.name })}
            description={t('platformAdmin:lifecycle.suspendBody')}
            actions={
                <>
                    <Button
                        testID="platform-admin-suspend-cancel"
                        variant="quiet"
                        label={t('platformAdmin:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-admin-suspend-confirm"
                        variant="danger"
                        label={t('platformAdmin:lifecycle.suspendConfirm')}
                        loading={suspend.isPending}
                        onPress={() => {
                            suspend.mutate(
                                {
                                    kitchen: kitchen.slug,
                                    lockVersion: kitchen.lockVersion,
                                    ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
                                },
                                {
                                    onSuccess: () => {
                                        onClose();
                                        toast.show({
                                            testID: 'platform-admin-suspended-toast',
                                            tone: 'success',
                                            message: t('platformAdmin:lifecycle.suspended', {
                                                name: kitchen.name,
                                            }),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                <TextInputField
                    testID="platform-admin-suspend-reason"
                    id="platform-admin-suspend-reason"
                    size="sm"
                    label={t('platformAdmin:lifecycle.suspendReasonLabel')}
                    placeholder={t('platformAdmin:lifecycle.suspendReasonPlaceholder')}
                    hint={t('platformAdmin:lifecycle.suspendReasonHint')}
                    value={reason}
                    onChangeText={setReason}
                    multiline
                />
                {failure === null ? null : (
                    <Failure testID="platform-admin-suspend-failure" message={failure.message} />
                )}
            </View>
        </Dialog>
    );
}

export function ReactivateKitchenDialog({
    kitchen,
    onClose,
}: {
    readonly kitchen: KitchenTarget;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const reactivate = useReactivateKitchenMutation();
    const failure = toFailure(reactivate.error);

    return (
        <Dialog
            open
            look="card"
            onClose={onClose}
            testID="platform-admin-reactivate-dialog"
            title={t('platformAdmin:lifecycle.reactivateTitle', { name: kitchen.name })}
            description={t('platformAdmin:lifecycle.reactivateBody')}
            actions={
                <>
                    <Button
                        testID="platform-admin-reactivate-cancel"
                        variant="quiet"
                        label={t('platformAdmin:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-admin-reactivate-confirm"
                        label={t('platformAdmin:lifecycle.reactivateConfirm')}
                        loading={reactivate.isPending}
                        onPress={() => {
                            reactivate.mutate(
                                { kitchen: kitchen.slug, lockVersion: kitchen.lockVersion },
                                {
                                    onSuccess: () => {
                                        onClose();
                                        toast.show({
                                            testID: 'platform-admin-reactivated-toast',
                                            tone: 'success',
                                            message: t('platformAdmin:lifecycle.reactivated', {
                                                name: kitchen.name,
                                            }),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            {failure === null ? null : (
                <Failure testID="platform-admin-reactivate-failure" message={failure.message} />
            )}
        </Dialog>
    );
}

export function EndMembershipDialog({
    kitchen,
    owner,
    lastOwner,
    onClose,
}: {
    readonly kitchen: KitchenTarget;
    readonly owner: PlatformKitchenOwner;
    readonly lastOwner: boolean;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const revoke = useRevokeOwnerMutation();
    const failure = toFailure(revoke.error);

    return (
        <Dialog
            open
            look="card"
            onClose={onClose}
            testID="platform-admin-revoke-dialog"
            title={t('platformAdmin:owners.revokeTitle')}
            description={t('platformAdmin:owners.revokeBody', {
                name: owner.name ?? owner.email,
                kitchen: kitchen.name,
            })}
            actions={
                <>
                    <Button
                        testID="platform-admin-revoke-cancel"
                        variant="quiet"
                        label={t('platformAdmin:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-admin-revoke-confirm"
                        variant="danger"
                        label={t('platformAdmin:owners.revokeConfirm')}
                        loading={revoke.isPending}
                        onPress={() => {
                            revoke.mutate(
                                { kitchen: kitchen.slug, membership: owner.membershipId },
                                {
                                    onSuccess: (result) => {
                                        onClose();
                                        toast.show({
                                            testID: 'platform-admin-revoked-toast',
                                            tone:
                                                result.remainingOwners === 0
                                                    ? 'warning'
                                                    : 'success',
                                            message:
                                                result.remainingOwners === 0
                                                    ? t('platformAdmin:owners.revokedLast')
                                                    : t('platformAdmin:owners.revoked'),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                {lastOwner ? (
                    <Callout
                        testID="platform-admin-revoke-last-warning"
                        tone="danger"
                        icon="warning"
                        title={t('platformAdmin:owners.revokeLastWarning')}
                    />
                ) : null}
                {failure === null ? null : (
                    <Failure testID="platform-admin-revoke-failure" message={failure.message} />
                )}
            </View>
        </Dialog>
    );
}

export function InviteOwnerDialog({
    kitchen,
    onClose,
}: {
    readonly kitchen: KitchenTarget;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const toast = useToast();
    const invite = useInviteOwnerMutation();
    const [email, setEmail] = useState('');
    const [name, setName] = useState('');
    const [message, setMessage] = useState('');
    const failure = toFailure(invite.error);
    const emailError =
        failure?.code === 'validation.failed' ? failure.fields.email?.[0] : undefined;

    return (
        <Dialog
            open
            look="card"
            onClose={onClose}
            testID="platform-admin-invite-dialog"
            title={t('platformAdmin:invite.dialogTitle', { name: kitchen.name })}
            actions={
                <>
                    <Button
                        testID="platform-admin-invite-cancel"
                        variant="quiet"
                        label={t('platformAdmin:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID="platform-admin-invite-submit"
                        label={t('platformAdmin:invite.submit')}
                        disabled={email.trim() === ''}
                        loading={invite.isPending}
                        onPress={() => {
                            invite.mutate(
                                {
                                    kitchen: kitchen.slug,
                                    email: email.trim(),
                                    ...(name.trim() === '' ? {} : { name: name.trim() }),
                                    ...(message.trim() === '' ? {} : { message: message.trim() }),
                                },
                                {
                                    onSuccess: (result) => {
                                        onClose();
                                        toast.show({
                                            testID: 'platform-admin-invited-toast',
                                            tone: result.mailed ? 'success' : 'warning',
                                            message: result.mailed
                                                ? t('platformAdmin:invite.sent', {
                                                      email: result.email,
                                                      date: formatter.formatDate(result.expiresAt),
                                                  })
                                                : t('platformAdmin:invite.sentNotMailed', {
                                                      email: result.email,
                                                  }),
                                        });
                                    },
                                },
                            );
                        }}
                    />
                </>
            }
        >
            <View className="flex-col gap-3.5">
                <TextInputField
                    testID="platform-admin-invite-email"
                    id="platform-admin-invite-email"
                    size="sm"
                    label={t('platformAdmin:invite.emailLabel')}
                    placeholder={t('platformAdmin:invite.emailPlaceholder')}
                    hint={t('platformAdmin:invite.emailHint')}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    required
                    {...(emailError === undefined ? {} : { error: emailError })}
                />
                <TextInputField
                    testID="platform-admin-invite-name"
                    id="platform-admin-invite-name"
                    size="sm"
                    label={t('platformAdmin:invite.nameLabel')}
                    placeholder={t('platformAdmin:invite.namePlaceholder')}
                    hint={t('platformAdmin:invite.nameHint')}
                    value={name}
                    onChangeText={setName}
                />
                <TextInputField
                    testID="platform-admin-invite-message"
                    id="platform-admin-invite-message"
                    size="sm"
                    label={t('platformAdmin:invite.messageLabel')}
                    placeholder={t('platformAdmin:invite.messagePlaceholder')}
                    hint={t('platformAdmin:invite.messageHint')}
                    value={message}
                    onChangeText={setMessage}
                    multiline
                />
                {failure === null || emailError !== undefined ? null : (
                    <Failure testID="platform-admin-invite-failure" message={failure.message} />
                )}
            </View>
        </Dialog>
    );
}
