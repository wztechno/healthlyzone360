import type {
    ActiveContext,
    BranchId,
    Device,
    DeviceId,
    IsoDateTime,
    Membership,
    OrganisationId,
    Profile,
    SessionUser,
} from '@healthy360/domain-types';

/**
 * A consent the user has not granted at its current version. `GET /api/v1/me` returns these so the
 * client can prompt; the *content* of a consent is fetched separately when a consent screen exists
 * (Phase 1 only surfaces that something is outstanding).
 */
export interface PendingConsent {
    /** `consent_definitions.code`, e.g. `terms_of_service`. */
    readonly code: string;
    readonly version: string;
    /** Blocking consents must be granted before the user may continue. */
    readonly required: boolean;
    readonly publishedAt: IsoDateTime;
}

/** `GET /api/v1/me` — everything a launching client needs in one round trip. */
export interface MeResponse {
    readonly user: SessionUser;
    readonly profile: Profile;
    readonly memberships: readonly Membership[];
    /** `null` until the server has confirmed a context (plan §9 — the client never assumes one). */
    readonly activeContext: ActiveContext | null;
    readonly pendingConsents: readonly PendingConsent[];
}

export interface SessionRepository {
    me(): Promise<MeResponse>;
}

/** `PUT /api/v1/me/context`. The server echoes the context it actually applied. */
export interface SetContextRequest {
    readonly organisationId: OrganisationId;
    readonly branchId?: BranchId | undefined;
}

export interface ContextRepository {
    setContext(request: SetContextRequest): Promise<ActiveContext>;
}

export interface DeviceRepository {
    list(): Promise<readonly Device[]>;
    /** Rejects with `auth.step_up_required` until the password has been re-confirmed. */
    revoke(deviceId: DeviceId): Promise<void>;
}

/**
 * Where the opaque session token lives between calls.
 *
 * Both repository implementations need it for different reasons — the mock uses it to find the
 * session it issued, the 5c API repository will put it in the `Authorization` header — so it is
 * part of the contract rather than an implementation detail of either. The application supplies a
 * platform-appropriate one (SecureStore on native, memory + cookie on web).
 */
export interface SessionTokenStore {
    get(): string | null;
    set(token: string): void;
    clear(): void;
    /**
     * Notify on every `set`/`clear`. Required so React can observe the token reactively
     * (`useSyncExternalStore`) — a plain `get()` during render goes stale the moment a login
     * mutation writes the token, and the session would never advance past anonymous.
     */
    subscribe(listener: () => void): () => void;
}

/** The listener bookkeeping every implementation shares. */
export function createTokenListeners(): {
    subscribe: (listener: () => void) => () => void;
    notify: () => void;
} {
    const listeners = new Set<() => void>();
    return {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        notify: () => {
            for (const listener of listeners) listener();
        },
    };
}

export function createMemoryTokenStore(initial: string | null = null): SessionTokenStore {
    let token = initial;
    const { subscribe, notify } = createTokenListeners();
    return {
        get: () => token,
        set: (next: string) => {
            token = next;
            notify();
        },
        clear: () => {
            token = null;
            notify();
        },
        subscribe,
    };
}
