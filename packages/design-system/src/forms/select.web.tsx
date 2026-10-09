import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { webRole } from '../internal/web-props.ts';
import { Dropdown } from '../overlays/dropdown.tsx';
import { FormField, REQUIRED_MARK } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { SearchInput } from './search-input.tsx';
import { inputFrameClassName } from './text-input.tsx';
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
 * ## `searchable` puts the filter in the panel, not in the field
 *
 * Every `Select` has the same trigger: a button that shows the chosen option and opens the panel.
 * A `searchable` one adds a search box at the top of that panel, focused as it opens, with the
 * options under it — the shape the native half already has.
 *
 * It used to be the other way round: the trigger *was* the input, cleared to its placeholder on
 * focus and filtered as you typed. That made one kind of `Select` look and behave unlike every
 * other, put a text cursor in a field whose value can only be chosen, and showed a half-typed query
 * where the chosen value belonged. A field that always reads as its value, and a filter that lives
 * where the options are, is one control for each job.
 *
 * Typing goes straight into the box, so the keyboard path is still press → type → Enter: Enter takes
 * the first option still showing, Tab walks the options, Escape closes. The query belongs to the
 * open panel and is gone when it closes, however it closed.
 *
 * A non-searchable `Select` has no box. Six fixed options do not need a filter.
 *
 * ## Still not an ARIA combobox
 *
 * Deliberately: a searchable panel is a `dialog` holding two independent, individually valid widgets
 * — a labelled search box and the `listbox` of `option`s under it — with `Dropdown` supplying
 * `aria-expanded`, `aria-controls` and `aria-haspopup` and owning dismissal, the outside-press
 * swallow and the edge flip. A real combobox adds `aria-activedescendant` tracking and an
 * owned-element contract that is easy to get subtly wrong and that axe reports as serious on every
 * slip — and none of it maps onto React Native, so the two halves would drift. The count under the
 * box is a polite live region, as on native: filtering silently shortens the list.
 *
 * `aria-required` is absent from the trigger even when the field is required: ARIA 1.2 does not
 * allow it on `role="button"` and axe reports it as an `aria-allowed-attr` critical. Required-ness
 * travels the way `FormField` sends it — the visible `*` beside the label, and the same mark inside
 * the trigger's accessible name.
 */

