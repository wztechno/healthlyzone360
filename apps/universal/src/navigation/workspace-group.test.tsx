import {
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
} from '@healthy360/permissions/testing';
import type { TFunction } from 'i18next';

import { availableWorkspaceAreas } from './items.ts';
import { workspaceGroup } from './workspace-group.tsx';

const t = ((key: string) => key) as unknown as TFunction;

const hydrated = (permissions: readonly string[]) =>
    makeAccessState({
        mode: 'all-dev',
        session: 'authenticated',
        emailVerified: true,
        organisation: makeAccessOrganisation(),
        branch: makeAccessBranch(),
        permissions,
    });

const build = (permissions: readonly string[], pathname = '/kitchen') =>
    workspaceGroup({
        state: hydrated(permissions),
        t,
        pathname,
        currentArea: 'kitchen',
        navigate: jest.fn(),
    });

describe('the Workspace group', () => {
    it('lists the openable areas first, then the account', () => {
        const state = hydrated(['device.manage_own']);
        const items = build(['device.manage_own']);
        const areas = availableWorkspaceAreas(state).map((option) => `area-${option.area}`);

        expect(items.map((item) => item.key)).toEqual([...areas, 'profile', 'devices']);
    });

    it('carries no rail module — it is a tab bar, not a group', () => {
        for (const item of build(['device.manage_own'])) {
            expect(item.group).toBeUndefined();
            expect(item.section).toBeUndefined();
        }
    });

    it('drops the tile page link, which the bar replaces', () => {
        expect(build([]).some((item) => item.key === 'workspace')).toBe(false);
    });

    it('hides Devices without device.manage_own', () => {
        expect(build([]).some((item) => item.key === 'devices')).toBe(false);
    });

    it('lights the current area and no other', () => {
        for (const item of build(['device.manage_own'])) {
            if (!item.key.startsWith('area-')) continue;
            expect(item.active).toBe(item.key === 'area-kitchen');
        }
    });

    it('marks the account page being viewed as active', () => {
        const items = build(['device.manage_own'], '/profile');
        expect(items.find((item) => item.key === 'profile')?.active).toBe(true);
        expect(items.find((item) => item.key === 'devices')?.active).toBe(false);
    });
});
