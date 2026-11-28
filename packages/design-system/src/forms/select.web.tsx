import { Fragment, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text as RNText, TextInput, View } from 'react-native';

import { useDensity } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { webRole } from '../internal/web-props.ts';
import { SlideIn } from '../motion/slide-in.tsx';
import { Dropdown } from '../overlays/dropdown.tsx';
import type { DropdownRenderState } from '../overlays/dropdown.tsx';
import { FormField, REQUIRED_MARK } from './form-field.tsx';
import type { FieldControlProps } from './form-field.tsx';
import { SearchInput } from './search-input.tsx';
import { inputFrameClassName } from './text-input.tsx';
import { useAreaLook } from '../hooks/area-look.tsx';
import {
    optionMatches,
    optionText,
    resolveNarrow,
    resolveSearchable,
    sectionRuns,
} from './select-shared.ts';
import type { SelectOption, SelectProps } from './select-shared.ts';

export type { SelectOption, SelectProps } from './select-shared.ts';

/**
 * Select — web.
 *
 * A field that opens an **anchored listbox under itself**, which is what the Catalogue design draws
 * and what §5 specifies for `SearchSelect`. The native half keeps the full-screen modal radio group;
 * see `select.native.tsx` for why that is right on a phone and wrong here.
 *
 * ## One dropdown for the admin
 *
 * Every "pick a value" list in the kitchen admin is this component (2026-11-26): the form field,
 * the toolbar scope ("Slot  All ⌄") and the action pill ("Add an ingredient…"). They differ only in
 * the button that opens them (`trigger`); the card that opens is one design, so a change to it
 * reaches every page. Row actions (`Menu`) and Show columns are not values and stay their own parts.
 *
 * ```
 * ( Add an ingredient…   ⌄ )          trigger="pill", value={null}
 *  ┌──────────────────────────────┐
 *  │ ⌕ Type to filter             │   only past SEARCH_THRESHOLD options (searchable="auto")
 *  │ RAW MATERIALS                │   an option's `section`
 *  │ Cheddar, melted (canned)     │   the name, and under it the `description`
 *  │ Dairy · $7.68                │
 *  └──────────────────────────────┘
 * ```
 *
 * ## Why the modal had to go on the web
 *
 * A picker for six categories is not a change of context, and a full-screen dialog says it is. It
 * dims the form, takes the scroll position, has to be dismissed before the next field can be
 * reached, and — the complaint that produced this split — it hides the field you are filling in
 * while you choose the value for it. The panel below the field costs none of that.
 *
 * ## The filter lives in the panel, not in the field
 *
 * Every `Select` has the same kind of trigger: a button that shows the chosen option (or, as a
 * pill action, what it adds) and opens the panel. A searchable one adds a search box at the top of
 * that panel, focused as it opens. A field that always reads as its value, and a filter that lives
 * where the options are, is one control for each job.
 *
 * Typing goes straight into the box, so the keyboard path is press → type → Enter: Enter takes the
 * first option still showing, Tab walks the options, Escape closes. The query belongs to the open
 * panel and is gone when it closes, however it closed.
 *
 * ## Still not an ARIA combobox
 *
 * Deliberately: a searchable panel is a `dialog` holding two independent, individually valid widgets
 * — a labelled search box and the `listbox` of `option`s under it — with `Dropdown` supplying
 * `aria-expanded`, `aria-controls` and `aria-haspopup` and owning dismissal, the outside-press
 * swallow and the edge flip. A real combobox adds `aria-activedescendant` tracking and an
 * owned-element contract that is easy to get subtly wrong and none of it maps onto React Native, so
 * the two halves would drift. The count under the box is a polite live region, as on native.
 *
 * `aria-required` is absent from the trigger even when the field is required: ARIA 1.2 does not
 * allow it on `role="button"`. Required-ness travels the way `FormField` sends it — the visible `*`
 * beside the label, and the same mark inside the trigger's accessible name.
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
    searchable: searchableSetting,
    look: lookProp,
    trigger: triggerKind = 'field',
    align = 'start',
    width,
    loading = false,
    noResultsAction,
    size: sizeProp,
    id,
    className,
    testID,
}: SelectProps<T>) {
    const { t } = useTranslation();
    const density = useDensity();
    const pill = triggerKind === 'pill';
    const areaLook = useAreaLook() === 'desk' ? 'card' : 'field';
    const look = pill ? 'card' : (lookProp ?? areaLook);
    const card = look === 'card';
    // Automatic only in the admin's card look, so the web shop's fields keep their width.
    const narrow = !pill && (width === 'narrow' || (card && resolveNarrow(width, options)));
    const searchable = resolveSearchable(
        searchableSetting,
        look,
        options.length,
        noResultsAction !== undefined,
    );
    /** A pill with no value adds something rather than holding a choice — no check column. */
    const action = pill && value === null;
    const [query, setQuery] = useState('');
    const trigger = useRef<View | null>(null);
    const searchId = `select-search-${useId().replace(/:/g, '')}`;

    const size = sizeProp ?? (density === 'compact' ? 'sm' : 'md');
    const selected = options.find((option) => option.value === value) ?? null;
    const displayText = selected?.label ?? placeholder ?? t('designSystem:select.placeholder');
    const accessibleName = action
        ? label
        : required
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

    /** Picks, closes, and hands focus back to the trigger — the panel it was in is gone. */
    const choose = (option: SelectOption<T>, close: () => void) => {
        onChange(option.value);
        setQuery('');
        close();
        trigger.current?.focus();
    };

    const submitFirst = (close: () => void) => {
        const first = visible.find((option) => option.disabled !== true);
        if (first !== undefined) choose(first, close);
    };

    const optionRows = (close: () => void) => (
        <>
            {visible.length > 0 ? null : (
                <RNText
                    {...(testID === undefined ? {} : { testID: `${testID}-no-results` })}
                    className={cx(
                        'text-content-secondary text-start',
                        card ? 'px-2.5 py-2 text-sm' : 'px-control-md py-tight',
                        card ? null : density === 'compact' ? 'text-role-body' : 'text-sm',
                    )}
                >
                    {t(loading ? 'designSystem:select.loading' : 'designSystem:select.noResults')}
                </RNText>
            )}

            {visible.length > 0 || !filtering || loading || noResultsAction === undefined ? null : (
                <View className={card ? 'items-start px-2.5 pb-2' : 'px-control-md pb-tight'}>
                    {noResultsAction(query.trim(), close)}
                </View>
            )}

            {sectionRuns(visible).map((run, runIndex) =>
                run.section === undefined ? (
                    <Fragment key={`run-${String(runIndex)}`}>
                        {run.options.map((option) => optionRow(option, close))}
                    </Fragment>
                ) : (
                    // A group inside the listbox, named by its heading — ARIA's own shape for
                    // grouped options. The heading is not an option: no focus, no press.
                    <View
                        key={`run-${String(runIndex)}`}
                        {...webRole('group')}
                        aria-labelledby={`${searchId}-section-${String(runIndex)}`}
                    >
                        <RNText
                            {...(testID === undefined
                                ? {}
                                : { testID: `${testID}-section-${String(runIndex)}` })}
                            nativeID={`${searchId}-section-${String(runIndex)}`}
                            className={cx(
                                'text-content-secondary text-start',
                                card
                                    ? 'px-2.5 pb-1 pt-2 text-role-micro font-bold uppercase tracking-wide'
                                    : 'px-control-md py-1 text-role-micro',
                            )}
                        >
                            {run.section}
                        </RNText>
                        {run.options.map((option) => optionRow(option, close))}
                    </View>
                ),
            )}
        </>
    );

    function optionRow(option: SelectOption<T>, close: () => void) {
        const isSelected = option.value === value;
        const inert = option.disabled === true;
        return (
            <Pressable
                key={option.value}
                {...(option.testID !== undefined
                    ? { testID: option.testID }
                    : testID === undefined
                      ? {}
                      : { testID: `${testID}-option-${option.value}` })}
                role="option"
                // `option` is outside React Native's `Role` union, so the native side takes
                // `none` and the web `role` above is what the listbox actually owns.
                accessibilityRole="none"
                accessibilityLabel={optionText(option)}
                aria-label={optionText(option)}
                aria-selected={isSelected}
                accessibilityState={{ selected: isSelected, disabled: inert }}
                aria-disabled={inert}
                focusable={!inert}
                disabled={inert}
                onPress={() => {
                    choose(option, close);
                }}
                className={cx(
                    card
                        ? 'min-h-9 flex-row items-center gap-2 rounded-lg px-2.5 py-1.5'
                        : 'flex-row items-center gap-control-sm px-control-md',
                    // One line per option in a field's list, so a dense desk list shows twice the
                    // options a two-line row did. The phone keeps its 44px target.
                    card ? null : density === 'compact' ? 'h-control-xs' : 'min-h-touch py-2',
                    // The row under the pointer or the keyboard is lit, so the reader sees which
                    // one a press or Enter will take.
                    isSelected
                        ? 'bg-surface-brand-subtle'
                        : inert
                          ? null
                          : card
                            ? 'hover:bg-surface-brand-subtle focus:bg-surface-brand-subtle'
                            : 'hover:bg-surface-sunken focus:bg-surface-sunken',
                    inert ? 'opacity-50' : null,
                )}
            >
                {/* Fixed, so names align whether or not one is ticked. An action has no tick. */}
                {action ? null : (
                    <View className="w-icon-md">
                        {isSelected ? (
                            <Icon
                                name="check"
                                size="sm"
                                className={
                                    card ? 'text-surface-brand' : 'text-content-on-brand-subtle'
                                }
                            />
                        ) : null}
                    </View>
                )}
                {card ? (
                    // The card's row: the name, and its context on a second line under it.
                    <View className="min-w-0 flex-1 flex-col">
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'text-sm text-content-primary text-start',
                                isSelected ? 'font-bold' : 'font-medium',
                            )}
                        >
                            {optionText(option)}
                        </RNText>
                        {option.description === undefined ? null : (
                            <RNText
                                numberOfLines={1}
                                className="text-xs text-content-secondary text-start"
                            >
                                {option.description}
                            </RNText>
                        )}
                    </View>
                ) : (
                    // The field's row: the name takes what is left and truncates, the
                    // description keeps its own width at the row's end.
                    <>
                        <RNText
                            className={cx(
                                'min-w-0 flex-1 text-content-primary text-start',
                                textClass,
                            )}
                            numberOfLines={1}
                        >
                            {optionText(option)}
                        </RNText>
                        {option.description === undefined ? null : (
                            <RNText
                                className={cx(
                                    'shrink-0 text-content-secondary text-end',
                                    density === 'compact' ? 'text-role-caption' : 'text-xs',
                                )}
                                numberOfLines={1}
                            >
                                {option.description}
                            </RNText>
                        )}
                    </>
                )}
            </Pressable>
        );
    }

    /** The live count of what the filter left, spoken rather than drawn. */
    const searchStatus = (
        <RNText
            {...(testID === undefined ? {} : { testID: `${testID}-search-status` })}
            role="status"
            aria-live="polite"
            accessibilityLiveRegion="polite"
            className="absolute h-px w-px overflow-hidden opacity-0"
        >
            {statusText}
        </RNText>
    );

    const onSearchKey = ({ nativeEvent }: { readonly nativeEvent: { readonly key: string } }) => {
        // `Dropdown` closes on Escape; the trigger takes the focus back so the next Tab carries
        // on from it.
        if (nativeEvent.key === 'Escape') trigger.current?.focus();
    };

    /** The card's filter: a bordered box with the search glyph, as "Add an ingredient…" draws it. */
    const cardSearch = (close: () => void) => (
        <View className="shrink-0 pb-1">
            <View
                {...(testID === undefined ? {} : { testID: `${testID}-search` })}
                className="h-9 flex-row items-center gap-1.5 rounded-lg border border-stroke bg-surface-raised px-2.5"
            >
                <Icon name="search" size="sm" className="text-content-secondary" />
                <TextInput
                    {...(testID === undefined ? {} : { testID: `${testID}-search-input` })}
                    nativeID={searchId}
                    value={query}
                    onChangeText={setQuery}
                    placeholder={t('designSystem:select.searchPlaceholder')}
                    accessibilityLabel={t('designSystem:select.searchLabel')}
                    aria-label={t('designSystem:select.searchLabel')}
                    autoCapitalize="none"
                    autoCorrect={false}
                    onSubmitEditing={() => {
                        submitFirst(close);
                    }}
                    onKeyPress={onSearchKey}
                    className="min-w-0 flex-1 text-sm text-content-primary web:outline-none"
                />
            </View>
            {searchStatus}
            <FocusWhenPlaced targetId={searchId} />
        </View>
    );

    /** The field's filter, pinned over the list: the box stays put while the list scrolls. */
    const fieldSearch = (close: () => void) => (
        <View className="shrink-0 border-b border-stroke-subtle p-tight">
            <SearchInput
                {...(testID === undefined ? {} : { testID: `${testID}-search` })}
                label={t('designSystem:select.searchLabel')}
                placeholder={t('designSystem:select.searchPlaceholder')}
                size="xs"
                nativeID={searchId}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={() => {
                    submitFirst(close);
                }}
                onKeyPress={onSearchKey}
            />
            {searchStatus}
            <FocusWhenPlaced targetId={searchId} />
        </View>
    );

    const panel = ({ close }: DropdownRenderState) => {
        const list = !searchable ? (
            <ScrollView keyboardShouldPersistTaps="handled" className="min-h-0 shrink">
                {optionRows(close)}
            </ScrollView>
        ) : (
            <>
                {card ? cardSearch(close) : fieldSearch(close)}
                <ScrollView keyboardShouldPersistTaps="handled" className="min-h-0 shrink">
                    <View {...webRole('listbox')} aria-label={label}>
                        {optionRows(close)}
                    </View>
                </ScrollView>
            </>
        );
        // The card rises 8px as it opens, as every desk dropdown does.
        return card ? (
            <SlideIn
                edge="bottom"
                distance="small"
                duration="normal"
                className="min-h-0 shrink flex-col"
            >
                {list}
            </SlideIn>
        ) : (
            list
        );
    };

    const panelClassName = card
        ? cx(
              // A pill's card keeps its own width; a field's is the field's.
              pill ? 'w-[320px]' : 'w-full',
              'max-h-[360px] overflow-hidden !rounded-xl !shadow-elevation-bar p-1.5',
          )
        : // `w-full` rather than a min-width: an anchored panel shrinks to its content by default,
          // and a six-option list narrower than the field it belongs to reads as a tooltip.
          'w-full max-h-[320px] overflow-hidden';

    const dropdown = (
        renderTrigger: (state: DropdownRenderState) => ReactNode,
        wrapper?: string,
    ) => (
        <Dropdown
            role={searchable ? 'dialog' : 'listbox'}
            label={label}
            align={align}
            {...(testID === undefined ? {} : { testID: `${testID}-list` })}
            {...(wrapper === undefined ? {} : { className: wrapper })}
            panelClassName={panelClassName}
            /*
             * A closed panel has no query, whatever closed it — an outside press, Escape or a
             * choice. `onOpenChange` is the one notification that covers every route, and it fires
             * after commit, so setting state from it is not a cross-component update during
             * `Dropdown`'s render.
             */
            onOpenChange={(next) => {
                if (!next) setQuery('');
            }}
            trigger={renderTrigger}
        >
            {panel}
        </Dropdown>
    );

    if (pill) {
        // A scope set to anything but its first option ("All") fills soft green, so a narrowed
        // list shows from the toolbar alone. An action pill never does.
        const narrowed = !action && options[0] !== undefined && value !== options[0].value;
        return (
            <View
                className={cx('self-start', className)}
                {...(testID === undefined ? {} : { testID })}
            >
                {dropdown(({ triggerProps, toggle, open }) => {
                    const lit = open || narrowed;
                    const ink = lit ? 'text-content-on-brand-subtle' : 'text-content-primary';
                    return (
                        <Pressable
                            ref={trigger}
                            {...(testID === undefined ? {} : { testID: `${testID}-trigger` })}
                            {...(id === undefined ? {} : { nativeID: id })}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={accessibleName}
                            aria-label={accessibleName}
                            {...triggerProps}
                            accessibilityState={{ disabled, expanded: open }}
                            aria-disabled={disabled}
                            focusable={!disabled}
                            disabled={disabled}
                            onPress={toggle}
                            className={cx(
                                'h-desk-toolbar flex-row items-center gap-1.5 rounded-full border pe-2.5 ps-3 web:transition-colors',
                                lit
                                    ? 'border-stroke bg-surface-brand-subtle'
                                    : 'border-stroke-subtle bg-surface-raised hover:border-stroke hover:bg-surface-brand-subtle',
                                disabled ? 'opacity-50' : null,
                            )}
                        >
                            {action ? null : (
                                <RNText numberOfLines={1} className={cx('text-role-strong', ink)}>
                                    {label}
                                </RNText>
                            )}
                            <RNText
                                {...(testID === undefined ? {} : { testID: `${testID}-value` })}
                                numberOfLines={1}
                                className={cx(
                                    'min-w-0 shrink text-role-strong',
                                    action ? null : 'font-bold',
                                    ink,
                                )}
                            >
                                {displayText}
                            </RNText>
                            <View
                                aria-hidden
                                className={cx(
                                    'web:transition-transform',
                                    open ? 'rotate-180' : null,
                                )}
                            >
                                <Icon
                                    name="chevronDown"
                                    size="sm"
                                    className="text-content-secondary"
                                />
                            </View>
                        </Pressable>
                    );
                })}
            </View>
        );
    }

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
            // A unit list is a few letters: a narrow box, not a long empty one. 128px holds the
            // label above it and a short placeholder.
            {...(narrow || className !== undefined
                ? { className: cx(narrow ? 'w-32 max-w-full self-start' : null, className) }
                : {})}
            {...(testID === undefined ? {} : { testID })}
        >
            {(control: FieldControlProps) =>
                dropdown(({ triggerProps, toggle, open }) => (
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
                ))
            }
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
        // No document outside a browser (Jest renders this half under React Native's preset).
        if (typeof document === 'undefined') return undefined;
        const timer = setTimeout(() => {
            document.getElementById(targetId)?.focus();
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [targetId]);
    return null;
}