export function Select<T extends string = string>({
    label,
    labelHidden = false,
    options,
    value,
    onChange,
    placeholder,
    hint,
    error,
    warning,
    required = false,
    disabled = false,
    searchable = false,
    size: sizeProp,
    id,
    className,
    testID,
}: SelectProps<T>) {
    const { t } = useTranslation();
    const density = useDensity();
    const [query, setQuery] = useState('');
    const trigger = useRef<View | null>(null);
    const searchId = `select-search-${useId().replace(/:/g, '')}`;

    const size = sizeProp ?? (density === 'compact' ? 'sm' : 'md');
    const selected = options.find((option) => option.value === value) ?? null;
    const displayText = selected?.label ?? placeholder ?? t('designSystem:select.placeholder');
    const accessibleName = required
        ? `${label} ${REQUIRED_MARK}: ${displayText}`
        : `${label}: ${displayText}`;

    const needle = query.trim().toLocaleLowerCase();
    const filtering = searchable && needle.length > 0;
    const visible = filtering ? options.filter((option) => optionMatches(option, needle)) : options;
    const statusText = !filtering
        ? ''
        : visible.length === 0
          ? t('designSystem:select.noResults')
          : t('designSystem:select.searchResults', { count: visible.length });

    const textClass = density === 'compact' ? 'text-role-body' : 'text-base';

    /** Picks, closes, and hands focus back to the field — the panel it was in is gone. */
    const choose = (option: SelectOption<T>, close: () => void) => {
        onChange(option.value);
        setQuery('');
        close();
        trigger.current?.focus();
    };

    const optionRows = (close: () => void) => (
        <>
            {visible.length > 0 ? null : (
                <RNText
                    {...(testID === undefined ? {} : { testID: `${testID}-no-results` })}
                    className={cx(
                        'px-control-md py-tight text-content-secondary text-start',
                        density === 'compact' ? 'text-role-body' : 'text-sm',
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
                        // `option` is outside React Native's `Role` union, so the native side takes
                        // `none` and the web `role` above is what the listbox actually owns.
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
                            choose(option, close);
                        }}
                        className={cx(
                            'flex-row items-center gap-control-sm px-control-md',
                            // §5's 28px rows, as a floor: an option with a description is two
                            // lines and must not be clipped.
                            density === 'compact' ? 'min-h-control-sm py-hair' : 'min-h-touch py-2',
                            // The row under the pointer or the keyboard is lit, so the reader sees
                            // which one a press or Enter will take — the chosen one keeps its brand
                            // tint over it.
                            isSelected
                                ? 'bg-surface-brand-subtle'
                                : option.disabled === true
                                  ? null
                                  : 'hover:bg-surface-sunken focus:bg-surface-sunken',
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
                                className={cx('text-content-primary text-start', textClass)}
                                numberOfLines={1}
                            >
                                {option.label}
                            </RNText>
                            {option.description === undefined ? null : (
                                <RNText
                                    className={cx(
                                        'text-content-secondary text-start',
                                        density === 'compact' ? 'text-role-caption' : 'text-xs',
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
        </>
    );

    return (
        <FormField
            label={label}
            labelHidden={labelHidden}
            {...(hint === undefined ? {} : { hint })}
            {...(error === undefined ? {} : { error })}
            {...(warning === undefined ? {} : { warning })}
            required={required}
            disabled={disabled}
            {...(id === undefined ? {} : { id })}
            {...(className === undefined ? {} : { className })}
            {...(testID === undefined ? {} : { testID })}
        >
            {(control: FieldControlProps) => (
                <Dropdown
                    role={searchable ? 'dialog' : 'listbox'}
                    label={label}
                    align="start"
                    {...(testID === undefined ? {} : { testID: `${testID}-list` })}
                    // `w-full` rather than a min-width: an anchored panel shrinks to its content by
                    // default, and a six-option list narrower than the field it belongs to reads as
                    // a tooltip that happened to appear nearby. The field's width is the panel's.
                    panelClassName="w-full max-h-[320px] overflow-hidden"
                    /*
                     * A closed panel has no query, whatever closed it — an outside press, Escape or
                     * a choice. `onOpenChange` is the one notification that covers every route, and
                     * it fires after commit, so setting state from it is not a cross-component
                     * update during `Dropdown`'s render.
                     */
                    onOpenChange={(next) => {
                        if (!next) setQuery('');
                    }}
                    trigger={({ triggerProps, toggle, open }) => (
                        <Pressable
                            ref={trigger}
                            {...(testID === undefined ? {} : { testID: `${testID}-trigger` })}
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
                            // After `triggerProps`, which carries `expanded` alone — the disabled
                            // state has to survive the merge.
                            accessibilityState={{ disabled, expanded: open }}
                            aria-disabled={disabled}
                            focusable={!disabled}
                            disabled={disabled}
                            onPress={toggle}
                            className={inputFrameClassName({
                                invalid: error !== undefined,
                                caution: error === undefined && warning !== undefined,
                                focused: open,
                                disabled,
                                density,
                                size,
                            })}
                        >
                            <RNText
                                {...(testID === undefined ? {} : { testID: `${testID}-value` })}
                                className={cx(
                                    'flex-1 text-start',
                                    textClass,
                                    selected === null
                                        ? 'text-content-secondary'
                                        : 'text-content-primary',
                                )}
                                numberOfLines={1}
                            >
                                {displayText}
                            </RNText>
                            <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                        </Pressable>
                    )}
                >
                    {({ close }) =>
                        !searchable ? (
                            <ScrollView keyboardShouldPersistTaps="handled">
                                {optionRows(close)}
                            </ScrollView>
                        ) : (
                            <>
                                {/* Pinned over the list: the box stays put while the list scrolls. */}
                                <View className="shrink-0 border-b border-stroke-subtle p-tight">
                                    <SearchInput
                                        {...(testID === undefined
                                            ? {}
                                            : { testID: `${testID}-search` })}
                                        label={t('designSystem:select.searchLabel')}
                                        placeholder={t('designSystem:select.searchPlaceholder')}
                                        size="xs"
                                        nativeID={searchId}
                                        value={query}
                                        onChangeText={setQuery}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        onSubmitEditing={() => {
                                            const first = visible.find(
                                                (option) => option.disabled !== true,
                                            );
                                            if (first !== undefined) choose(first, close);
                                        }}
                                        onKeyPress={({ nativeEvent }) => {
                                            // `Dropdown` closes on Escape; the field takes the
                                            // focus back so the next Tab carries on from it.
                                            if (nativeEvent.key === 'Escape') {
                                                trigger.current?.focus();
                                            }
                                        }}
                                    />
                                    <RNText
                                        {...(testID === undefined
                                            ? {}
                                            : { testID: `${testID}-search-status` })}
                                        role="status"
                                        aria-live="polite"
                                        accessibilityLiveRegion="polite"
                                        // Spoken, not drawn: the list shrinking under the box is
                                        // what a sighted reader sees, and the empty row says so
                                        // when nothing is left.
                                        className="absolute h-px w-px overflow-hidden opacity-0"
                                    >
                                        {statusText}
                                    </RNText>
                                    <FocusWhenPlaced targetId={searchId} />
                                </View>
                                <ScrollView
                                    keyboardShouldPersistTaps="handled"
                                    className="min-h-0 shrink"
                                >
                                    <View {...webRole('listbox')} aria-label={label}>
                                        {optionRows(close)}
                                    </View>
                                </ScrollView>
                            </>
                        )
                    }
                </Dropdown>
            )}
        </FormField>
    );
}

/**
 * Moves focus into the search box once the panel can take it.
 *
 * Not `autoFocus`, and not a plain effect: the lifted panel mounts `visibility: hidden` and is shown
 * by the placement its layer sets in a layout effect (`anchored-layer.web.tsx`), and a hidden input
 * refuses focus. That placement re-renders synchronously, after this component's passive effect has
 * already run, so the focus waits one task — by then the panel is visible. A timer rather than an
 * animation frame, which a browser does not run for a tab in the background.
 */
function FocusWhenPlaced({ targetId }: { readonly targetId: string }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            document.getElementById(targetId)?.focus();
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [targetId]);
    return null;
}
