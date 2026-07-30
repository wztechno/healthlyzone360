# @healthy360/domain-types

Zero-dependency TypeScript vocabulary shared by every other Healthy360 frontend package: branded
identifier types (`UserId`, `OrganisationId`, `BranchId`, `MembershipId`, `RoleId`, `DeviceId`) with
runtime codecs, the closed unions the platform is built around (`AppMode`, `RouteArea`,
`MembershipStatus`, `TextDirection`, `Locale`), the foundation domain interfaces (`SessionUser`,
`Profile`, `Organisation`, `Branch`, `Membership`, `Device`, `ActiveContext`) and a small
`Result<T, E>` helper. It imports nothing — not React, not Zod, not i18next — so it is safe to pull
into pure logic, generated-client adapters, tests and Node scripts alike. Identifier shapes mirror
the backend's UUIDv7 strategy (plan §8); the codecs validate that shape but never mint identifiers,
because identifiers are always server-issued.
