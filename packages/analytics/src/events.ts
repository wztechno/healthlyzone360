import type { AppMode, RouteArea } from '@healthy360/domain-types';

/**
 * Property values are restricted to primitives on purpose: nothing free-text, nothing nested, and
 * therefore no route by which clinical, financial or personally identifying content can be smuggled
 * into an analytics pipeline (plan §12).
 */
export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsProps = Readonly<Record<string, AnalyticsPrimitive>>;

/** How an authentication attempt was initiated. Closed union, never a free string. */
export type AuthMethod = 'password' | 'two_factor';

export interface AnalyticsEventShape<TName extends string, TProps extends AnalyticsProps> {
    readonly name: TName;
    readonly props: TProps;
}

export type LoginSubmittedEvent = AnalyticsEventShape<
    'auth.login_submitted',
    { readonly method: AuthMethod; readonly remember: boolean; readonly mode: AppMode }
>;

export type LoginSucceededEvent = AnalyticsEventShape<
    'auth.login_succeeded',
    {
        readonly method: AuthMethod;
        readonly mode: AppMode;
        readonly membershipCount: number;
        readonly emailVerified: boolean;
    }
>;

export type RegistrationCompletedEvent = AnalyticsEventShape<
    'auth.registration_completed',
    { readonly mode: AppMode; readonly acceptedMarketing: boolean; readonly locale: string }
>;

export type OrganisationSelectedEvent = AnalyticsEventShape<
    'context.organisation_selected',
    {
        /** Organisation *type* code, never the organisation identifier or name. */
        readonly organisationType: string;
        readonly branchCount: number;
        readonly wasOnlyOption: boolean;
    }
>;

export type BranchSelectedEvent = AnalyticsEventShape<
    'context.branch_selected',
    { readonly branchCount: number; readonly wasOnlyOption: boolean }
>;

export type WorkspaceSwitchedEvent = AnalyticsEventShape<
    'workspace.switched',
    { readonly fromArea: RouteArea | null; readonly toArea: RouteArea; readonly mode: AppMode }
>;

export type AnalyticsEvent =
    | LoginSubmittedEvent
    | LoginSucceededEvent
    | RegistrationCompletedEvent
    | OrganisationSelectedEvent
    | BranchSelectedEvent
    | WorkspaceSwitchedEvent;

export type AnalyticsEventName = AnalyticsEvent['name'];

/** Runtime list of the declared event names, for registry assertions and dev tooling. */
export const ANALYTICS_EVENT_NAMES = [
    'auth.login_submitted',
    'auth.login_succeeded',
    'auth.registration_completed',
    'context.organisation_selected',
    'context.branch_selected',
    'workspace.switched',
] as const satisfies readonly AnalyticsEventName[];

/** Narrows the union to one member, so handlers get exact property types. */
export type AnalyticsEventOf<TName extends AnalyticsEventName> = Extract<
    AnalyticsEvent,
    { name: TName }
>;

/**
 * Builds an event with its properties checked against the union member. Preferred over object
 * literals at call sites because it makes the failure a compile error at the *call*, not at the
 * `track()` boundary.
 */
export function analyticsEvent<TName extends AnalyticsEventName>(
    name: TName,
    props: AnalyticsEventOf<TName>['props'],
): AnalyticsEventOf<TName> {
    return { name, props } as AnalyticsEventOf<TName>;
}
