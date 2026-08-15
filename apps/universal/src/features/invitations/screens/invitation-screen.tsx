import {
    Button,
    Callout,
    Card,
    Heading,
    Inline,
    Spinner,
    Stack,
    Text,
} from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { isPermissionDeniedFailure } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure, useLogoutMutation } from '../../../data/hooks.ts';
import {
    useAcceptInvitationMutation,
    useInvitationQuery,
} from '../../../data/invitations-hooks.ts';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { daysUntil, resolveInvitationView } from '../invitation-state.ts';

/**
 * `/invitations/{token}` — the screen the invitation email links to.
 *
 * ## It renders before it asks for anything
 *
 * The read behind it is anonymous, so the first thing a visitor sees is *what they have been
 * offered* — which organisation, which role, how long they have — and only then a reason to sign
 * in. The opposite order is the one this screen exists to avoid: a sign-in wall in front of an
 * unexplained link is how an invitation gets closed rather than accepted.
 *
 * ## Every terminal state gets a sentence, not a shrug
 *
 * Expired, revoked and already-accepted are all reachable and all say what happened and what to do
 * next. The one thing the screen cannot distinguish is an unknown token from a purged one, because
 * the API deliberately cannot either.
 *
 * ## The identity mismatch is decided twice
 *
 * Once locally, by comparing the signed-in address reduced to the server's mask, which saves a
 * round trip in the ordinary "somebody forwarded me this" case. Once by the server, whose `403` is
 * the authority — two addresses can mask alike, so a local *match* is a hypothesis and a server
 * refusal turns the screen into the mismatch state rather than into an error toast.
 *
 * ## Sign-in leaves a breadcrumb rather than a redirect
 *
 * `recordResumeIntent` is the marketplace's mechanism and the reason it is client-side rather than
 * a `?next=` parameter applies here unchanged. Nothing redirects automatically: the person signs
 * in, and the consumer home offers "Continue to …" pointing back at this exact link, token and all.
 */

export interface InvitationScreenProps {
    readonly token: string | undefined;
}

