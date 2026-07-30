import { Badge, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { ORIGIN_BADGES } from './state-presentation.ts';
import type { VdOriginKind } from './state-presentation.ts';

/**
 * The origin label that travels with every machine-authored value.
 *
 * The Virtual Dietitian's one non-negotiable presentation rule is that an AI suggestion is never
 * shown the way a person's decision is shown. This component is where that rule is spent: it is the
 * only way any surface in the feature renders an origin, so the four labels cannot drift apart and
 * a value cannot quietly lose its label when a card gets rearranged.
 *
 * The label is a visible `Badge`, not a tooltip and not an `accessibilityLabel`. A provenance signal
 * only a hovering mouse user can obtain is not a provenance signal.
 */
export interface OriginBadgeProps {
    readonly kind: VdOriginKind;
    readonly testID?: string | undefined;
    readonly className?: string | undefined;
}

export function OriginBadge({ kind, testID, className }: OriginBadgeProps) {
    const { t } = useTranslation();
    const spec = ORIGIN_BADGES[kind];

    return (
        <Badge
            testID={testID ?? spec.testID}
            tone={spec.tone}
            icon={spec.icon}
            label={t(spec.labelKey)}
            {...(className === undefined ? {} : { className })}
        />
    );
}

/**
 * A figure with its provenance attached.
 *
 * Used for every proposed number on the targets panel. The AI-origin and human-origin readings of
 * the *same* measure are rendered as two of these side by side rather than as one value that
 * changes meaning, so "what did the machine say" and "what did I decide" stay separately legible
 * after an override.
 */
export interface OriginValueProps {
    readonly label: string;
    readonly value: string;
    readonly caption?: string | undefined;
    readonly origin: VdOriginKind;
    readonly testID: string;
}

export function OriginValue({ label, value, caption, origin, testID }: OriginValueProps) {
    return (
        <Stack space="xs" testID={testID} className="flex-1 basis-40">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Heading level={3} testID={`${testID}-value`}>
                {value}
            </Heading>
            <Inline space="xs" align="center">
                <OriginBadge kind={origin} testID={`${testID}-origin`} />
            </Inline>
            {caption === undefined ? null : (
                <Text variant="caption" tone="secondary" testID={`${testID}-caption`}>
                    {caption}
                </Text>
            )}
        </Stack>
    );
}
