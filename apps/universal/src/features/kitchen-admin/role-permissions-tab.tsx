import type { PermissionDomain } from '@healthy360/api-client/contracts';
import { Icon, Inline, Text } from '@healthy360/design-system';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    MatrixCell,
    MatrixFrame,
    MatrixHeader,
    MatrixNone,
    MatrixRow,
    MatrixSlot,
    matrixFloor,
} from './role-matrix.tsx';

/**
 * The Advanced step — every code a role can hold, as a matrix of area × action.
 *
 * ```
 * Area            View      Manage     Publish    See costs    Other
 * ────────────────────────────────────────────────────────────────────────────────────
 * Recipe          [ ✓ ]     [    ]     [    ]     [ ✓ ⚠ ]      —
 * Order           [ ✓ ]     [ ✓  ]     —          —            [✓ Create on behalf] [Customer contact]
 * ```
 *
 * ## Why these columns
 *
 * A code is `{resource}.{action}_{scope}`. Four actions recur across areas — view, manage, publish,
 * view costs — and each is a column, so "who can see costs anywhere" is one glance down. The rest
 * occur once or twice (`invite`, `order_supplies`, `create_on_behalf`, `revoke`…); a column each
 * would be a matrix of dashes, so they are named chips in the last column instead. An area with two
 * codes for one column — the same action at two scopes — keeps the first in the column and the other
 * as a chip, so nothing is ever dropped to fit the grid.
 *
 * ## It shows a code the administrator does not hold, marked rather than hidden
 *
 * Role management on this platform is total: whoever may edit roles may grant any organisation code,
 * including ones they cannot exercise themselves. That was a deliberate call, and `heldByCaller` is
 * what keeps it an informed one — the cell carries a warning mark, and the legend above says what it
 * means. Hiding those cells would have made the step lie about what a role could hold; disabling
 * them would have made the product refuse something the server permits.
 *
 * ## Grouped by the server's `domain`, not by a prefix of the code
 *
 * `permissions.domain` is a column the backend seeds from its own registry. Deriving the rows here
 * from the text before the dot would be the same grouping computed twice, and would disagree the
 * first time a domain and a prefix differed.
 *
 * ## The label falls back to the server's description
 *
 * A code this client has no string for is announced — and, as a chip, drawn — with the English text
 * the API sent, not as a blank. A permission added on the backend tomorrow is grantable today.
 */

export interface RolePermissionsTabProps {
    readonly domains: readonly PermissionDomain[];
    readonly codes: ReadonlySet<string>;
    readonly onChange: (codes: ReadonlySet<string>) => void;
    readonly disabled?: boolean | undefined;
    /**
     * Reports instead of edits — the team member's "what that adds up to". Draws no legend and no
     * count, and its cells cannot be pressed. `domains` is then just what the person holds.
     */
    readonly readOnly?: boolean | undefined;
    readonly testID: string;
}

type ActionColumn = 'view' | 'manage' | 'publish' | 'view_costs';

const ACTION_COLUMNS: readonly ActionColumn[] = ['view', 'manage', 'publish', 'view_costs'];

const ACTION_LABEL_KEYS: Readonly<Record<ActionColumn, string>> = {
    view: 'accessAdmin:advanced.actions.view',
    manage: 'accessAdmin:advanced.actions.manage',
    publish: 'accessAdmin:advanced.actions.publish',
    view_costs: 'accessAdmin:advanced.actions.viewCosts',
};

/** Other holds a chip per rarer action, named in full — the widest column by far. */
const OTHER_WEIGHT = 3;

/** The scopes a code can end in (`PermissionRegistry`). The action is what sits before one. */
const SCOPE_SUFFIX = /_(organisation|own|current|platform)$/;

interface Permission {
    readonly code: string;
    readonly description: string;
    readonly heldByCaller: boolean;
}

interface AreaRow {
    readonly domain: string;
    readonly cells: Readonly<Partial<Record<ActionColumn, Permission>>>;
    readonly others: readonly Permission[];
}

function actionOf(code: string): string {
    const dot = code.indexOf('.');
    return (dot < 0 ? code : code.slice(dot + 1)).replace(SCOPE_SUFFIX, '');
}

function isActionColumn(action: string): action is ActionColumn {
    return (ACTION_COLUMNS as readonly string[]).includes(action);
}

