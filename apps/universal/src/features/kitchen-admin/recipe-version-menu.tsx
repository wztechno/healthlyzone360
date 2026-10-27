import type { RecipeVersionSummary } from '@healthy360/api-client/contracts';
import { Badge, Button, Dropdown, Icon, InfoTip, Text, cx } from '@healthy360/design-system';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { statusKey, statusShortKey, statusTone } from './format.ts';

type VersionStatus = RecipeVersionSummary['status'];

/** The dot beside a status: amber for work in progress, green for what customers see. */
function dotClass(status: VersionStatus): string {
    if (status === 'published') return 'bg-success';
    if (status === 'retired') return 'bg-stroke-strong';
    return 'bg-warning';
}

/** Who sees a version — the question the old "Current"/"Viewing" badges left the reader to work out. */
function audienceKey(status: VersionStatus): string {
    if (status === 'published') return 'kitchen:recipes.versionAudienceLive';
    if (status === 'retired') return 'kitchen:recipes.versionAudienceRetired';
    return 'kitchen:recipes.versionAudienceDraft';
}

export interface RecipeVersionMenuProps {
    readonly versions: readonly RecipeVersionSummary[];
    /** The version on screen; `null` while creating, before there is one. */
    readonly selected: RecipeVersionSummary | null;
    /** `null` returns to the current version. */
    readonly onSelect: (id: RecipeVersionId | null) => void;
    /** Withdraw from the menu — offered only on a published recipe the reader may manage. */
    readonly onRetire?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

/**
 * The recipe's status as one chip beside its name — "● Draft v2 ⌄" — and its versions behind it.
 *
 * It replaces three header badges, the import id beside them and the Versions card on the
 * Description tab. Each version says, in words, who sees it: only the kitchen, or customers on the
 * menu. Viewing an older one is a choice made here; the header then says the page is read only and
 * offers the way back.
 */
export function RecipeVersionMenu({
    versions,
    selected,
    onSelect,
    onRetire,
    testID = 'kitchen-recipe-version-menu',
}: RecipeVersionMenuProps) {
    const { t } = useTranslation();
    const status: VersionStatus = selected?.status ?? 'draft';
    const label =
        selected === null
            ? t(statusShortKey('draft'))
            : t('kitchen:recipes.versionChip', {
                  status: t(statusShortKey(selected.status)),
                  number: selected.versionNumber,
              });

    return (
        <Dropdown
            testID={testID}
            role="dialog"
            label={t('kitchen:recipes.sectionVersions')}
            panelClassName="w-80"
            trigger={({ triggerProps, toggle }) => (
                <Pressable
                    {...triggerProps}
                    testID={`${testID}-trigger`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={`${t('kitchen:recipes.sectionVersions')}: ${label}`}
                    disabled={selected === null}
                    onPress={toggle}
                    className="h-7 flex-row items-center gap-1.5 self-center rounded-full border border-stroke-subtle bg-surface-raised pe-2 ps-2.5"
                >
                    <View aria-hidden className={cx('h-2 w-2 rounded-full', dotClass(status))} />
                    <RNText
                        testID="kitchen-recipe-editor-screen-status"
                        className="text-xs font-semibold text-content-primary"
                    >
                        {label}
                    </RNText>
                    {selected === null ? null : (
                        <Icon name="chevronDown" size="sm" className="text-content-secondary" />
                    )}
                </Pressable>
            )}
        >
            {({ close }) => (
                <View testID="kitchen-recipe-version-list" className="flex-col gap-1 p-2">
                    <RNText className="px-2 pb-1 pt-1.5 text-xs font-semibold text-content-secondary text-start">
                        {t('kitchen:recipes.sectionVersions')}
                    </RNText>
                    {versions.map((version) => {
                        const rowTestId = `kitchen-recipe-version-${String(version.id)}`;
                        const isSelected = selected !== null && selected.id === version.id;
                        return (
                            <View
                                key={String(version.id)}
                                testID={rowTestId}
                                className={cx(
                                    'flex-row items-center gap-2.5 rounded px-2 py-2',
                                    isSelected ? 'bg-surface-sunken' : null,
                                )}
                            >
                                <View
                                    aria-hidden
                                    className={cx('h-2 w-2 rounded-full', dotClass(version.status))}
                                />
                                <View className="min-w-0 flex-1 flex-col">
                                    <View className="flex-row flex-wrap items-center gap-1.5">
                                        <Text variant="bodyStrong">
                                            {t('kitchen:recipes.versionNumber', {
                                                number: version.versionNumber,
                                            })}
                                        </Text>
                                        <Badge
                                            testID={`${rowTestId}-status`}
                                            tone={statusTone(version.status)}
                                            label={t(statusKey(version.status))}
                                        />
                                        {version.isCurrent ? (
                                            <Badge
                                                testID={`${rowTestId}-current`}
                                                tone="info"
                                                label={t('kitchen:recipes.currentVersion')}
                                            />
                                        ) : null}
                                    </View>
                                    <Text variant="caption" tone="secondary">
                                        {t(audienceKey(version.status))}
                                    </Text>
                                </View>
                                <Button
                                    testID={`${rowTestId}-select`}
                                    size="sm"
                                    variant={isSelected ? 'secondary' : 'ghost'}
                                    label={
                                        isSelected
                                            ? t('kitchen:recipes.versionSelected')
                                            : t('kitchen:recipes.versionSelect')
                                    }
                                    onPress={() => {
                                        onSelect(version.isCurrent ? null : version.id);
                                        close();
                                    }}
                                />
                            </View>
                        );
                    })}
                    {onRetire === undefined ? null : (
                        <View className="mt-1 border-t border-stroke-subtle pt-1">
                            <Button
                                testID="kitchen-recipe-retire"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:recipes.retireFromMenu')}
                                onPress={() => {
                                    close();
                                    onRetire();
                                }}
                            />
                        </View>
                    )}
                </View>
            )}
        </Dropdown>
    );
}

/**
 * Every recipe is confidential, so the mark is on every one — a lock beside the status rather than
 * a red RESTRICTED badge, with what it means one hover (or press) away.
 */
export function KitchenOnlyMark() {
    const { t } = useTranslation();
    return (
        <InfoTip
            testID="kitchen-recipe-editor-screen-restricted"
            icon="lock"
            label={t('kitchen:recipes.kitchenOnly')}
            text={t('kitchen:recipes.kitchenOnlyHint')}
        />
    );
}
