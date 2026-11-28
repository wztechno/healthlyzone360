import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';

/**
 * "Removed Lentil soup · Undo" — kept in place beside the rows a removal happened in, in the undo
 * toast's dark ink, rather than floating off: the removal happened here, and here is where the
 * reader looks for the way back.
 */
export interface UndoBarProps {
    /** What was removed, already worded by the caller — the row's own name is in it. */
    readonly label: string;
    readonly onUndo: () => void;
    readonly testID: string;
}

export function UndoBar({ label, onUndo, testID }: UndoBarProps) {
    const { t } = useTranslation();

    // The undo toast's dark ink, kept in place beside the rows rather than floating off: the
    // removal happened here, and here is where the reader looks for the way back.
    return (
        <View className="flex-row items-center gap-2.5 self-start rounded-xl bg-surface-inverse py-1.5 pe-1.5 ps-3">
            <Icon name="rotateCw" size="sm" className="text-content-inverse" />
            <RNText
                testID={`${testID}-removed`}
                className="text-role-body font-semibold text-content-inverse"
            >
                {label}
            </RNText>
            <Pressable
                testID={`${testID}-undo`}
                role="button"
                accessibilityRole="button"
                onPress={onUndo}
                className="h-7 justify-center rounded-full px-2.5 hover:bg-content-inverse/15"
            >
                <RNText className="text-role-body font-bold text-stage-green">
                    {t('designSystem:undoBar.undo')}
                </RNText>
            </Pressable>
        </View>
    );
}
