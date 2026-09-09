import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, TextInput as RNTextInput, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Dropdown } from '../overlays/dropdown.tsx';
import { FormField, REQUIRED_MARK } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { inputControlClass, inputFrameClassName } from './text-input.tsx';
import { optionMatches } from './select-shared.ts';
import type { SelectOption, SelectProps } from './select-shared.ts';

export type { SelectOption, SelectProps } from './select-shared.ts';

/**
 * Select — web.
 *
 * A field that opens an **anchored listbox under itself**, which is what the Catalogue design draws
 * and what §5 specifies for `SearchSelect`. The native half keeps the full-screen modal radio group;
 * see `select.native.tsx` for why that is right on a phone and wrong here.
 *
 * ## Why the modal had to go on the web
 *
 * A picker for six categories is not a change of context, and a full-screen dialog says it is. It
 * dims the form, takes the scroll position, has to be dismissed before the next field can be
 * reached, and — the complaint that produced this split — it hides the field you are filling in
 * while you choose the value for it. Chaining four of them down a form is four modal round trips for
 * four one-word answers. The panel below the field costs none of that.
 *
 * ## `searchable` types into the field, not into a second field
 *
 * The first pass put a labelled "Search" input *inside* the panel with a result count under it.
 * That is three controls for one decision: press the field, move to the filter, then pick. §5 asks
 * for one — "28px input; typing filters" — so when `searchable` the trigger **is** the input. It
 * shows the chosen option's label at rest, clears to the placeholder on focus, filters as you type,
 * and restores the label on blur. Nothing is typed that is not a filter, so there is no partial
 * value to reconcile: the value only ever changes by choosing an option.
 *
 * A non-searchable `Select` keeps the plain button trigger. Six fixed options do not need a filter,
 * and a text cursor on a field that ignores text is a worse lie than no cursor.
 *
 * ## Still not an ARIA combobox
 *
 * Even with the input it is not one, and deliberately: this is a text field that filters a `listbox`
 * of `option`s, with `Dropdown` supplying `aria-expanded`, `aria-controls` and `aria-haspopup` and
 * owning dismissal, the outside-press swallow and the edge flip. A real combobox adds
 * `aria-activedescendant` tracking and an owned-element contract that is easy to get subtly wrong
 * and that axe reports as serious on every slip — and none of it maps onto React Native, so the two
 * halves would drift.
 *
 * `aria-required` is absent from the button trigger even when the field is required: ARIA 1.2 does
 * not allow it on `role="button"` and axe reports it as an `aria-allowed-attr` critical.
 * Required-ness travels the way `FormField` sends it — the visible `*` beside the label, and the
 * same mark inside the trigger's accessible name.
 */

