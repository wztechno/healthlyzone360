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
    readonly categoryOptions: readonly SelectOption[];
    /** `null` means "every category". */
    readonly category: string | null;
    readonly onCategoryChange: (category: string | null) => void;
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
    category,
    onCategoryChange,
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
        <Stack space="sm" testID={testID}>
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

            <Select
                testID={`${testID}-category`}
                id={`${testID}-category`}
                label={t('kitchen:toolbar.categoryLabel')}
                searchable
                value={category ?? ANY_CATEGORY}
                onChange={(next) => {
                    onCategoryChange(next === ANY_CATEGORY ? null : next);
                }}
                options={[
                    { value: ANY_CATEGORY, label: t('kitchen:toolbar.categoryAll') },
                    ...categoryOptions,
                ]}
            />

            <Inline space="sm" align="center" justify="between" wrap>
                <Stack space="none" grow>
                    {resultSummary === undefined ? null : (
                        <Text
                            testID={`${testID}-result-summary`}
                            tone="secondary"
                            variant="caption"
                            role="status"
                            aria-live="polite"
                        >
                            {resultSummary}
                        </Text>
                    )}
                </Stack>
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
    );
}
