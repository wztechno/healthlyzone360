import { Skeleton, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

/**
 * The one KPI tile for every kitchen surface — the hub, analytics, the ops boards and the reports
 * each carried a near-identical private copy; this is the merge, in the report frame's order:
 * label, value, meaning.
 *
 * The value and the hint are React Native `Text`, not the design-system one, because both state
 * their own face and colour — the documented className-ordering trap in
 * `packages/design-system/src/primitives/text.tsx`.
 */
export interface KpiTileProps {
    readonly testID: string;
    readonly label: string;
    /**
     * Already formatted by the caller (numbers localised, units applied). `null` renders an em
     * dash — the honest "could not be read", never a zero.
     */
    readonly value: string | null;
    /** Query still in flight: a skeleton where the value goes. */
    readonly pending?: boolean | undefined;
    /** One-line meaning under the value. */
    readonly hint?: string | undefined;
    /** Trend badge slot, under the value. */
    readonly trend?: ReactNode | undefined;
    /** Caption under an em-dash value explaining the absence. */
    readonly nullCaption?: string | undefined;
    /** Value face: `md` 24px, `lg` 30px — the §1.2b snaps of the drawn 25/28. */
    readonly size?: 'md' | 'lg' | undefined;
}

export function KpiTile({
    testID,
    label,
    value,
    pending = false,
    hint,
    trend,
    nullCaption,
    size = 'md',
}: KpiTileProps) {
    return (
        <View
            testID={testID}
            className="min-h-[96px] min-w-[140px] flex-1 basis-[140px] rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
        >
            <Text tone="secondary" variant="micro">
                {label}
            </Text>
            {pending ? (
                <View className="mt-1">
                    <Skeleton
                        testID={`${testID}-loading`}
                        heightClassName="h-8"
                        widthClassName="w-1/2"
                    />
                </View>
            ) : (
                <RNText
                    testID={`${testID}-value`}
                    className={
                        size === 'lg'
                            ? 'mt-1 tabular-nums text-3xl font-bold text-content-primary text-start'
                            : 'mt-1 tabular-nums text-2xl font-bold text-content-primary text-start'
                    }
                >
                    {value ?? '—'}
                </RNText>
            )}
            {trend === undefined ? null : (
                <View className="mt-2 flex-row items-center">{trend}</View>
            )}
            {hint === undefined ? null : (
                <RNText
                    testID={`${testID}-hint`}
                    className="mt-1.5 text-xs font-bold text-brand-600"
                >
                    {hint}
                </RNText>
            )}
            {!pending && value === null && nullCaption !== undefined ? (
                <Text tone="secondary" variant="caption" className="mt-1">
                    {nullCaption}
                </Text>
            ) : null}
        </View>
    );
}
