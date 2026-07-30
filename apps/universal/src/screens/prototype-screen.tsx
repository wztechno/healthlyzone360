import { EmptyState, Stack } from '@healthy360/design-system';
import type { RouteArea } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';

export interface PrototypeScreenProps {
    readonly area: RouteArea;
    readonly testID?: string | undefined;
}

/**
 * The one prototype screen.
 *
 * Plan §16 is explicit: areas that are not functional in Phase 1 render **one consistent prototype
 * state**, not dozens of bespoke empty pages. Every unbuilt area's route file is three lines that
 * render this with its own area name, so there is exactly one place to change when the copy or the
 * treatment changes — and exactly zero places where a dead button could appear, because
 * `EmptyState variant="prototype"` refuses to render actions at all.
 */
export function PrototypeScreen({ area, testID = 'prototype' }: PrototypeScreenProps) {
    const { t } = useTranslation();

    return (
        <Stack space="lg" className="flex-1 justify-center p-4">
            <EmptyState testID={testID} variant="prototype" title={t(`access:area.${area}`)} />
        </Stack>
    );
}