export function Select<T extends string = string>({
    label,
    options,
    value,
    onChange,
    placeholder,
    hint,
    error,
    required = false,
    disabled = false,
    searchable = false,
    id,
    className,
    testID,
}: SelectProps<T>) {
    const { t } = useTranslation();
    const density = useDensity();
    const [query, setQuery] = useState<string | null>(null);
    const input = useRef<RNTextInput | null>(null);

    const size = density === 'compact' ? 'sm' : 'md';
    const selected = options.find((option) => option.value === value) ?? null;
    const displayText = selected?.label ?? placeholder ?? t('designSystem:select.placeholder');
    const accessibleName = required
        ? `${label} ${REQUIRED_MARK}: ${displayText}`
        : `${label}: ${displayText}`;

    // `null` is "not typing" — the field shows the chosen label. `''` is "typing, nothing entered
    // yet", which shows the placeholder and filters nothing. Collapsing the two would make the
    // field clear itself the moment it was focused and never say what was already chosen.
    const typing = query !== null;
    const needle = (query ?? '').trim().toLocaleLowerCase();
    const filtering = searchable && typing && needle.length > 0;
    const visible = filtering ? options.filter((option) => optionMatches(option, needle)) : options;

    return (
        <FormField
            label={label}
            {...(hint === undefined ? {} : { hint })}
            {...(error === undefined ? {} : { error })}
            required={required}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            {...(testID === undefined ? {} : { testID })}
        >
            {(control: FieldControlProps) => (
                <Dropdown
                    role="listbox"
                    label={label}
                    align="start"
                    {...(testID === undefined ? {} : { testID: `${testID}-list` })}
                    // `w-full` rather than a min-width: an anchored panel shrinks to its content by
                    // default, and a six-option list narrower than the field it belongs to reads as
                    // a tooltip that happened to appear nearby. The field's width is the panel's.
                    panelClassName="w-full max-h-[320px] overflow-hidden"
                    /*
                     * A closed panel has no query, whatever closed it.
                     *
                     * Resetting on `onBlur` alone was not enough: the panel also closes on an
                     * outside press, on Escape and on choosing an option, and at least one of those
                     * paths does not blur the input — which left `zzz` sitting in a field whose
                     * value was still `Kilograms (kg)`, and no way to tell from looking. One
                     * notification covers every route.
                     *
                     * This used to derive it inside `trigger` instead — `if (!open) setQuery(null)`
                     * — on the grounds that adjusting state during render is React's sanctioned way
                     * to derive from a prop. It is, but only for a component's *own* render. The
                     * trigger render prop runs inside `Dropdown`'s render, so that line wrote
                     * `Select` state while `Dropdown` was rendering and React reported it as a
                     * cross-component update. The rule that does hold here is the ordinary one: a
                     * state change belongs in an effect or a handler, and `onOpenChange` is both.
                     */
                    onOpenChange={(next) => {
                        if (!next) setQuery(null);
                    }}
                    trigger={({ triggerProps, toggle, close, open }) => {
                        const frame = inputFrameClassName({
                            invalid: error !== undefined,
                            focused: open,
                            disabled,
                            density,
                            size,
                        });

                        if (!searchable) {
                            return (
                                <Pressable
                                    {...(testID === undefined
                                        ? {}
                                        : { testID: `${testID}-trigger` })}
                                    nativeID={control.nativeID}
                                    role="button"
                                    accessibilityRole="button"
                                    aria-labelledby={control['aria-labelledby']}
                                    accessibilityLabel={accessibleName}
                                    aria-label={accessibleName}
                                    {...(control['aria-describedby'] === undefined
                                        ? {}
                                        : { 'aria-describedby': control['aria-describedby'] })}
                                    aria-invalid={control['aria-invalid']}
                                    {...triggerProps}
                                    // After `triggerProps`, which carries `expanded` alone — the
                                    // disabled state has to survive the merge.
                                    accessibilityState={{ disabled, expanded: open }}
                                    aria-disabled={disabled}
                                    focusable={!disabled}
                                    disabled={disabled}
                                    onPress={toggle}
                                    className={frame}
                                >
                                    <RNText
                                        {...(testID === undefined
                                            ? {}
                                            : { testID: `${testID}-value` })}
                                        className={cx(
                                            'flex-1 text-start',
                                            density === 'compact'
                                                ? 'text-role-body font-admin'
                                                : 'text-base',
                                            selected === null
                                                ? 'text-content-secondary'
                                                : 'text-content-primary',
                                        )}
                                        numberOfLines={1}
                                    >
                                        {displayText}
                                    </RNText>
                                    <Icon
                                        name="chevronDown"
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                </Pressable>
                            );
                        }

                        return (
                            <View className={frame}>
                                <RNTextInput
                                    ref={input}
                                    {...(testID === undefined
                                        ? {}
                                        : { testID: `${testID}-trigger` })}
                                    nativeID={control.nativeID}
                                    aria-labelledby={control['aria-labelledby']}
                                    accessibilityLabel={accessibleName}
                                    aria-label={accessibleName}
                                    {...(control['aria-describedby'] === undefined
                                        ? {}
                                        : { 'aria-describedby': control['aria-describedby'] })}
                                    aria-invalid={control['aria-invalid']}
                                    {...triggerProps}
                                    accessibilityState={{ disabled, expanded: open }}
                                    aria-disabled={disabled}
                                    editable={!disabled}
                                    // `open` and not `typing` alone: the reset above lands in an
                                    // effect, one commit after the panel closes, and without this
                                    // the field would paint the dead query for that frame.
                                    value={typing && open ? (query ?? '') : displayText}
                                    placeholder={placeholder ?? displayText}
                                    inputMode="search"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    onFocus={() => {
                                        setQuery('');
                                        if (!open) toggle();
                                    }}
                                    onBlur={() => {
                                        setQuery(null);
                                    }}
                                    onChangeText={(next) => {
                                        setQuery(next);
                                        if (!open) toggle();
                                    }}
                                    onKeyPress={({ nativeEvent }) => {
                                        if (nativeEvent.key !== 'Escape') return;
                                        setQuery(null);
                                        close();
                                    }}
                                    className={cx(
                                        inputControlClass(density),
                                        // At rest the field is showing a *value*, so it is inked
                                        // like one; while filtering it is showing a query.
                                        selected === null && !(typing && open)
                                            ? 'text-content-secondary'
                                            : null,
                                    )}
                                    style={{ textAlign: 'auto' }}
                                />
                                <Pressable
                                    {...(testID === undefined
                                        ? {}
                                        : { testID: `${testID}-toggle` })}
                                    // Decorative: the input beside it already carries the field's
                                    // name, its expanded state and its describedby chain, and a
                                    // second focus stop announcing the same field twice is noise on
                                    // a form of twelve of them.
                                    accessibilityElementsHidden
                                    aria-hidden
                                    focusable={false}
                                    disabled={disabled}
                                    onPress={() => {
                                        input.current?.focus();
                                        if (!open) toggle();
                                    }}
                                >
                                    <Icon
                                        name="chevronDown"
                                        size="sm"
                                        className="text-content-secondary"
                                    />
                                </Pressable>
                            </View>
                        );
                    }}
                >
                    {({ close }) => (
                        <ScrollView keyboardShouldPersistTaps="handled">
                            {visible.length > 0 ? null : (
                                <RNText
                                    {...(testID === undefined
                                        ? {}
                                        : { testID: `${testID}-no-results` })}
                                    className={cx(
                                        'px-control-md py-tight text-content-secondary text-start',
                                        density === 'compact'
                                            ? 'text-role-body font-admin'
                                            : 'text-sm',
                                    )}
                                >
                                    {t('designSystem:select.noResults')}
                                </RNText>
                            )}

                            {visible.map((option: SelectOption<T>) => {
                                const isSelected = option.value === value;
                                return (
                                    <Pressable
                                        key={option.value}
                                        {...(testID === undefined
                                            ? {}
                                            : { testID: `${testID}-option-${option.value}` })}
                                        role="option"
                                        // `option` is outside React Native's `Role` union, so the
                                        // native side takes `none` and the web `role` above is what
                                        // the listbox actually owns.
                                        accessibilityRole="none"
                                        accessibilityLabel={option.label}
                                        aria-label={option.label}
                                        aria-selected={isSelected}
                                        accessibilityState={{
                                            selected: isSelected,
                                            disabled: option.disabled === true,
                                        }}
                                        aria-disabled={option.disabled === true}
                                        focusable={option.disabled !== true}
                                        disabled={option.disabled === true}
                                        onPress={() => {
                                            onChange(option.value);
                                            setQuery(null);
                                            close();
                                        }}
                                        className={cx(
                                            'flex-row items-center gap-control-sm px-control-md',
                                            // §5's 28px rows, as a floor: an option with a
                                            // description is two lines and must not be clipped.
                                            density === 'compact'
                                                ? 'min-h-control-sm py-hair'
                                                : 'min-h-touch py-2',
                                            isSelected ? 'bg-surface-brand-subtle' : null,
                                            option.disabled === true ? 'opacity-50' : null,
                                        )}
                                    >
                                        {/* Fixed, so labels align whether or not one is ticked. */}
                                        <View className="w-icon-md">
                                            {isSelected ? (
                                                <Icon
                                                    name="check"
                                                    size="sm"
                                                    className="text-content-on-brand-subtle"
                                                />
                                            ) : null}
                                        </View>
                                        <View className="min-w-0 flex-1 flex-col">
                                            <RNText
                                                className={cx(
                                                    'text-content-primary text-start',
                                                    density === 'compact'
                                                        ? 'text-role-body font-admin'
                                                        : 'text-base',
                                                )}
                                                numberOfLines={1}
                                            >
                                                {option.label}
                                            </RNText>
                                            {option.description === undefined ? null : (
                                                <RNText
                                                    className={cx(
                                                        'text-content-secondary text-start',
                                                        density === 'compact'
                                                            ? 'text-role-caption font-admin'
                                                            : 'text-xs',
                                                    )}
                                                    numberOfLines={1}
                                                >
                                                    {option.description}
                                                </RNText>
                                            )}
                                        </View>
                                    </Pressable>
                                );
                            })}
                        </ScrollView>
                    )}
                </Dropdown>
            )}
        </FormField>
    );
}
