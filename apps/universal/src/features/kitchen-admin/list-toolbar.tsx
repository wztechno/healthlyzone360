import type { PublishableStatus } from '@healthy360/api-client/contracts';
import {
    Collapse,
    FilterChip,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
    Icon,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ToolbarRow } from '../marketplace/toolbar-row.tsx';
import type { ActiveFilterChip } from '../marketplace/toolbar-row.tsx';
import { statusKey } from './format.ts';

/**
 * The controls above every admin list: one row — search, the Filters disclosure, the filters
 * currently in force as removable chips, and "Showing N of M" — with the status chips and the
 * taxonomy select inside the disclosure panel.
 *
 * ## One row, and where the old rows went
 *
 * This used to stack four rows deep; the kitchen handoff's acceptance check is one toolbar row.
 * The statuses and the taxonomy moved into a `Collapse` behind the Filters toggle — the same
 * arrangement `/meals` already uses — and what keeps an applied filter from becoming invisible is
 * the same thing that does there: every filter in force is a chip **on the row**, each one a
 * control that removes exactly the filter it names. The panel opens on arrival when a filter is
 * already applied.
 *
 * The create button is gone from here entirely: it is the page's primary and sits on the title
 * row of `KitchenPageHeader`, not among the filters.
 *
 * ## The taxonomy slot is named by its caller, and may be absent
 *
 * "Category" is the ingredient list's word. The recipe list narrows by *kitchen* instead, because
 * that is the taxonomy `RecipeAdminFilter` actually publishes, and a family with no second axis at
 * all omits the control rather than rendering an empty picker. So the label travels with the
 * options: a toolbar that hard-coded one family's noun would force the next slice either to lie or
 * to fork the component.
 *
 * ## Filter values stay in the screen; only the disclosure is local
 *
 * Every *value* still lives in the screen, which is what lets the screen put the same values into
 * a query key. The one piece of state held here is whether the panel is open — scenery, not
 * intent: it changes what is visible, never what is fetched.
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
    /** Rendered on the row's trailing edge; the screen supplies "Showing N of M" already formed. */
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
    resultSummary,
    testID,
}: ListToolbarProps) {
    const { t } = useTranslation();

    // Open on arrival with a filter applied, closed otherwise — the /meals behaviour. Initial-only
    // on purpose: once the person has opened or closed the panel, their choice stands.
    const [expanded, setExpanded] = useState(statuses.length > 0 || category !== null);

    const activeCount = statuses.length + (category === null ? 0 : 1);
    const panelId = `${testID}-filter-panel`;

    const categoryChipLabel = (code: string): string =>
        categoryOptions?.find((option) => option.value === code)?.label ?? code;

    const activeFilters: readonly ActiveFilterChip[] = [
        ...statuses.map((status) => ({
            key: `status-${status}`,
            label: t(statusKey(status)),
            removeLabel: t('kitchen:toolbar.removeFilter', { filter: t(statusKey(status)) }),
            onRemove: () => {
                onStatusesChange(statuses.filter((entry) => entry !== status));
            },
        })),
        ...(category === null || onCategoryChange === undefined
            ? []
            : [
                  {
                      key: 'category',
                      label: categoryChipLabel(category),
                      removeLabel: t('kitchen:toolbar.removeFilter', {
                          filter: categoryChipLabel(category),
                      }),
                      onRemove: () => {
                          onCategoryChange(null);
                      },
                  },
              ]),
    ];

    const toggle = (status: PublishableStatus, selected: boolean) => {
        onStatusesChange(
            selected ? [...statuses, status] : statuses.filter((entry) => entry !== status),
        );
    };

    return (
        <View testID={testID} className="gap-2">
            <ToolbarRow
                testID={`${testID}-row`}
                filtersTestID={`${testID}-filters`}
                countTestID={`${testID}-result-summary`}
                search={
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
                }
                filtersLabel={
                    activeCount === 0
                        ? t('kitchen:toolbar.filters')
                        : t('kitchen:toolbar.filtersActive', { n: activeCount })
                }
                filtersActive={activeCount}
                filtersExpanded={expanded}
                filtersPanelId={panelId}
                onToggleFilters={() => {
                    setExpanded((open) => !open);
                }}
                activeFilters={activeFilters}
                {...(activeFilters.length === 0
                    ? {}
                    : {
                          onClearAll: () => {
                              onStatusesChange([]);
                              onCategoryChange?.(null);
                          },
                          clearAllLabel: t('kitchen:toolbar.clearFilters'),
                      })}
                {...(resultSummary === undefined ? {} : { resultSummary })}
            />

            <Collapse open={expanded} nativeID={panelId} testID={panelId}>
                <View className="rounded-panel border border-brand-100 bg-surface-raised p-3 shadow-elevation-card md:p-4">
                    <Stack space="sm">
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
                    </Stack>
                </View>
            </Collapse>
        </View>
    );
}
