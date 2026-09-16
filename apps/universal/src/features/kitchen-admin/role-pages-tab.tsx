import { Card, Heading, Inline, SegmentedControl, Stack, Text } from '@healthy360/design-system';
import { Checkbox } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import type { PageExtra, EntityFamily } from './entity-registry.ts';
import { applyExtra, applyPageLevel, pageSections, unmappedCodes } from './page-permissions.ts';
import type { PageLevel } from './page-permissions.ts';

/**
 * The Pages tab — what a role can reach, said in screens rather than in codes.
 *
 * It holds no state of its own. The whole grid is derived from the code set on every render, which
 * is what makes shared codes honest: eleven families are gated on
 * `catalogue.view_organisation`, so setting one of them moves the other ten, and the reader watches
 * it happen rather than discovering it after a save. Each row says what else it opens.
 *
 * The band at the foot is the other half of that honesty. Twenty-odd codes — the publish three, the
 * customer-contact one, the own-scope six — are on no page and cannot be changed here. They are
 * listed rather than hidden, because a role editor that silently held something back would be
 * exactly as untrustworthy as one that silently dropped it.
 */

export interface RolePagesTabProps {
    readonly codes: ReadonlySet<string>;
    readonly onChange: (codes: ReadonlySet<string>) => void;
    readonly disabled?: boolean | undefined;
    readonly testID: string;
}

export function RolePagesTab({ codes, onChange, disabled = false, testID }: RolePagesTabProps) {
    const { t } = useTranslation();

    const sections = pageSections(codes);
    const unmapped = unmappedCodes(codes);

    return (
        <Stack space="lg" testID={testID}>
            <Text tone="secondary">{t('accessAdmin:pages.hint')}</Text>

            {sections.map((section) => (
                <Card key={section.group} padding="md" testID={`${testID}-group-${section.group}`}>
                    <Stack space="md">
                        <Heading level={3}>{t(`kitchen:nav.groups.${section.group}` as never)}</Heading>

                        {section.rows.map((row) => (
                            <PageRowControl
                                key={row.family.key}
                                testID={testID}
                                family={row.family}
                                level={row.level}
                                levels={row.levels}
                                alsoOpens={row.alsoOpens}
                                extras={row.extras}
                                disabled={disabled}
                                onLevel={(level) => {
                                    onChange(applyPageLevel(codes, row.family, level));
                                }}
                                onExtra={(extra, enabled) => {
                                    onChange(applyExtra(codes, extra, enabled));
                                }}
                            />
                        ))}
                    </Stack>
                </Card>
            ))}

            {unmapped.length === 0 ? null : (
                <Card padding="md" testID={`${testID}-unmapped`}>
                    <Stack space="sm">
                        <Heading level={3}>{t('accessAdmin:pages.unmappedHeading')}</Heading>
                        <Text tone="secondary">{t('accessAdmin:pages.unmappedHint')}</Text>
                        <Text testID={`${testID}-unmapped-count`}>
                            {t('accessAdmin:pages.unmappedCount', { count: unmapped.length })}
                        </Text>
                        <Inline space="xs" wrap>
                            {unmapped.map((code) => (
                                <Text
                                    key={code}
                                    variant="caption"
                                    tone="secondary"
                                    testID={`${testID}-unmapped-${code}`}
                                >
                                    {t(`accessAdmin:codes.${code}.name` as never, {
                                        defaultValue: code,
                                    })}
                                </Text>
                            ))}
                        </Inline>
                    </Stack>
                </Card>
            )}
        </Stack>
    );
}

interface PageRowControlProps {
    readonly testID: string;
    readonly family: EntityFamily;
    readonly level: PageLevel;
    readonly levels: readonly PageLevel[];
    readonly alsoOpens: readonly EntityFamily[];
    readonly extras: readonly { readonly extra: PageExtra; readonly enabled: boolean }[];
    readonly disabled: boolean;
    readonly onLevel: (level: PageLevel) => void;
    readonly onExtra: (extra: PageExtra, enabled: boolean) => void;
}

function PageRowControl({
    testID,
    family,
    level,
    levels,
    alsoOpens,
    extras,
    disabled,
    onLevel,
    onExtra,
}: PageRowControlProps) {
    const { t } = useTranslation();
    const rowTestID = `${testID}-${family.key}`;

    return (
        <Stack space="xs" testID={rowTestID}>
            <Inline space="sm" align="center" justify="between" wrap>
                <Stack space="none">
                    <Text variant="bodyStrong" testID={`${rowTestID}-name`}>
                        {t(family.nameKey as never)}
                    </Text>
                    {alsoOpens.length === 0 ? null : (
                        <Text variant="caption" tone="secondary" testID={`${rowTestID}-also-opens`}>
                            {t('accessAdmin:pages.alsoOpens', {
                                pages: alsoOpens
                                    .map((sibling) => t(sibling.nameKey as never))
                                    .join(', '),
                            })}
                        </Text>
                    )}
                </Stack>

                {/*
                 * `SegmentedControl` rather than radios: the design system has no radio, and the
                 * three levels are mutually exclusive positions on one scale rather than a list of
                 * independent choices.
                 */}
                <SegmentedControl<PageLevel>
                    testID={`${rowTestID}-level`}
                    label={t(family.nameKey as never)}
                    items={levels.map((value) => ({
                        value,
                        label: t(`accessAdmin:pages.levels.${value}` as never),
                        disabled,
                        testID: `${rowTestID}-level-option-${value}`,
                    }))}
                    value={level}
                    onChange={onLevel}
                />
            </Inline>

            {extras.map(({ extra, enabled }) => (
                <Checkbox
                    key={extra.key}
                    testID={`${rowTestID}-extra-${extra.key}`}
                    label={t(extra.nameKey as never)}
                    checked={enabled}
                    disabled={disabled}
                    onChange={(on) => {
                        onExtra(extra, on);
                    }}
                />
            ))}
        </Stack>
    );
}
