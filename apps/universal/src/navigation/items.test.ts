import { ROUTE_AREAS } from '@healthy360/domain-types';
import {
    makeAccessBranch,
    makeAccessOrganisation,
    makeAccessState,
} from '@healthy360/permissions/testing';

import {
    WORKSPACE_AREAS,
    WORKSPACE_NAVIGATION,
    areaHref,
    areasForMode,
    availableWorkspaceAreas,
    permittedNavigation,
} from './items.ts';

const hydrated = (
    permissions: readonly string[],
    mode: 'all-dev' | 'staff' | 'customer' = 'all-dev',
) =>
    makeAccessState({
        mode,
        session: 'authenticated',
        emailVerified: true,
        organisation: makeAccessOrganisation(),
        branch: makeAccessBranch(),
        permissions,
    });

describe('the navigation registry', () => {
    it('covers every route area except public and auth', () => {
        expect([...WORKSPACE_AREAS].sort()).toEqual(
            ROUTE_AREAS.filter((area) => area !== 'public' && area !== 'auth').sort(),
        );
    });

    it('addresses each area at its own path', () => {
        for (const area of WORKSPACE_AREAS) expect(areaHref(area)).toBe(`/${area}`);
    });

    it('declares labels as translation keys, never as literals', () => {
        for (const item of WORKSPACE_NAVIGATION) {
            expect(item.labelKey).toMatch(/^[a-zA-Z]+:[\w.]+$/);
        }
    });

    it('has unique keys and hrefs', () => {
        expect(new Set(WORKSPACE_NAVIGATION.map((item) => item.key)).size).toBe(
            WORKSPACE_NAVIGATION.length,
        );
        expect(new Set(WORKSPACE_NAVIGATION.map((item) => item.href)).size).toBe(
            WORKSPACE_NAVIGATION.length,
        );
    });
});

describe('permittedNavigation', () => {
    it('drops items whose permission is absent', () => {
        const keys = permittedNavigation(hydrated([])).map((item) => item.key);
        expect(keys).toEqual(['workspace', 'profile']);
    });

    it('includes the devices entry once device.manage_own is granted', () => {
        const keys = permittedNavigation(hydrated(['device.manage_own'])).map((item) => item.key);
        expect(keys).toContain('devices');
        expect(keys).not.toContain('showcase');
    });

    it('includes the showcase only for a platform administrator', () => {
        const keys = permittedNavigation(
            hydrated(['device.manage_own', 'organisation.manage_platform']),
        ).map((item) => item.key);
        expect(keys).toEqual(['workspace', 'profile', 'devices', 'showcase']);
    });

    it('drops an item whose area is not in the build family, even with the permission', () => {
        const keys = permittedNavigation(
            hydrated(['device.manage_own', 'organisation.manage_platform'], 'staff'),
        ).map((item) => item.key);
        // `platform-admin` is not compiled into the staff family.
        expect(keys).not.toContain('showcase');
    });
});

describe('availableWorkspaceAreas', () => {
    it('offers only areas whose gate would actually open', () => {
        const areas = availableWorkspaceAreas(hydrated([])).map((option) => option.area);

        // No permission → everything except the permission-gated platform-admin area.
        expect(areas).toContain('kitchen');
        expect(areas).toContain('corporate');
        expect(areas).not.toContain('platform-admin');
    });

    /**
     * The second filter: an area whose feature has no backend is not a destination, however
     * entitled the person is. See `src/features/availability.ts`.
     */
    it('drops the areas whose feature has no backend, permission notwithstanding', () => {
        const areas = availableWorkspaceAreas(hydrated(['organisation.manage_platform'])).map(
            (option) => option.area,
        );

        for (const area of ['dietitian', 'clinic', 'insurance', 'patient', 'partner'])
            expect(areas).not.toContain(area);
    });

    /**
     * The other half of the same filter, and the reason `driver` left the list above: the run
     * sheet's endpoints are wired, so the area is a real destination in the families that compile
     * it. This is the assertion that would fail if `driverJobs` were flipped back without the rest
     * of the client going with it.
     */
    it('offers the driver area now that the run sheet has endpoints behind it', () => {
        const areas = availableWorkspaceAreas(hydrated([])).map((option) => option.area);
        expect(areas).toContain('driver');
    });

    it('adds platform-admin once the permission is present', () => {
        const areas = availableWorkspaceAreas(hydrated(['organisation.manage_platform'])).map(
            (option) => option.area,
        );
        expect(areas).toContain('platform-admin');
    });

    it('offers nothing that needs a branch when no branch is confirmed', () => {
        const state = makeAccessState({
            mode: 'all-dev',
            session: 'authenticated',
            emailVerified: true,
            organisation: makeAccessOrganisation(),
            branch: undefined,
        });
        const areas = availableWorkspaceAreas(state).map((option) => option.area);

        for (const area of ['kitchen', 'kds']) expect(areas).not.toContain(area);
    });

    /** Decision D1: consumer areas open on a global identity alone. */
    it('offers the consumer areas to a verified user with no organisation', () => {
        const state = makeAccessState({
            mode: 'customer',
            session: 'authenticated',
            emailVerified: true,
            organisation: undefined,
        });
        // `patient` is compiled into the customer family and would pass the gate; it has no
        // backend, so it is not offered.
        expect(availableWorkspaceAreas(state).map((option) => option.area)).toEqual(['customer']);
    });

    it('never offers an area outside the build family', () => {
        const areas = availableWorkspaceAreas(hydrated([], 'staff')).map((option) => option.area);
        expect(areas).not.toContain('kds');
        expect(areas).not.toContain('customer');
    });

    it('every option is marked available — refused destinations are dropped, not greyed out', () => {
        for (const option of availableWorkspaceAreas(hydrated(['organisation.manage_platform']))) {
            expect(option.available).toBe(true);
        }
    });
});

describe('areasForMode', () => {
    it('reports what a build family compiles, regardless of the user', () => {
        expect(areasForMode('kiosk')).toEqual(['kds']);
        expect(areasForMode('driver')).toEqual(['driver']);
        expect(areasForMode('customer')).toEqual(['customer', 'patient']);
    });
});
