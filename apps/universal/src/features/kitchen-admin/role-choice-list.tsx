import type { OrganisationRoleSummary } from '@healthy360/api-client/contracts';
import {
    Badge,
    DATA_LIST_HEADER_TEXT,
    Icon,
    Text,
    cx,
    useBreakpoint,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

/**
 * The kitchen's roles as a list to choose from — the Add user form's Role step and the team
 * member's Roles step.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────────────────────┐
 * │ [✓]  Evening counter                                   Standard   3 permissions │
 * │      Works the till after five.                                                │
 * │ [ ]  Kitchen manager                                              28 permissions │
 * └──────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## One person, several roles — except in an invitation
 *
 * A membership holds a *set* of roles (`PUT …/roles` takes the whole set, and a person holding two
 * may do what either allows), and a login created here takes a list too. An invitation is the one
 * exception: the endpoint carries a single `role_code`, and the invitee is given more once they have
 * joined. So the list is `multiple` everywhere except the invitation, where it is `single` — the same
 * rows, a round mark instead of a square, and choosing one moves the mark.
 *
 * ## Drawn as a kitchen table
 *
 * `CatalogueList`'s frame and quiet header — Role, Type, Permissions — and rows split by a
 * hairline, with the hover tint; a chosen row keeps the brand tint. Below `md` the Type and
 * Permissions tracks fold under the role's name, so the name keeps the row's width on a phone.
 *
 * A list rather than a dropdown because a role is chosen by what it is for: each row carries its
 * description and how much it grants, which a closed select would hide until it was opened.
 *
 * Each row is the control — there is nothing else to press inside it — so it is a `radio` or a
 * `checkbox` itself rather than a row wrapping one, which would be nested-interactive.
 */

export interface RoleChoiceListProps {
    readonly roles: readonly OrganisationRoleSummary[];
    readonly selected: ReadonlySet<string>;
    readonly mode: 'single' | 'multiple';
    readonly onChange: (selected: ReadonlySet<string>) => void;
    /** The group's accessible name. */
    readonly label: string;
    readonly disabled?: boolean | undefined;
    /** Under a row's description — "Not in effect yet" on a scheduled assignment. */
    readonly noteFor?: ((roleId: string) => string | null) | undefined;
    /** Drawn under the list, and marks it invalid. */
    readonly error?: string | undefined;
    /** The element id a `FormIssueBanner` chip scrolls to (`focusField`). */
    readonly id?: string | undefined;
    /** The list. */
    readonly testID: string;
    /** Each row is `{itemTestID}-{role.code}`. */
    readonly itemTestID: string;
}

/** `CatalogueList`'s panel — the frame every kitchen table sits in. */
const PANEL = 'flex-col overflow-hidden rounded-panel border bg-surface-raised shadow-elevation-1';

/** The mark's track, so the header's Role label sits over the row's name. */
const MARK_TRACK = 'w-4';
/** The two trailing tracks, fixed so the header labels stand over their values. */
const KIND_TRACK = 'w-24';
const COUNT_TRACK = 'w-32';

export function RoleChoiceList({
    roles,
    selected,
    mode,
    onChange,
    label,
    disabled = false,
    noteFor,
    error,
    id,
    testID,
    itemTestID,
}: RoleChoiceListProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const arabic = locale.startsWith('ar');
    const kind = mode === 'single' ? 'radio' : 'checkbox';
    const wide = useBreakpoint().atLeast('md');

    function press(roleId: string) {
        if (mode === 'single') {
            onChange(new Set([roleId]));
            return;
        }
        const next = new Set(selected);
        if (next.has(roleId)) next.delete(roleId);
        else next.add(roleId);
        onChange(next);
    }

    return (
        <View className="flex-col gap-tight">
            <View
                testID={testID}
                nativeID={id}
                role={mode === 'single' ? 'radiogroup' : 'group'}
                accessibilityLabel={label}
                className={cx(
                    PANEL,
                    error === undefined ? 'border-stroke-subtle' : 'border-danger-border',
                )}
            >
                {/* `DataList`'s quiet header: the table's one firm rule. */}
                <View className="min-h-row-sm flex-row items-center gap-base border-b-[1.5px] border-stroke bg-surface-raised px-control-md">
                    <View className={MARK_TRACK} />
                    <RNText className={cx(DATA_LIST_HEADER_TEXT, 'flex-1 text-start')}>
                        {t('accessAdmin:roles.columns.role')}
                    </RNText>
                    {wide ? (
                        <>
                            <RNText className={cx(DATA_LIST_HEADER_TEXT, KIND_TRACK, 'text-start')}>
                                {t('accessAdmin:roles.columns.kind')}
                            </RNText>
                            <RNText className={cx(DATA_LIST_HEADER_TEXT, COUNT_TRACK, 'text-end')}>
                                {t('accessAdmin:roles.columns.pages')}
                            </RNText>
                        </>
                    ) : null}
                </View>

                {roles.map((role) => {
                    const roleId = String(role.id);
                    const on = selected.has(roleId);
                    const name = arabic ? role.nameAr : role.nameEn;
                    const description = arabic ? role.descriptionAr : role.descriptionEn;
                    const note = noteFor?.(roleId) ?? null;
                    const badge = (
                        <Badge
                            variant="label"
                            tone={role.isSystem ? 'neutral' : 'brand'}
                            icon={null}
                            label={t(
                                role.isSystem
                                    ? 'accessAdmin:roles.kindTemplate'
                                    : 'accessAdmin:roles.kindOwn',
                            )}
                        />
                    );
                    const count = (
                        <Text
                            variant="mono"
                            tone="secondary"
                            align={wide ? 'end' : 'start'}
                            className={wide ? COUNT_TRACK : undefined}
                        >
                            {t('accessAdmin:roles.permissionCount', {
                                count: role.permissionCount,
                            })}
                        </Text>
                    );

                    return (
                        <Pressable
                            key={roleId}
                            testID={`${itemTestID}-${role.code}`}
                            role={kind}
                            accessibilityRole={kind}
                            accessibilityLabel={name}
                            aria-label={name}
                            aria-checked={on}
                            accessibilityState={{ checked: on, disabled }}
                            disabled={disabled}
                            onPress={() => {
                                press(roleId);
                            }}
                            className={cx(
                                'min-h-row-md flex-row items-center gap-base border-b border-stroke-subtle px-control-md py-tight',
                                on ? 'bg-surface-brand-subtle' : 'web:hover:bg-surface-sunken',
                                disabled ? 'opacity-50' : null,
                            )}
                        >
                            {/* The mark: square for several, round for one. */}
                            <View
                                className={cx(
                                    'h-4 items-center justify-center border',
                                    MARK_TRACK,
                                    mode === 'single' ? 'rounded-full' : 'rounded-sm',
                                    on
                                        ? 'border-surface-brand bg-surface-brand'
                                        : 'border-stroke-strong bg-surface-raised',
                                )}
                            >
                                {on ? (
                                    <Icon
                                        name="check"
                                        size="sm"
                                        className="text-content-on-brand"
                                    />
                                ) : null}
                            </View>

                            <View className="min-w-0 flex-1 flex-col">
                                <Text variant="strong">{name}</Text>
                                {description === null || description === '' ? null : (
                                    <Text variant="caption" tone="secondary">
                                        {description}
                                    </Text>
                                )}
                                {note === null ? null : (
                                    <Text variant="caption" tone="warning">
                                        {note}
                                    </Text>
                                )}
                                {wide ? null : (
                                    <View className="mt-1 flex-row flex-wrap items-center gap-tight">
                                        {badge}
                                        {count}
                                    </View>
                                )}
                            </View>

                            {wide ? (
                                <>
                                    <View className={cx(KIND_TRACK, 'flex-row')}>{badge}</View>
                                    {count}
                                </>
                            ) : null}
                        </Pressable>
                    );
                })}
            </View>

            {error === undefined ? null : (
                <Text variant="caption" tone="danger" testID={`${testID}-error`}>
                    {error}
                </Text>
            )}
        </View>
    );
}
