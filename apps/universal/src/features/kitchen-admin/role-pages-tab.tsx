import { Badge, Callout, Inline, Text } from '@healthy360/design-system';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { applyExtra, applyPageLevel, pageSections, unmappedCodes } from './page-permissions.ts';
import type { PageLevel } from './page-permissions.ts';
import {
    MatrixBand,
    MatrixCell,
    MatrixFrame,
    MatrixHeader,
    MatrixNone,
    MatrixRow,
    MatrixSlot,
    matrixFloor,
} from './role-matrix.tsx';

/**
 * The Pages step — what a role can reach, said in screens rather than in codes, as a matrix.
 *
 * ```
 * Page                         No access    Can look     Can change    Also allowed
 * ─────────────────────────────────────────────────────────────────────────────────────
 * Orders                                                                          <- band
 * Order book                   [        ]  [        ]  [   ✓    ]    [✓ New sale]
 * Also opens: Calendar
 * ```
 *
 * A row per page under its sidebar section, a column per level. The three level cells of a row are
 * one pick-one group — pressing one moves the tick — and a page that has no Manage level draws a
 * dash in that column rather than a cell that could never be ticked. The three extras (New sale,
 * New customer, Unpriced receipts) are chips in the last column of the page they belong to.
 *
 * It holds no state of its own. The whole matrix is derived from the code set on every render,
 * which is what makes shared codes honest: eleven families are gated on
 * `catalogue.view_organisation`, so setting one of them moves the other ten, and the reader watches
 * the ticks move rather than discovering it after a save. Each row says what else it opens.
 *
 * The callout at the foot is the other half of that honesty. Twenty-odd codes — the publish three,
 * the customer-contact one, the own-scope six — are on no page and cannot be changed here. They are
 * listed rather than hidden, because a role editor that silently held something back would be
 * exactly as untrustworthy as one that silently dropped it.
 */

export interface RolePagesTabProps {
    readonly codes: ReadonlySet<string>;
    readonly onChange: (codes: ReadonlySet<string>) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

const LEVEL_COLUMNS: readonly PageLevel[] = ['none', 'view', 'manage'];

/** Also allowed holds named chips — up to two on one page — so it takes two tracks. */
const EXTRAS_WEIGHT = 2;

export function RolePagesTab({ codes, onChange, disabled = false, testID }: RolePagesTabProps) {
    const { t } = useTranslation();

    const sections = pageSections(codes);
    const unmapped = unmappedCodes(codes);

    // The level columns are one group, drawn the way each row draws its one `radiogroup`.
    const columns = [
        LEVEL_COLUMNS.map((level) => ({
            key: level,
            label: t(`accessAdmin:pages.levels.${level}` as never),
        })),
        { key: 'extras', label: t('accessAdmin:pages.columns.extras'), weight: EXTRAS_WEIGHT },
    ];

    return (
        <View testID={testID} className="z-auto flex-col gap-base">
            <MatrixFrame
                testID={`${testID}-matrix`}
                label={t('accessAdmin:pages.tableLabel')}
                floor={matrixFloor([...LEVEL_COLUMNS.map(() => 1), EXTRAS_WEIGHT])}
            >
                <MatrixHeader rowHeader={t('accessAdmin:pages.columns.page')} columns={columns} />

                {sections.map((section) => (
                    <Fragment key={section.group}>
                        <MatrixBand
                            testID={`${testID}-group-${section.group}`}
                            label={t(`kitchen:nav.groups.${section.group}` as never)}
                        />

                        {section.rows.map((row) => {
                            const rowTestID = `${testID}-${row.family.key}`;
                            const pageName = t(row.family.nameKey as never);

                            return (
                                <MatrixRow
                                    key={row.family.key}
                                    testID={rowTestID}
                                    title={pageName}
                                    caption={
                                        row.alsoOpens.length === 0 ? null : (
                                            <Text
                                                variant="caption"
                                                tone="secondary"
                                                testID={`${rowTestID}-also-opens`}
                                            >
                                                {t('accessAdmin:pages.alsoOpens', {
                                                    pages: row.alsoOpens
                                                        .map((sibling) =>
                                                            t(sibling.nameKey as never),
                                                        )
                                                        .join(', '),
                                                })}
                                            </Text>
                                        )
                                    }
                                >
                                    {/*
                                     * The three level slots are one radio group: the row's name is
                                     * the group's, and each cell announces "{page}: {level}".
                                     */}
                                    <View
                                        testID={`${rowTestID}-level`}
                                        role="radiogroup"
                                        accessibilityLabel={pageName}
                                        className="flex-row gap-tight"
                                        style={{ flex: LEVEL_COLUMNS.length }}
                                    >
                                        {LEVEL_COLUMNS.map((level) => (
                                            <MatrixSlot key={level}>
                                                {row.levels.includes(level) ? (
                                                    <MatrixCell
                                                        testID={`${rowTestID}-level-option-${level}`}
                                                        kind="radio"
                                                        on={row.level === level}
                                                        label={t('accessAdmin:pages.cellLabel', {
                                                            page: pageName,
                                                            level: t(
                                                                `accessAdmin:pages.levels.${level}` as never,
                                                            ),
                                                        })}
                                                        disabled={disabled}
                                                        onPress={() => {
                                                            if (row.level === level) return;
                                                            onChange(
                                                                applyPageLevel(
                                                                    codes,
                                                                    row.family,
                                                                    level,
                                                                ),
                                                            );
                                                        }}
                                                    />
                                                ) : (
                                                    <MatrixNone />
                                                )}
                                            </MatrixSlot>
                                        ))}
                                    </View>

                                    <MatrixSlot
                                        testID={`${rowTestID}-extras`}
                                        weight={EXTRAS_WEIGHT}
                                    >
                                        {row.extras.length === 0 ? (
                                            <MatrixNone />
                                        ) : (
                                            row.extras.map(({ extra, enabled }) => (
                                                <MatrixCell
                                                    key={extra.key}
                                                    testID={`${rowTestID}-extra-${extra.key}`}
                                                    kind="checkbox"
                                                    on={enabled}
                                                    word={t(extra.nameKey as never)}
                                                    label={t(extra.nameKey as never)}
                                                    disabled={disabled}
                                                    onPress={() => {
                                                        onChange(
                                                            applyExtra(codes, extra, !enabled),
                                                        );
                                                    }}
                                                />
                                            ))
                                        )}
                                    </MatrixSlot>
                                </MatrixRow>
                            );
                        })}
                    </Fragment>
                ))}
            </MatrixFrame>

            {unmapped.length === 0 ? null : (
                <Callout
                    testID={`${testID}-unmapped`}
                    tone="info"
                    title={t('accessAdmin:pages.unmappedHeading')}
                    body={t('accessAdmin:pages.unmappedHint')}
                >
                    <Inline space="xs" align="center" wrap>
                        <Text variant="caption" testID={`${testID}-unmapped-count`}>
                            {t('accessAdmin:pages.unmappedCount', { count: unmapped.length })}
                        </Text>
                        {unmapped.map((code) => (
                            <Badge
                                key={code}
                                variant="label"
                                tone="neutral"
                                icon={null}
                                testID={`${testID}-unmapped-${code}`}
                                label={t(`accessAdmin:codes.${code}.name` as never, {
                                    defaultValue: code,
                                })}
                            />
                        ))}
                    </Inline>
                </Callout>
            )}
        </View>
    );
}
