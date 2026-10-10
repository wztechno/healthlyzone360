import type { ReactNode } from 'react';

export interface SectionGridProps {
    /** `FormSection`s, usually; each child's `flow` decides whether it is bounded or spans. */
    readonly children: ReactNode;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}
