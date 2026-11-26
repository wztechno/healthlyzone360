import { View } from 'react-native';
import { Text } from '../primitives/text.tsx';

/** One read-only pair in a record's field grid. */
export interface RecordWindowField {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Already formatted. */
    readonly value: string;
    /** Every numeral — quantity, money, reference, date — is `mono`. */
    readonly mono?: boolean | undefined;
}
/** The side of a square read-only window — `Dialog`'s record size. */
export const RECORD_WINDOW_SIDE = 640;
/** One field track — the design's `minmax(0, 280px)`. */
const FIELD_TRACK = 280;
/**
 * The window's field grid, on its own so a form section can draw the same read-only pairs.
 *
 * Two 280px tracks that do not stretch: the design's `repeat(2, minmax(0, 280px)); justify-content:
 * start`. A wrapping row of fixed cells is that grid in flexbox — a narrow window drops to one column
 * rather than squeezing two.
 *
 * The label outranks the value: `strong` (13px, 600, primary ink) over a 12px value, so a reader
 * scanning the record finds "Name" first and "Tomato" under it. It used to be the other way round —
 * a 10px secondary label under a larger value — which made a page of pairs read as a column of
 * loose values with captions nobody could find.
 */
export function RecordWindowFieldGrid({
    fields,
    testID,
}: {
    readonly fields: readonly RecordWindowField[];
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} className="flex-row flex-wrap gap-x-base gap-y-snug">
            {fields.map((field) => (
                <View
                    key={field.key}
                    testID={testID === undefined ? undefined : `${testID}-${field.key}`}
                    className="min-w-0 flex-col gap-0.5"
                    style={{ width: FIELD_TRACK, maxWidth: '100%' }}
                >
                    <Text
                        variant="strong"
                        testID={testID === undefined ? undefined : `${testID}-${field.key}-label`}
                    >
                        {field.label}
                    </Text>
                    <Text
                        variant={field.mono === true ? 'mono' : 'body'}
                        testID={testID === undefined ? undefined : `${testID}-${field.key}-value`}
                    >
                        {field.value}
                    </Text>
                </View>
            ))}
        </View>
    );
}
