import { Text } from '@healthy360/design-system';
import { View } from 'react-native';
/**
 * Label · track · figure rows — channel volume, revenue mix (Workbench handoff §2.3).
 *
 * The figure at the end is the value; the track only shows its share. So a reader who cannot see the
 * bar loses nothing, and the row reads correctly in greyscale.
 */
export interface RatioBarsProps {
    readonly rows: readonly {
        readonly key: string;
        readonly label: string;
        /** Already formatted. */
        readonly value: string;
        /** 0–1, of whatever the caller measures against. */
        readonly share: number;
    }[];
    /** The label track. The design's 110px for channels, 88px for lines of business. */
    readonly labelWidth: number;
    /** The figure track. */
    readonly valueWidth: number;
    readonly testID?: string | undefined;
}
export function RatioBars({ rows, labelWidth, valueWidth, testID }: RatioBarsProps) {
    return (
        <View testID={testID} className="flex-col gap-tight">
            {rows.map((row) => (
                <View
                    key={row.key}
                    testID={testID === undefined ? undefined : `${testID}-${row.key}`}
                    className="flex-row items-center gap-2.5"
                >
                    <View style={{ width: labelWidth }}>
                        <Text variant="body" numberOfLines={1}>
                            {row.label}
                        </Text>
                    </View>
                    <View className="h-2 min-w-0 flex-1 rounded-sm bg-surface-sunken">
                        <View
                            className="h-2 rounded-sm bg-surface-brand"
                            style={{
                                width: `${Math.round(Math.min(1, Math.max(0, row.share)) * 100)}%` as const,
                            }}
                        />
                    </View>
                    <View style={{ width: valueWidth }}>
                        <Text variant="mono" align="end">
                            {row.value}
                        </Text>
                    </View>
                </View>
            ))}
        </View>
    );
}
