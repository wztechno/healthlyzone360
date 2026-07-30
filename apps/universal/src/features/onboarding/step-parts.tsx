import { Card, FilterChip, Heading, Icon, Inline, Stack, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The small pieces every step is built from.
 *
 * They exist to make twenty-two steps look like one product rather than twenty-two designers'
 * weekends: one heading rhythm, one way of explaining an option set, one way of rendering a group
 * of toggles. Nothing here holds state and nothing here reads a repository.
 */

export interface StepIntroProps {
    readonly title: string;
    /** One or two sentences. The step's whole reason for existing, in the person's terms. */
    readonly lead?: string | undefined;
    readonly testID: string;
}

export function StepIntro({ title, lead, testID }: StepIntroProps) {
    return (
        <Stack space="xs">
            <Heading level={2} testID={`${testID}-title`}>
                {title}
            </Heading>
            {lead === undefined ? null : (
                <Text tone="secondary" testID={`${testID}-lead`}>
                    {lead}
                </Text>
            )}
        </Stack>
    );
}

export interface GuideEntry {
    readonly key: string;
    readonly label: string;
    readonly description: string;
}

export interface OptionGuideProps {
    readonly title: string;
    readonly entries: readonly GuideEntry[];
    /** Marks the entry the person has chosen, so the guide doubles as a confirmation. */
    readonly selectedKey?: string | null | undefined;
    readonly testID: string;
}

/**
 * The plain-language guide that sits beside an option set.
 *
 * Doc 17, ONB-06 is explicit that an activity level must never be presented as a bare multiplier,
 * and the same argument applies to a goal or a pace: the label is a handle, and the sentence is
 * what a person actually chooses on. Putting the sentences adjacent rather than behind a tooltip is
 * the reference research's observation (doc 05, ETF-21) and costs nothing on any viewport.
 *
 * The selected entry is marked with a glyph as well as an emphasis, because a marker carried by
 * weight alone is a marker carried by rendering, and rendering is not something a screen reader
 * announces.
 */
export function OptionGuide({ title, entries, selectedKey, testID }: OptionGuideProps) {
    return (
        <Card padding="md" tone="sunken" testID={testID}>
            <Stack space="sm">
                <Text variant="label">{title}</Text>
                {entries.map((entry) => {
                    const selected = selectedKey === entry.key;
                    return (
                        <Stack space="none" key={entry.key} testID={`${testID}-${entry.key}`}>
                            <Inline space="xs" align="center">
                                <Icon
                                    name={selected ? 'check' : 'dotOutline'}
                                    size="sm"
                                    className={
                                        selected ? 'text-content-primary' : 'text-content-secondary'
                                    }
                                />
                                <Text variant={selected ? 'bodyStrong' : 'body'}>
                                    {entry.label}
                                </Text>
                            </Inline>
                            <Text variant="caption" tone="secondary">
                                {entry.description}
                            </Text>
                        </Stack>
                    );
                })}
            </Stack>
        </Card>
    );
}

export interface ChipOption {
    readonly code: string;
    readonly label: string;
}

export interface ChipGroupProps {
    /** Accessible name for the group. A group of toggles without one is an unnamed region. */
    readonly label: string;
    readonly hint?: string | undefined;
    readonly options: readonly ChipOption[];
    readonly selected: readonly string[];
    readonly onToggle: (code: string) => void;
    /** Rendered when the group has no selection — "no allergies recorded". */
    readonly emptyLabel?: string | undefined;
    readonly testID: string;
}

/**
 * A labelled group of toggle chips.
 *
 * `role="group"` with a name rather than a listbox or a set of checkboxes: `FilterChip` is already
 * a toggle button that announces `aria-pressed` on the web and `accessibilityState.selected` on
 * native, and wrapping toggle buttons in a named group is the pattern axe accepts without argument.
 * A `role="listbox"` would need owned options and active-descendant tracking to be valid, for no
 * gain over a group of buttons a person can Tab through.
 */
export function ChipGroup({
    label,
    hint,
    options,
    selected,
    onToggle,
    emptyLabel,
    testID,
}: ChipGroupProps) {
    return (
        <Stack space="xs" testID={testID}>
            <Text variant="label" testID={`${testID}-label`}>
                {label}
            </Text>
            {hint === undefined ? null : (
                <Text variant="caption" tone="secondary">
                    {hint}
                </Text>
            )}
            {/*
             * `role` without `accessibilityRole`: React Native's `AccessibilityRole` union has no
             * `group` member, while the newer `role` prop does and maps to it on every platform.
             * Passing only the one that exists is what keeps this typechecking and announcing.
             */}
            <View role="group" aria-label={label} accessibilityLabel={label}>
                <Inline space="xs" wrap>
                    {options.map((option) => (
                        <FilterChip
                            key={option.code}
                            testID={`${testID}-${option.code}`}
                            label={option.label}
                            selected={selected.includes(option.code)}
                            onChange={() => {
                                onToggle(option.code);
                            }}
                        />
                    ))}
                </Inline>
            </View>
            {selected.length === 0 && emptyLabel !== undefined ? (
                <Text variant="caption" tone="secondary" testID={`${testID}-empty`}>
                    {emptyLabel}
                </Text>
            ) : null}
        </Stack>
    );
}

export interface StepRowProps {
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}

/** A pair of controls that belong together — feet and inches, meals and snacks. */
export function StepRow({ children, testID }: StepRowProps) {
    return (
        <Inline space="sm" align="start" testID={testID}>
            {children}
        </Inline>
    );
}
