/**
 * The API repository layer — the **only** place `src/generated/**` may be imported from
 * (plan §15, enforced by `no-restricted-imports` in the root ESLint configuration).
 */
export { DEFAULT_API_BASE_URL, generateRequestId, resolveApiBaseUrl } from './config.ts';
export type { ApiClientConfig, ClientPlatform } from './config.ts';

export {
    asErrorEnvelope,
    mapErrorEnvelope,
    readValidationFields,
    WIRE_ERROR_CODES,
} from './failures.ts';
export type { ErrorEnvelopeContext } from './failures.ts';

export {
    EMAIL_VERIFIED_AT_UNKNOWN,
    UNKNOWN_ISO_DATE_TIME,
    createBranchDirectory,
    mapActiveContext,
    mapBranch,
    mapDevice,
    mapMeResponse,
    mapMembership,
    mapMembershipRole,
    mapMembershipStatus,
    mapOrganisation,
    mapProfile,
    mapUser,
    parsePermissionsVersion,
} from './mappers.ts';
export type { BranchDirectory, WireMePayload } from './mappers.ts';

export { RESEND_VERIFICATION_COOLDOWN_SECONDS, createApiRepositories } from './repositories.ts';
export type { ApiRepositories } from './repositories.ts';

/**
 * The marketplace, half of which is real (M1). Exported so the conformance suite can drive it
 * against a stubbed transport without constructing a whole repository bundle.
 */
export { createApiMarketplaceRepository } from './marketplace-repository.ts';
export {
    DEFAULT_B2B_CART_CHANNEL_CODE,
    DEFAULT_CART_CHANNEL_CODE,
    createApiCartSurface,
} from './cart-repository.ts';
export { createApiBusinessRepository, createApiBusinessReads } from './business-repository.ts';
export { createApiInvitationsRepository } from './invitations-repository.ts';
export {
    NO_NUTRITION_FACTS,
    UNSTATED_SERVING,
    mapCursorPage,
    mapDeliveryZone,
    mapKitchen,
    mapKitchenBranch,
    mapMarketplaceMeal,
    mapMoney,
    mapOpeningHours,
    mapSalesChannels,
} from './marketplace-mappers.ts';

/**
 * The proposed contracts that are still rejections. Exported so the conformance test can walk them
 * without reaching into the bundle, and so the endpoint table has one owner.
 */
export {
    API_PROTOTYPE_REPOSITORIES,
    PROTOTYPE_ENDPOINTS,
    apiBusinessRepository,
    apiCommerceRepository,
    apiFoodRepository,
    apiMarketplacePrototypeRepository,
    apiMealPlanRepository,
    apiNutritionRepository,
    apiProfessionalRepository,
    apiVirtualDietitianRepository,
    notImplemented,
} from './prototype-repositories.ts';
export type { PrototypeMarketplaceRepository } from './prototype-repositories.ts';

export { createActiveContextHolder, createTransport, readPermissionsVersion } from './transport.ts';
export type { ActiveContextHolder, Envelope, RequestSpec, Transport } from './transport.ts';