export function InvitationScreen({ token }: InvitationScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const { me, accessState } = useSession();
    const logout = useLogoutMutation();

    const normalisedToken = token === undefined || token.trim() === '' ? null : token.trim();

    const query = useInvitationQuery(normalisedToken);
    const accept = useAcceptInvitationMutation();

    const [acceptedNow, setAcceptedNow] = useState<{ membershipCreated: boolean } | null>(null);

    const acceptFailure = toFailure(accept.error);

    const view = resolveInvitationView({
        invitation: query.data,
        failure: toFailure(query.error),
        isLoading: normalisedToken !== null && query.isPending,
        session: accessState.session === 'restoring' ? 'restoring' : accessState.session,
        emailVerified: accessState.emailVerified,
        currentEmail: me?.user.email ?? null,
        acceptedNow,
        serverRefusedIdentity: acceptFailure !== null && isPermissionDeniedFailure(acceptFailure),
    });

    const here = normalisedToken === null ? '/invitations' : `/invitations/${normalisedToken}`;

    const goSignIn = (destination: '/sign-in' | '/register') => {
        // The breadcrumb points at *this* page, not at the destination: it records where to come
        // back to, and the token is part of that address.
        recordResumeIntent({ href: here, labelKey: 'invitations:title' });
        router.push(destination as never);
    };

    if (view.kind === 'loading') {
        return (
            <Stack space="lg" testID="invitation-screen">
                <Spinner
                    testID="invitation-loading"
                    size="large"
                    showLabel
                    label={t('invitations:loading')}
                />
            </Stack>
        );
    }

    if (view.kind === 'not-found') {
        return (
            <Stack space="lg" testID="invitation-screen">
                <Callout
                    testID="invitation-not-found"
                    tone="warning"
                    role="alert"
                    title={t('invitations:notFound.title')}
                    body={t('invitations:notFound.body')}
                    actions={
                        <Button
                            testID="invitation-retry"
                            size="sm"
                            variant="secondary"
                            label={t('invitations:notFound.retry')}
                            loading={query.isFetching}
                            onPress={() => {
                                void query.refetch();
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    const { invitation } = view;
    const organisation = invitation.organisation.name;
    const roleLabel = t(`invitations:invite.role.${invitation.roleCode}`, {
        defaultValue: t('invitations:invite.role.unknown', { code: invitation.roleCode }),
    });
    const expiryDate = formatter.formatDate(invitation.expiresAt, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
    const remaining = daysUntil(invitation.expiresAt);

    /** The facts panel. Rendered above every state, because every state is about this invitation. */
    const facts = (
        <Card padding="lg" testID="invitation-facts">
            <Stack space="sm">
                <Heading level={1} testID="invitation-heading">
                    {t('invitations:invite.heading', { organisation })}
                </Heading>
                <Text tone="secondary">{t('invitations:invite.body', { organisation })}</Text>

                <Stack space="xs">
                    <Inline space="sm" wrap>
                        <Text variant="label">{t('invitations:invite.roleLabel')}</Text>
                        <Text testID="invitation-role">{roleLabel}</Text>
                    </Inline>
                    <Inline space="sm" wrap>
                        <Text variant="label">{t('invitations:invite.sentToLabel')}</Text>
                        {/* The masked address, exactly as the server sent it. There is no unmasked
                            form on this surface to render by mistake. */}
                        <Text testID="invitation-email">{invitation.emailMasked}</Text>
                    </Inline>
                    <Inline space="sm" wrap>
                        <Text variant="label">{t('invitations:invite.expiresLabel')}</Text>
                        <Text testID="invitation-expiry">{expiryDate}</Text>
                    </Inline>
                </Stack>

                {view.kind === 'expired' || view.kind === 'revoked' ? null : (
                    <Text tone="secondary" variant="caption" testID="invitation-countdown">
                        {remaining === 0
                            ? t('invitations:invite.expiresToday')
                            : t('invitations:invite.expiresInDays', { count: remaining })}
                    </Text>
                )}
            </Stack>
        </Card>
    );

    return (
        <Stack space="lg" testID="invitation-screen">
            {facts}

            {view.kind === 'signed-out' ? (
                <Callout
                    testID="invitation-signed-out"
                    tone="info"
                    role="status"
                    title={t('invitations:signedOut.title')}
                    body={t('invitations:signedOut.body')}
                    actions={
                        <Stack space="xs">
                            <Inline space="sm" wrap>
                                <Button
                                    testID="invitation-sign-in"
                                    size="sm"
                                    label={t('invitations:signedOut.signIn')}
                                    onPress={() => {
                                        goSignIn('/sign-in');
                                    }}
                                />
                                <Button
                                    testID="invitation-register"
                                    size="sm"
                                    variant="secondary"
                                    label={t('invitations:signedOut.register')}
                                    onPress={() => {
                                        goSignIn('/register');
                                    }}
                                />
                            </Inline>
                            <Text tone="secondary" variant="caption">
                                {t('invitations:signedOut.returnHint')}
                            </Text>
                        </Stack>
                    }
                />
            ) : null}

            {view.kind === 'unverified' ? (
                <Callout
                    testID="invitation-unverified"
                    tone="warning"
                    role="status"
                    title={t('invitations:unverified.title')}
                    body={t('invitations:unverified.body')}
                    actions={
                        <Button
                            testID="invitation-verify"
                            size="sm"
                            label={t('invitations:unverified.verify')}
                            onPress={() => {
                                recordResumeIntent({ href: here, labelKey: 'invitations:title' });
                                router.push('/verify-email' as never);
                            }}
                        />
                    }
                />
            ) : null}

            {view.kind === 'mismatch' ? (
                <Callout
                    testID="invitation-mismatch"
                    tone="warning"
                    role="alert"
                    title={t('invitations:mismatch.title')}
                    body={t('invitations:mismatch.body', {
                        current: view.currentEmail,
                        invited: invitation.emailMasked,
                    })}
                    actions={
                        <Button
                            testID="invitation-switch-account"
                            size="sm"
                            variant="secondary"
                            label={t('invitations:mismatch.switch')}
                            loading={logout.isPending}
                            onPress={() => {
                                /*
                                 * Sign out, then stay on this page. The breadcrumb is recorded
                                 * first so that whichever way the person comes back — straight
                                 * through the sign-in screen, or via the consumer home — the link
                                 * with its token is still one press away.
                                 */
                                recordResumeIntent({ href: here, labelKey: 'invitations:title' });
                                logout.mutate(undefined, {
                                    onSuccess: () => {
                                        router.push('/sign-in' as never);
                                    },
                                });
                            }}
                        />
                    }
                />
            ) : null}

            {view.kind === 'acceptable' ? (
                <Stack space="sm">
                    <Button
                        testID="invitation-accept"
                        label={
                            accept.isPending
                                ? t('invitations:accept.pending')
                                : t('invitations:accept.action')
                        }
                        loading={accept.isPending}
                        onPress={() => {
                            if (normalisedToken === null) return;
                            accept.mutate(normalisedToken, {
                                onSuccess: (result) => {
                                    setAcceptedNow({
                                        membershipCreated: result.membershipCreated,
                                    });
                                },
                            });
                        }}
                    />
                    {/* A refusal that is *not* the identity mismatch — a lapsed token, a revoked
                        one — is shown here rather than swallowed. The mismatch has its own panel
                        above, reached through `serverRefusedIdentity`. */}
                    {acceptFailure !== null && !isPermissionDeniedFailure(acceptFailure) ? (
                        <Callout
                            testID="invitation-accept-error"
                            tone="danger"
                            role="alert"
                            title={t('invitations:notFound.title')}
                            body={acceptFailure.message}
                        />
                    ) : null}
                </Stack>
            ) : null}

            {view.kind === 'accepted' ? (
                <Callout
                    testID="invitation-accepted"
                    tone={view.membershipCreated ? 'success' : 'warning'}
                    role="status"
                    title={
                        view.membershipCreated
                            ? acceptedNow === null
                                ? t('invitations:accepted.alreadyTitle')
                                : t('invitations:accepted.title')
                            : t('invitations:accepted.noMembershipTitle')
                    }
                    body={
                        view.membershipCreated
                            ? acceptedNow === null
                                ? t('invitations:accepted.alreadyBody')
                                : t('invitations:accepted.body', { organisation })
                            : t('invitations:accepted.noMembershipBody')
                    }
                    actions={
                        view.membershipCreated ? (
                            <Button
                                testID="invitation-open-workspace"
                                size="sm"
                                label={t('invitations:accepted.openWorkspace')}
                                onPress={() => {
                                    router.push('/kitchen' as never);
                                }}
                            />
                        ) : undefined
                    }
                />
            ) : null}

            {view.kind === 'expired' ? (
                <Callout
                    testID="invitation-expired"
                    tone="warning"
                    role="alert"
                    title={t('invitations:expired.title')}
                    body={t('invitations:expired.body', { date: expiryDate, organisation })}
                />
            ) : null}

            {view.kind === 'revoked' ? (
                <Callout
                    testID="invitation-revoked"
                    tone="warning"
                    role="alert"
                    title={t('invitations:revoked.title')}
                    body={t('invitations:revoked.body', { organisation })}
                />
            ) : null}
        </Stack>
    );
}
