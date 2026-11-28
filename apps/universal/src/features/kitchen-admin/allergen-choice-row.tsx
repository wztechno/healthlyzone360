import type { AllergenContainment } from '@healthy360/api-client/contracts';
import { Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

export type AllergenChoice = AllergenContainment | 'none';

const CHOICES: readonly {
    readonly value: AllergenChoice;
    readonly labelKey: string;
    readonly selectedClass: string;
    readonly selectedText: string;
}[] = [
    {
        value: 'none',
        labelKey: 'kitchen:allergenBoard.choiceNo',
        selectedClass: 'bg-surface-raised shadow-elevation-card',
        selectedText: 'text-content-primary',
    },
    {
        value: 'may_contain',
        labelKey: 'kitchen:containment.mayContain',
        selectedClass: 'bg-warning',
        selectedText: 'text-warning-on-default',
    },
    {
        value: 'contains',
        labelKey: 'kitchen:containment.contains',
        selectedClass: 'bg-warning-strong',
        selectedText: 'text-warning-on-strong',
    },
];

export interface AllergenChoiceRowProps {
    /** Translated class name. */
    readonly name: string;
    readonly value: AllergenChoice;
    readonly onChange: (value: AllergenChoice) => void;
    readonly disabled?: boolean | undefined;
    /** What the server refused about this class. */
    readonly error?: string | undefined;
    /** Where a tray card or a refusal scrolls to. */
    readonly nativeID?: string | undefined;
    readonly testID: string;
}

/**
 * One allergen class on the ingredient editor, as the `Kitchen-ingredient-edit` board draws it:
 * the name, then No · May contain · Contains. A row carrying the allergen takes the warning ground,
 * so what a record declares can be read off the list without reading fourteen controls.
 */
export function AllergenChoiceRow({
    name,
    value,
    onChange,
    disabled = false,
    error,
    nativeID,
    testID,
}: AllergenChoiceRowProps) {
    const { t } = useTranslation();
    const flagged = value !== 'none';

    return (
        <View
            testID={testID}
            nativeID={nativeID}
            className="min-w-0"
            style={{ flexBasis: 340, flexGrow: 1 }}
        >
            <View
                className={`min-h-[42px] flex-row items-center justify-between gap-2.5 rounded-xl pe-1 ps-2.5 ${
                    flagged ? 'bg-warning-subtle' : 'web:hover:bg-surface-sunken'
                }`}
            >
                {/* A long class name wraps beside the buttons rather than pushing them down. */}
                <View className="min-w-0 shrink">
                    <Text
                        variant={flagged ? 'strong' : 'body'}
                        tone={flagged ? 'warning' : 'primary'}
                    >
                        {name}
                    </Text>
                </View>
                <View
                    role="radiogroup"
                    aria-label={name}
                    className="shrink-0 flex-row gap-0.5 rounded-[10px] bg-surface-sunken p-[3px]"
                >
                    {CHOICES.map((choice) => {
                        const selected = value === choice.value;
                        return (
                            <Pressable
                                key={choice.value}
                                testID={`${testID}-${choice.value}`}
                                role="radio"
                                accessibilityRole="radio"
                                accessibilityState={{ checked: selected, disabled }}
                                aria-checked={selected}
                                disabled={disabled}
                                onPress={() => {
                                    onChange(choice.value);
                                }}
                                className={`h-7 items-center justify-center rounded-lg px-2.5 ${
                                    selected ? choice.selectedClass : ''
                                }`}
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={`text-role-label font-semibold ${
                                        selected ? choice.selectedText : 'text-content-secondary'
                                    }`}
                                >
                                    {t(choice.labelKey)}
                                </RNText>
                            </Pressable>
                        );
                    })}
                </View>
            </View>
            {error === undefined ? null : (
                <View className="ps-2.5 pt-1">
                    <Text variant="caption" tone="danger" testID={`${testID}-error`}>
                        {error}
                    </Text>
                </View>
            )}
        </View>
    );
}
