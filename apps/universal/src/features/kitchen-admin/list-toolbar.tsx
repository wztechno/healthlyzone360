import type { PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Button,
    FilterChip,
    Icon,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { statusKey } from './format.ts';

/**
 * The controls above every admin list: search, statuses, one taxonomy filter and the create button.
 *
 * ## Statuses are chips and the taxonomy is a select, on purpose
 *
 * There are four statuses and they are the filter people reach for constantly — "show me what is
 * still a draft" is the question an admin list exists to answer — so they are visible, toggleable
 * and multi-select. A category list is dozens of codes nobody has memorised, which is a search
 * problem rather than a toggling one, and `Select.searchable` is the component that solves it.
 *
 * ## The taxonomy slot is named by its caller, and may be absent
 *
 * "Category" is the ingredient list's word. The recipe list narrows by *kitchen* instead, because
 * that is the taxonomy `RecipeAdminFilter` actually publishes, and a family with no second axis at
 * all omits the control rather than rendering an empty picker. So the label travels with the
 * options: a toolbar that hard-coded one family's noun would force the next slice either to lie or
 * to fork the component.
 *
 * ## Fully controlled, and it holds nothing
 *
 * The toolbar draws affordances and reports intent; every value lives in the screen, which is what
 * lets the screen put the same values into a query key. A toolbar with its own state would
 * eventually disagree with the request that was actually sent.
 */

export interface ListToolbarProps {
    readonly query: string;
    readonly onQueryChange: (query: string) => void;
    readonly statuses: readonly PublishableStatus[];
    readonly onStatusesChange: (statuses: readonly PublishableStatus[]) => void;
    /** The statuses offered as chips, in lifecycle order. */
    readonly statusOptions: readonly PublishableStatus[];
    /** Omit to render no taxonomy filter at all — see the note above. */
    readonly categoryOptions?: readonly SelectOption[] | undefined;
    /** `null` means "every category". */
    readonly category?: string | null | undefined;
    readonly onCategoryChange?: ((category: string | null) => void) | undefined;
    /** The taxonomy's own noun. Defaults to the ingredient list's "Category". */
    readonly categoryLabel?: string | undefined;
    /** The "no filter" option's label. Defaults to the ingredient list's "All categories". */
    readonly categoryAllLabel?: string | undefined;
    readonly createLabel: string;
    readonly onCreate?: (() => void) | undefined;
    /** Rendered under the controls; the screen supplies the already-pluralised sentence. */
    readonly resultSummary?: string | undefined;
    readonly testID: string;
}

/** The option value that stands for "no category filter". Never a real code. */
export const ANY_CATEGORY = '__any__';

export function ListToolbar({
    query,
    onQueryChange,
    statuses,
    onStatusesChange,
    statusOptions,
    categoryOptions,
    category = null,
    onCategoryChange,
    categoryLabel,
    categoryAllLabel,
    createLabel,
    onCreate,
    resultSummary,
    testID,
}: ListToolbarProps) {
    const { t } = useTranslation();

    const toggle = (status: PublishableStatus, selected: boolean) => {
        onStatusesChange(
            selected ? [...statuses, status] : statuses.filter((entry) => entry !== status),
        );
    };

    return (
        <View
            testID={testID}
            className="rounded-panel border border-brand-100 bg-surface-raised p-3 shadow-elevation-1 md:p-4"
        >
            <Stack space="sm">
            <TextInputField
                testID={`${testID}-search`}
                id={`${testID}-search`}
                label={t('kitchen:toolbar.searchLabel')}
                placeholder={t('kitchen:toolbar.searchPlaceholder')}
                value={query}
                onChangeText={onQueryChange}
                autoCapitalize="none"
                autoCorrect={false}
                inputMode="search"
                returnKeyType="search"
                trailing={<Icon name="search" />}
            />

            <Stack space="xs">
                <Text variant="label" testID={`${testID}-status-label`}>
                    {t('kitchen:toolbar.statusLabel')}
                </Text>
                <Inline space="xs" wrap testID={`${testID}-status`}>
                    {statusOptions.map((status) => (
                        <FilterChip
                            key={status}
                            testID={`${testID}-status-${status}`}
                            label={t(statusKey(status))}
                            selected={statuses.includes(status)}
                            onChange={(selected) => {
                                toggle(status, selected);
                            }}
                        />
                    ))}
                </Inline>
            </Stack>

            {categoryOptions === undefined || onCategoryChange === undefined ? null : (
                <Select
                    testID={`${testID}-category`}
                    id={`${testID}-category`}
                    label={categoryLabel ?? t('kitchen:toolbar.categoryLabel')}
                    searchable
                    value={category ?? ANY_CATEGORY}
                    onChange={(next) => {
                        onCategoryChange(next === ANY_CATEGORY ? null : next);
                    }}
                    options={[
                        {
                            value: ANY_CATEGORY,
                            label: categoryAllLabel ?? t('kitchen:toolbar.categoryAll'),
                        },
                        ...categoryOptions,
                    ]}
                />
            )}

            {/*
              * One row, sharing a baseline: the count sits with the controls rather than in a
              * paragraph of its own below them, and the create button is the trailing primary —
              * this area's core-loop action (§4, Rule 4). It is the same shape as the marketplace
              * `ToolbarRow`, expressed against this component's own props.
              */}
            <Inline space="sm" align="center" wrap>
                {resultSummary === undefined ? null : (
                    <Text
                        testID={`${testID}-result-summary`}
                        role="status"
                        aria-live="polite"
                        className="font-display text-sm text-content-primary"
                    >
                        {resultSummary}
                    </Text>
                )}
                <View className="grow" />
                {onCreate === undefined ? null : (
                    <Button
                        testID={`${testID}-create`}
                        label={createLabel}
                        iconStart={<Icon name="plus" />}
                        onPress={onCreate}
                    />
                )}
            </Inline>
            </Stack>
        </View>
    );
}
