import type { ApiFailure, MeResponse } from '@healthy360/api-client';
import type { AccessBranch, AccessOrganisation, AccessState } from '@healthy360/permissions';
import type { AppMode, Membership, SessionState } from '@healthy360/domain-types';

/**
 * The client session lifecycle.
 *
 * ```
 * restoring ──► anonymous
 *           └─► authenticated ──► contextPending ──► ready
 * ```
 *
 * `authenticated` is the state where a session exists but the account is not yet usable — in
 * Phase 1 that means an unconfirmed email address. `contextPending` is "signed in, verified, but
 * the server has not confirmed an organisation context yet"; `ready` is the only state a workspace
 * screen may render in.
 *
 * The whole thing is a pure function of four inputs, so it is unit-testable without React, without
 * a query client and without a repository.
 */
export const SESSION_PHASES = [
    'restoring',
    'anonymous',
    'authenticated',
    'contextPending',
    'ready',
] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

export interface SessionMachineInput {
    /** False until `createRepositories` has resolved — nothing can be known before that. */
    readonly repositoriesReady: boolean;
    /** A persisted token was found, so a restore attempt is worth making. */
    readonly hasToken: boolean;
    readonly me: MeResponse | null;
    readonly failure: ApiFailure | null;
}

/**
 * `auth.unauthenticated` is the only failure that means "you are signed out". Anything else — a
 * dead network, a 500 — must **not** silently sign the user out, or a flaky connection becomes an
 * involuntary logout. Those keep the previous `me` if there is one and otherwise stay `restoring`
 * so the splash remains and the query can retry.
 */
export function resolveSessionPhase(input: SessionMachineInput): SessionPhase {
    if (!input.repositoriesReady) return 'restoring';
    if (!input.hasToken && input.me === null) return 'anonymous';

    if (input.me === null) {
        return input.failure?.code === 'auth.unauthenticated' ? 'anonymous' : 'restoring';
    }

    if (input.me.user.emailVerifiedAt === null) return 'authenticated';
    if (input.me.activeContext === null) return 'contextPending';
    return 'ready';
}

/** The three-state view the permission kernel takes of a session. */
export function toKernelSessionState(phase: SessionPhase): SessionState {
    if (phase === 'restoring') return 'restoring';
    if (phase === 'anonymous') return 'anonymous';
    return 'authenticated';
}

/**
 * A membership is branch-scoped when it lists more than one branch: with exactly one there is
 * nothing to choose and the server applies it, so forcing a picker would be a dead screen.
 */
export function membershipRequiresBranchSelection(membership: Membership): boolean {
    return membership.branches.length > 1;
}

export interface BuildAccessStateInput {
    readonly mode: AppMode;
    readonly phase: SessionPhase;
    readonly me: MeResponse | null;
}

/**
 * Projects the session onto the guard kernel's `AccessState`.
 *
 * Permissions and entitlements come from `activeContext` and nowhere else: they are whatever the
 * *server* said this (user × organisation × branch) may do. Deriving them on the client from roles
 * would be a second, weaker authorisation model — exactly what plan §10 warns against.
 */
export function buildAccessState({ mode, phase, me }: BuildAccessStateInput): AccessState {
    const context = me?.activeContext ?? null;

    const membership =
        context?.membershipId == null
            ? undefined
            : me?.memberships.find((candidate) => candidate.id === context.membershipId);

    const organisation: AccessOrganisation | undefined =
        context?.organisationId == null || membership === undefined
            ? undefined
            : {
                  id: context.organisationId,
                  membershipId: membership.id,
                  membershipStatus: membership.status,
                  requiresBranchSelection: membershipRequiresBranchSelection(membership),
              };

    const branch: AccessBranch | undefined =
        context?.branchId == null || context.organisationId == null
            ? undefined
            : { id: context.branchId, organisationId: context.organisationId };

    return {
        mode,
        session: toKernelSessionState(phase),
        emailVerified: me?.user.emailVerifiedAt != null,
        organisation,
        branch,
        hasActiveMembership: selectableMemberships(me?.memberships ?? []).length > 0,
        permissions: new Set(context?.permissions ?? []),
        entitlements: new Set(context?.entitlements ?? []),
    };
}

/** Memberships a picker may actually offer. Anything not `active` is listed but not selectable. */
export function selectableMemberships(memberships: readonly Membership[]): readonly Membership[] {
    return memberships.filter((membership) => membership.status === 'active');
}
