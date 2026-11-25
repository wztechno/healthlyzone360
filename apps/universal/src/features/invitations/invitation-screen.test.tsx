import type { Invitation } from '@healthy360/api-client/contracts';
import type { IsoDateTime } from '@healthy360/domain-types';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { withReturnTo } from '../../navigation/return-to.ts';
import type { ExpoRouterMock } from '../../testing/expo-router-mock.ts';
import { renderStubScreen } from '../../testing/stub-screen.tsx';
import { InvitationScreen } from './screens/invitation-screen.tsx';

/**
 * The invitation page's ways out. A new owner opens the mailed link signed out, leaves to create an
 * account and confirm its address, and has to land back on this exact link to accept — so each way
 * out carries the link, token and all, as `?returnTo=`.
 */

const TOKEN = 'lOnx2kGCO21DqILkSUKGSFcWqPZqI5rV';
const HERE = `/invitations/${TOKEN}`;

const INVITATION: Invitation = {
    id: 'invitation-1',
    status: 'pending',
    roleCode: 'organisation_owner',
    emailMasked: 'n•••@importtest.test',
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString() as IsoDateTime,
    organisation: { name: 'Import Test Kitchen', languageCode: 'en', type: 'kitchen' },
};

jest.mock('expo-router', () =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../testing/expo-router-mock.ts').createExpoRouterMock({
        pathname: '/invitations/token',
    }),
);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const routerMock = require('expo-router') as ExpoRouterMock;

beforeEach(() => {
    routerMock.__reset();
});

async function renderSignedOut() {
    await renderStubScreen(<InvitationScreen token={TOKEN} />, {
        repositories: { invitations: { getInvitation: async () => INVITATION } },
    });
    await waitFor(() => {
        expect(screen.getByTestId('invitation-signed-out')).toBeTruthy();
    });
}

describe('InvitationScreen — signed out', () => {
    it('says what is offered before it asks for anything', async () => {
        await renderSignedOut();

        expect(screen.getByTestId('invitation-heading')).toHaveTextContent(
            'Join Import Test Kitchen',
        );
        expect(screen.getByTestId('invitation-role')).toHaveTextContent('Owner');
        expect(screen.getByTestId('invitation-email')).toHaveTextContent('n•••@importtest.test');
        expect(screen.queryByTestId('invitation-accept')).toBeNull();
    });

    it('leaves for registration carrying this link as the return', async () => {
        await renderSignedOut();

        await fireEvent.press(screen.getByTestId('invitation-register'));

        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/register', HERE));
        // The return survives the trip: it is the link itself, not an empty or refused value.
        expect(withReturnTo('/register', HERE)).toContain('returnTo=');
    });

    it('leaves for sign-in carrying this link as the return', async () => {
        await renderSignedOut();

        await fireEvent.press(screen.getByTestId('invitation-sign-in'));

        expect(routerMock.__push).toHaveBeenCalledWith(withReturnTo('/sign-in', HERE));
    });
});
