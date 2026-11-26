import { Text } from '@healthy360/design-system';
import type { BadgeTone } from '@healthy360/design-system';
import { View } from 'react-native';

/**
 * A list's status cell: a dot and the word, as the Ingredients board draws it (`● Published`).
 *
 * Every admin list's status column uses it, so a record's state reads the same on every page; a
 * pill (`Badge`) stays for the flags beside a name — Late, Missing Arabic — not for the status.
 * The tone is the page's own status-to-tone answer, and the word carries the meaning.
 */
export function DeskStatusDot({
    tone,
    label,
    testID,
}: {
    readonly tone: BadgeTone;
    readonly label: string;
    readonly testID?: string | undefined;
}) {
    return (
        <View testID={testID} className="flex-row items-center gap-1.5">
            <View aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[tone]}`} />
            <Text variant="label" numberOfLines={1}>
                {label}
            </Text>
        </View>
    );
}

/** The dot, by tone. Neutral is the quiet grey a retired or unknown state takes. */
const DOT_CLASS: Readonly<Record<BadgeTone, string>> = {
    success: 'bg-success',
    brand: 'bg-surface-brand',
    warning: 'bg-warning-border',
    danger: 'bg-danger',
    info: 'bg-info',
    neutral: 'bg-content-secondary',
};
