import type { MeResponse } from '@healthy360/api-client';

export interface AccountIdentity {
    /** The display name; empty when the session has none yet. */
    readonly name: string;
    /** "Owner · Main kitchen" — the role, then the branch or else the organisation. */
    readonly detail: string | undefined;
}

/**
 * Who the rail's avatar card says is signed in: the display name, and the role and place of the
 * membership the session is working in. Only what `me()` says — a missing role or branch is left
 * out rather than guessed.
 */
export function accountIdentity(me: MeResponse | null): AccountIdentity {
    if (me === null) return { name: '', detail: undefined };
    const name = me.profile.displayName.trim();
    const context = me.activeContext;
    const membership =
        context === null
            ? undefined
            : me.memberships.find((candidate) => candidate.id === context.membershipId);
    const role = membership?.roles[0]?.name;
    const branch =
        context?.branchId === null || context?.branchId === undefined
            ? undefined
            : membership?.branches.find((candidate) => candidate.id === context.branchId)?.name;
    const place = branch ?? membership?.organisation.name;
    const parts = [role, place].filter(
        (part): part is string => part !== undefined && part.trim() !== '',
    );
    return { name, detail: parts.length === 0 ? undefined : parts.join(' · ') };
}
