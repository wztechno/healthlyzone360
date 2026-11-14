import { Dropdown, Icon, SlideIn } from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';

/**
 * The desk's dropdown with a filter — `DeskSelect`'s card for a long list you pick *from* rather
 * than a scope you set (Add a pack, Choose container, + Add packaging).
 *
 * ```
 * ( + Add a pack…            ⌄ )
 *  ┌──────────────────────────────┐
 *  │ ⌕ Type to filter             │   320px card that rises 8px as it opens (the order desk's
 *  │ Bottle 0.5 L   Holds 0.5 kg… │   filters), the filter focused; 36px rows, the option's
 *  │ Bottle 1 L     Holds 1 kg…   │   description at the end; a pick closes it.
 *  └──────────────────────────────┘
 * ```
 *
 * It floats over the page (`Dropdown`), so a card's edge never clips it. Takes `Select`'s options,
 * so a page moves to it by changing the element.
 */
export function DeskPicker({
    label,
    placeholder,
    options,
    onChange,
    loading = false,
    disabled = false,
    align = 'start',
    className,
    noResultsAction,
    testID,
}: {
    /** What the control is, for assistive technology — the visible text is `placeholder`. */
    readonly label: string;
    readonly placeholder: string;
    readonly options: readonly SelectOption[];
    readonly onChange: (value: string) => void;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
    readonly align?: 'start' | 'end' | undefined;
    readonly className?: string | undefined;
    /** Drawn under "No results" with what was typed — e.g. create the missing ingredient. */
    readonly noResultsAction?: ((typed: string, close: () => void) => ReactNode) | undefined;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (q === '') return options;
        return options.filter((option) =>
            [option.label, option.description ?? '', option.keywords ?? '']
                .join(' ')
                .toLowerCase()
                .includes(q),
        );
    }, [options, query]);

    return (
        <Dropdown
            label={label}
            role="listbox"
            align={align}
            onOpenChange={(open) => {
                if (!open) setQuery('');
            }}
            panelClassName="w-[320px] !rounded-xl !shadow-elevation-bar p-1.5"
            {...(className === undefined ? {} : { className })}
            trigger={({ triggerProps, toggle, open }) => (
                <Pressable
                    {...triggerProps}
                    // `Select`'s ids: `-trigger` to press, the bare id as the jump target.
                    testID={`${testID}-trigger`}
                    nativeID={testID}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ expanded: open, disabled }}
                    disabled={disabled}
                    onPress={toggle}
                    className={`h-desk-toolbar flex-row items-center gap-2 rounded-full border pe-2.5 ps-[14px] web:transition-colors ${
                        open
                            ? 'border-stroke bg-surface-brand-subtle'
                            : 'border-stroke-subtle bg-surface-raised hover:border-stroke hover:bg-surface-brand-subtle'
                    } ${disabled ? 'opacity-50' : ''}`}
                >
                    <RNText
                        numberOfLines={1}
                        className={`min-w-0 shrink text-role-strong ${
                            open ? 'text-content-on-brand-subtle' : 'text-content-primary'
                        }`}
                    >
                        {placeholder}
                    </RNText>
                    <View
                        aria-hidden
                        className={`web:transition-transform ${open ? 'rotate-180' : ''}`}
                    >
                        <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                    </View>
                </Pressable>
            )}
        >
            {(state) => (
                <SlideIn edge="bottom" distance="small" duration="normal">
                    <View className="flex-col gap-1">
                        <View className="h-9 flex-row items-center gap-1.5 rounded-lg border border-stroke bg-surface-raised px-2.5">
                            <Icon name="search" size="sm" className="text-content-secondary" />
                            <FilterInput
                                testID={`${testID}-search-input`}
                                value={query}
                                onChangeText={setQuery}
                                placeholder={t('designSystem:select.searchPlaceholder')}
                                accessibilityLabel={t('designSystem:select.searchPlaceholder')}
                                onSubmitEditing={() => {
                                    const first = shown[0];
                                    if (first === undefined) return;
                                    onChange(first.value);
                                    state.close();
                                }}
                                className="min-w-0 flex-1 text-sm text-content-primary web:outline-none"
                            />
                        </View>
                        <ScrollView style={{ maxHeight: 300 }}>
                            {loading ? (
                                <RNText className="px-2.5 py-2 text-sm text-content-secondary">
                                    {t('designSystem:select.loading')}
                                </RNText>
                            ) : shown.length === 0 ? (
                                <View className="flex-col items-start gap-1.5 px-2.5 py-2">
                                    <RNText
                                        testID={`${testID}-empty`}
                                        className="text-sm text-content-secondary"
                                    >
                                        {t('designSystem:select.noResults')}
                                    </RNText>
                                    {noResultsAction !== undefined && query.trim() !== ''
                                        ? noResultsAction(query.trim(), state.close)
                                        : null}
                                </View>
                            ) : (
                                (() => {
                                    let sectionIndex = -1;
                                    return shown.map((option, index) => {
                                        const section =
                                            option.section !== undefined &&
                                            option.section !== shown[index - 1]?.section
                                                ? option.section
                                                : null;
                                        if (section !== null) sectionIndex += 1;
                                        return (
                                            <View key={option.value}>
                                                {section === null ? null : (
                                                    <RNText
                                                        testID={`${testID}-section-${String(sectionIndex)}`}
                                                        className="px-2.5 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-content-secondary"
                                                    >
                                                        {section}
                                                    </RNText>
                                                )}
                                                <Pressable
                                                    testID={`${testID}-option-${option.value}`}
                                                    role="option"
                                                    accessibilityRole="button"
                                                    accessibilityLabel={option.label}
                                                    disabled={option.disabled === true}
                                                    onPress={() => {
                                                        onChange(option.value);
                                                        state.close();
                                                    }}
                                                    className="min-h-9 flex-col justify-center rounded-lg px-2.5 py-1.5 hover:bg-surface-brand-subtle"
                                                >
                                                    <RNText
                                                        numberOfLines={1}
                                                        className="text-sm font-medium text-content-primary"
                                                    >
                                                        {option.label}
                                                    </RNText>
                                                    {option.description === undefined ? null : (
                                                        <RNText
                                                            numberOfLines={1}
                                                            className="text-xs text-content-secondary"
                                                        >
                                                            {option.description}
                                                        </RNText>
                                                    )}
                                                </Pressable>
                                            </View>
                                        );
                                    });
                                })()
                            )}
                        </ScrollView>
                    </View>
                </SlideIn>
            )}
        </Dropdown>
    );
}

/**
 * The filter box, focused once the floating card has been placed. `autoFocus` fires while the
 * layer is still being measured off-screen, so the browser drops it and the first keystroke after
 * opening went nowhere.
 */
function FilterInput(props: ComponentProps<typeof TextInput>) {
    const ref = useRef<TextInput>(null);
    useEffect(() => {
        const timer = setTimeout(() => {
            ref.current?.focus();
        }, 50);
        return () => {
            clearTimeout(timer);
        };
    }, []);
    return <TextInput ref={ref} {...props} />;
}
