import { Spinner } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { isPermissionDeniedFailure } from '@healthy360/api-client/contracts';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { toFailure, useLogoutMutation } from '../../../data/hooks.ts';
import {
    useAcceptInvitationMutation,
    useInvitationQuery,
} from '../../../data/invitations-hooks.ts';
import { recordResumeIntent } from '../../marketplace/resume-intent.ts';
import { withReturnTo } from '../../../navigation/return-to.ts';
import { useSession } from '../../../session/session-provider.tsx';
import {
    AuthBadge,
    AuthError,
    AuthLink,
    AuthNote,
    AuthSubmit,
    AuthText,
    AuthTick,
    AuthTitle,
} from '../../../ui/auth-form.tsx';
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
 * ## Signing in comes straight back
 *
 * Sign in, Create an account and Confirm my email address all leave carrying `?returnTo=` for this
 * exact link, token and all — the same return the gate and checkout use. Sign-in finishes on it;
 * registration hands it to `/verify-email`, whose Continue finishes on it. Before this the page left
 * with nothing, and a new owner who had just confirmed their address landed on the shop home with
 * no way back but the email.
 *
 * `recordResumeIntent` is still written as the fallback: if the person wanders off mid-way, the
 * consumer home offers "Continue to …" pointing here.
 *
 * ## The look
 *
 * Drawn in the sign-in boards' frame (`AuthFrame`, set by the route's layout) from the same parts
 * the other ways in use: the badge, the title, the big pill, the quiet link, the tick when done.
 * The facts sit in one soft box, a row each.
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

    /** Leave for one of the ways in, carrying this page — token and all — as the return. */
    const leaveFor = (destination: '/sign-in' | '/register' | '/verify-email') => {
        recordResumeIntent({ href: here, labelKey: 'invitations:title' });
        router.push(withReturnTo(destination, here) as never);
    };

    if (view.kind === 'loading') {
        return (
            <View testID="invitation-screen" className="items-center py-10">
                <Spinner
                    testID="invitation-loading"
                    size="large"
                    showLabel
                    label={t('invitations:loading')}
                />
            </View>
        );
    }

    if (view.kind === 'not-found') {
        return (
            <View testID="invitation-screen" className="flex-col gap-3.5">
                <AuthBadge icon="warning" tone="warning" />
                <View testID="invitation-not-found" role="alert">
                    <AuthTitle>{t('invitations:notFound.title')}</AuthTitle>
                </View>
                <AuthText>{t('invitations:notFound.body')}</AuthText>
                <View className="mt-2">
                    <AuthSubmit
                        testID="invitation-retry"
                        label={t('invitations:notFound.retry')}
                        busy={query.isFetching}
                        onPress={() => {
                            void query.refetch();
                        }}
                    />
                </View>
            </View>
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
    const lapsed = view.kind === 'expired' || view.kind === 'revoked';
    const troubled = lapsed || view.kind === 'mismatch';

    if (view.kind === 'accepted' && view.membershipCreated) {
        return (
            <View testID="invitation-screen" className="flex-col items-center gap-3.5">
                <AuthTick />
                <View testID="invitation-accepted" role="status">
                    <AuthTitle centred testID="invitation-heading">
                        {acceptedNow === null
                            ? t('invitations:accepted.alreadyTitle')
                            : t('invitations:accepted.title')}
                    </AuthTitle>
                </View>
                <AuthText centred>
                    {acceptedNow === null
                        ? t('invitations:accepted.alreadyBody')
                        : t('invitations:accepted.body', { organisation })}
                </AuthText>
                <View className="mt-2 w-full">
                    <AuthSubmit
                        testID="invitation-open-workspace"
                        label={
                            invitation.organisation.type === 'corporate_customer'
                                ? t('invitations:accepted.openBusinessWorkspace')
                                : t('invitations:accepted.openWorkspace')
                        }
                        onPress={() => {
                            // A business buyer's people land on the buyer workspace; a kitchen's
                            // on the kitchen.
                            router.push(
                                (invitation.organisation.type === 'corporate_customer'
                                    ? '/corporate'
                                    : '/kitchen') as never,
                            );
                        }}
                    />
                </View>
            </View>
        );
    }

    return (
        <View testID="invitation-screen" className="flex-col gap-3.5">
            <AuthBadge icon={troubled ? 'warning' : 'send'} tone={troubled ? 'warning' : 'brand'} />
            <AuthTitle testID="invitation-heading">
                {t('invitations:invite.heading', { organisation })}
            </AuthTitle>

            {/* The facts. Drawn in every state on this pane, because each is about this invitation. */}
            <View
                testID="invitation-facts"
                className="rounded-2xl border border-stroke bg-surface-raised px-4 py-1.5"
            >
                <Fact label={t('invitations:invite.roleLabel')}>
                    <View className="rounded-full bg-surface-brand-subtle px-2.5 py-1">
                        <RNText
                            testID="invitation-role"
                            className="text-xs font-bold text-content-on-brand-subtle"
                        >
                            {roleLabel}
                        </RNText>
                    </View>
                </Fact>
                <Fact label={t('invitations:invite.sentToLabel')} divided>
                    {/* The masked address, exactly as the server sent it. There is no unmasked
                        form on this surface to render by mistake. */}
                    <FactValue testID="invitation-email">{invitation.emailMasked}</FactValue>
                </Fact>
                <Fact label={t('invitations:invite.expiresLabel')} divided>
                    <FactValue testID="invitation-expiry">{expiryDate}</FactValue>
                </Fact>
            </View>

            {lapsed ? null : (
                <RNText
                    testID="invitation-countdown"
                    className="text-xs font-medium text-content-secondary text-start"
                >
                    {remaining === 0
                        ? t('invitations:invite.expiresToday')
                        : t('invitations:invite.expiresInDays', { count: remaining })}
                </RNText>
            )}

            {view.kind === 'signed-out' ? (
                <View testID="invitation-signed-out" className="mt-2 flex-col gap-1">
                    <AuthSubmit
                        testID="invitation-sign-in"
                        label={t('invitations:signedOut.signIn')}
                        onPress={() => {
                            leaveFor('/sign-in');
                        }}
                    />
                    <AuthLink
                        testID="invitation-register"
                        label={t('invitations:signedOut.register')}
                        onPress={() => {
                            leaveFor('/register');
                        }}
                    />
                </View>
            ) : null}

            {view.kind === 'unverified' ? (
                <View className="flex-col gap-3.5">
                    <AuthNote testID="invitation-unverified" tone="warning">
                        {t('invitations:unverified.title')}
                    </AuthNote>
                    <AuthSubmit
                        testID="invitation-verify"
                        label={t('invitations:unverified.verify')}
                        onPress={() => {
                            leaveFor('/verify-email');
                        }}
                    />
                </View>
            ) : null}

            {view.kind === 'mismatch' ? (
                <View className="flex-col gap-3.5">
                    <AuthError
                        testID="invitation-mismatch"
                        message={t('invitations:mismatch.body', {
                            current: view.currentEmail,
                            invited: invitation.emailMasked,
                        })}
                    />
                    <AuthSubmit
                        testID="invitation-switch-account"
                        label={t('invitations:mismatch.switch')}
                        busy={logout.isPending}
                        onPress={() => {
                            // Sign out, then sign in as the invited person and come straight back.
                            logout.mutate(undefined, {
                                onSuccess: () => {
                                    leaveFor('/sign-in');
                                },
                            });
                        }}
                    />
                </View>
            ) : null}

            {view.kind === 'acceptable' ? (
                <View className="mt-2 flex-col gap-3.5">
                    {/* A refusal that is *not* the identity mismatch — a lapsed token, a revoked
                        one — is shown here rather than swallowed. The mismatch has its own state
                        above, reached through `serverRefusedIdentity`. */}
                    {acceptFailure !== null && !isPermissionDeniedFailure(acceptFailure) ? (
                        <AuthError
                            testID="invitation-accept-error"
                            message={acceptFailure.message}
                        />
                    ) : null}
                    <AuthSubmit
                        testID="invitation-accept"
                        label={
                            accept.isPending
                                ? t('invitations:accept.pending')
                                : t('invitations:accept.action')
                        }
                        busy={accept.isPending}
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
                </View>
            ) : null}

            {view.kind === 'accepted' ? (
                <AuthNote testID="invitation-accepted" tone="warning">
                    {t('invitations:accepted.noMembershipBody')}
                </AuthNote>
            ) : null}

            {view.kind === 'expired' ? (
                <AuthError
                    testID="invitation-expired"
                    message={t('invitations:expired.body', { date: expiryDate, organisation })}
                />
            ) : null}

            {view.kind === 'revoked' ? (
                <AuthError
                    testID="invitation-revoked"
                    message={t('invitations:revoked.body', { organisation })}
                />
            ) : null}
        </View>
    );
}

/** One row of the facts box: its label at the start, its value at the end. */
function Fact({
    label,
    divided = false,
    children,
}: {
    readonly label: string;
    readonly divided?: boolean;
    readonly children: ReactNode;
}) {
    return (
        <View
            className={
                divided
                    ? 'min-h-touch flex-row items-center justify-between gap-3 border-t border-stroke-subtle py-2'
                    : 'min-h-touch flex-row items-center justify-between gap-3 py-2'
            }
        >
            <RNText className="text-sm font-medium text-content-secondary">{label}</RNText>
            {children}
        </View>
    );
}

function FactValue({ testID, children }: { readonly testID: string; readonly children: string }) {
    return (
        <RNText
            testID={testID}
            className="min-w-0 shrink text-sm font-semibold text-content-primary text-end"
        >
            {children}
        </RNText>
    );
}