/** `price_list` → `Price list`: the server's domain, set as a row name. */
function areaName(domain: string): string {
    const words = domain.replace(/_/g, ' ');
    return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

export function RolePermissionsTab({
    domains,
    codes,
    onChange,
    disabled = false,
    readOnly = false,
    testID,
}: RolePermissionsTabProps) {
    const { t } = useTranslation();

    const rows = useMemo<readonly AreaRow[]>(
        () =>
            domains.map((domain) => {
                const cells: Partial<Record<ActionColumn, Permission>> = {};
                const others: Permission[] = [];
                for (const permission of domain.permissions) {
                    const action = actionOf(permission.code);
                    if (isActionColumn(action) && cells[action] === undefined) {
                        cells[action] = permission;
                    } else {
                        others.push(permission);
                    }
                }
                return { domain: domain.domain, cells, others };
            }),
        [domains],
    );

    const total = domains.reduce((count, domain) => count + domain.permissions.length, 0);
    const selected = domains.reduce(
        (count, domain) =>
            count + domain.permissions.filter((permission) => codes.has(permission.code)).length,
        0,
    );

    const nameOf = (permission: Permission) =>
        t(`accessAdmin:codes.${permission.code}.name` as never, {
            defaultValue: permission.description,
        });

    function toggle(code: string) {
        const next = new Set(codes);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        onChange(next);
    }

    function cell(area: string, permission: Permission, word?: string) {
        const notHeld = !permission.heldByCaller;
        return (
            <MatrixCell
                key={permission.code}
                testID={`${testID}-code-${permission.code}`}
                kind="checkbox"
                on={codes.has(permission.code)}
                word={word}
                label={[
                    t('accessAdmin:advanced.cellLabel', {
                        area,
                        permission: nameOf(permission),
                    }),
                    ...(notHeld ? [t('accessAdmin:advanced.notHeld')] : []),
                ].join('. ')}
                marker={
                    notHeld ? (
                        // The id is on a wrapper: `Icon` draws a glyph and does not carry one.
                        <View testID={`${testID}-not-held-${permission.code}`}>
                            <Icon name="warning" size="sm" className="text-warning-on-subtle" />
                        </View>
                    ) : null
                }
                disabled={disabled}
                readOnly={readOnly}
                onPress={() => {
                    toggle(permission.code);
                }}
            />
        );
    }

    const columns = [
        ...ACTION_COLUMNS.map((action) => ({
            key: action,
            label: t(ACTION_LABEL_KEYS[action] as never),
        })),
        { key: 'other', label: t('accessAdmin:advanced.actions.other'), weight: OTHER_WEIGHT },
    ];

    return (
        <View testID={testID} className="z-auto flex-col gap-base">
            {readOnly ? null : (
                <Inline space="sm" align="center" justify="between" wrap>
                    <Inline space="xs" align="center" testID={`${testID}-legend`}>
                        <Icon name="warning" size="sm" className="text-warning-on-subtle" />
                        <Text variant="caption" tone="secondary">
                            {t('accessAdmin:advanced.notHeld')}
                        </Text>
                    </Inline>
                    <Text variant="mono" tone="secondary" testID={`${testID}-selected`}>
                        {t('accessAdmin:advanced.selected', { count: selected, total })}
                    </Text>
                </Inline>
            )}

            <MatrixFrame
                testID={`${testID}-matrix`}
                label={t('accessAdmin:advanced.tableLabel')}
                floor={matrixFloor([...ACTION_COLUMNS.map(() => 1), OTHER_WEIGHT])}
            >
                <MatrixHeader
                    rowHeader={t('accessAdmin:advanced.columns.area')}
                    columns={columns}
                />

                {rows.map((row) => {
                    const area = areaName(row.domain);
                    return (
                        <MatrixRow
                            key={row.domain}
                            testID={`${testID}-domain-${row.domain}`}
                            title={area}
                        >
                            {ACTION_COLUMNS.map((action) => {
                                const permission = row.cells[action];
                                return (
                                    <MatrixSlot key={action}>
                                        {permission === undefined ? (
                                            <MatrixNone />
                                        ) : (
                                            cell(area, permission)
                                        )}
                                    </MatrixSlot>
                                );
                            })}
                            <MatrixSlot weight={OTHER_WEIGHT}>
                                {row.others.length === 0 ? (
                                    <MatrixNone />
                                ) : (
                                    row.others.map((permission) =>
                                        cell(area, permission, nameOf(permission)),
                                    )
                                )}
                            </MatrixSlot>
                        </MatrixRow>
                    );
                })}
            </MatrixFrame>
        </View>
    );
}
