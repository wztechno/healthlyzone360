import type { ReactNode } from 'react';

/**
 * FormIssueScope — kept so the forms that wrap themselves in it still compile. It changes nothing.
 *
 * It used to let a `FormIssueBanner` quiet the fields its chips named: the field kept its red edge
 * and lost the line of copy under it, on the grounds that the banner had already said it. That left
 * the banner as the only place a problem was written, and a reader who scrolled past it, or never
 * looked at it, found a red box with no reason beside it. Every field now says what is wrong with
 * it under the control, whatever a banner above it says.
 *
 * The scope, `useSummariseFields` and `useFieldSummarised` stay exported with their old signatures
 * so their call sites keep compiling; none of them has an effect any more.
 */
export interface FormIssueScopeProps {
    readonly children: ReactNode;
}

export function FormIssueScope({ children }: FormIssueScopeProps) {
    return <>{children}</>;
}

/** Always `false`: no banner quiets a field's own message. */
export function useFieldSummarised(_id: string): boolean {
    return false;
}

/** Does nothing: the fields a banner names keep their own messages. */
export function useSummariseFields(_fieldIds: readonly string[]): void {
    // Intentionally empty. See `FormIssueScope`.
}
