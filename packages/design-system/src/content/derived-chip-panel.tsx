import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Text } from '../primitives/text.tsx';
import { Badge } from './badge.tsx';
import { Tag } from './tag.tsx';

/**
 * DerivedChipPanel — a run of chips that came from somewhere else, on the sunken fill.
 *
 * ```
 * ┌───────────────────────────────────────────────────────┐
 * │ WHY IT IS HERE   [ FROM DATABASE ]                    │
 * │ ( Quarantined — publication refused ) ( 2 mappings )  │
 * │ Resolved by the review queue's own checks. …          │
 * └───────────────────────────────────────────────────────┘
 * ```
 *
 * The Catalogue's `derived-panel.tsx` generalised (Workbench handoff §2.2): that one is shaped round
 * a record's nutrient tiles; this one is only a label, a provenance badge, the chips and one line
 * saying why they cannot be changed here. The sunken fill and the badge say the same thing twice on
 * purpose — a reader who misses one still gets the other — and there is no disabled control inside,
 * because a disabled control claims it would be editable under some other circumstance.
 */
export interface DerivedChipPanelProps {
    /** Translated heading, set on the `micro` step. */
    readonly label: string;
    /** Translated provenance — "From database". Omit where the source is self-evident. */
    readonly badge?: string | undefined;
    /** Plain read-only chips. Omit and pass `children` for chips that need their own tone or mark. */
    readonly chips?: readonly { readonly key: string; readonly label: string }[] | undefined;
    readonly children?: ReactNode | undefined;
    /** One line saying where the chips come from and how they clear. */
    readonly caption?: string | undefined;
    readonly testID?: string | undefined;
}

export function DerivedChipPanel({
    label,
    badge,
    chips,
    children,
    caption,
    testID,
}: DerivedChipPanelProps) {
    return (
        <View
            testID={testID}
            className="flex-col gap-tight rounded border border-stroke-subtle bg-surface-sunken px-snug py-2.5"
        >
            <View className="flex-row flex-wrap items-center gap-tight">
                <Text variant="micro" tone="secondary">
                    {label}
                </Text>
                {badge === undefined ? null : <Badge tone="info" label={badge} />}
            </View>

            <View className="flex-row flex-wrap gap-control-sm">
                {children}
                {(chips ?? []).map((chip) => (
                    <Tag
                        key={chip.key}
                        label={chip.label}
                        testID={testID === undefined ? undefined : `${testID}-chip-${chip.key}`}
                    />
                ))}
            </View>

            {caption === undefined ? null : (
                <Text variant="caption" tone="secondary">
                    {caption}
                </Text>
            )}
        </View>
    );
}
