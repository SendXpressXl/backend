const { z } = require('zod');

// Shared building blocks ----------------------------------------------------

// Stellar public ("G...") and secret ("S...") keys are 56-char base32 strings.
const stellarPublicKey = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key');
const stellarSecretKey = z
  .string()
  .regex(/^S[A-Z2-7]{55}$/, 'Invalid Stellar secret key');

const uuid = z.string().uuid();

const isoDateTime = z.iso.datetime({ offset: true });

// Pagination `limit`: query params arrive as strings, so only accept a plain
// decimal-digit string (or an actual number) — this rejects hex/scientific
// forms like "0x1F" or "1e3" that z.coerce.number() would otherwise accept,
// then clamps to [1, 50] as an integer.
const pageLimit = z
  .union([z.number(), z.string().regex(/^\d+$/, 'limit must be a positive integer')])
  .pipe(z.coerce.number().int().min(1).max(50))
  .default(20);

const pagination = {
  cursor: isoDateTime.optional(),
  limit: pageLimit,
};

// A bare resource id used in a route param (e.g. /:id). Validating it as a
// UUID turns a malformed id into a clean 400 instead of a Postgres type error
// surfacing as a generic 500.
const IdParamSchema = z.object({ id: uuid });

const VALID_CATEGORIES = [
  'electronics', 'fashion', 'home', 'beauty',
  'sports', 'food', 'automotive', 'industrial', 'other',
];

// Accept any casing, normalise to lowercase, then enforce the enum.
const category = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(VALID_CATEGORIES));

// A monetary amount: finite, non-negative, with a sane upper bound to block
// absurd values (Infinity/NaN are rejected by .finite()).
const price = z.coerce.number().finite().positive().max(1_000_000_000);

// posts ---------------------------------------------------------------------

const PostsQuerySchema = z.object({
  ...pagination,
});

const CreatePostSchema = z.object({
  user_id: uuid,
  text: z.string().min(1).max(2000),
  image_url: z.string().url().max(2048).optional(),
  tagged_listing_id: uuid.optional(),
});

// listings ------------------------------------------------------------------

const ListingsQuerySchema = z
  .object({
    category: category.optional(),
    search: z.string().max(100).optional(),
    minPrice: z.coerce.number().finite().nonnegative().optional(),
    maxPrice: z.coerce.number().finite().nonnegative().optional(),
    ...pagination,
  })
  .refine(
    (d) => d.minPrice === undefined || d.maxPrice === undefined || d.minPrice <= d.maxPrice,
    { message: 'minPrice must be ≤ maxPrice', path: ['minPrice'] },
  );

const CreateListingSchema = z.object({
  seller_id: uuid,
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  price,
  category: category.optional(),
  moq: z.coerce.number().int().positive().optional(),
  ship_days: z.coerce.number().int().nonnegative().max(365).optional(),
  image_url: z.string().url().max(2048).optional(),
});

// chat ----------------------------------------------------------------------

const ConversationsQuerySchema = z.object({
  userId: uuid,
});

const CreateConversationSchema = z.object({
  listing_id: uuid,
  buyer_id: uuid,
  seller_id: uuid,
});

const MessagesQuerySchema = z.object({
  conversationId: uuid,
});

const CreateMessageSchema = z.object({
  conversation_id: uuid,
  sender_id: uuid,
  type: z.enum(['text', 'offer', 'system']).optional(),
  body: z.string().min(1).max(5000),
  offer_amount: z.coerce.number().finite().nonnegative().optional(),
});

// deals ---------------------------------------------------------------------

const DealsQuerySchema = z.object({
  userId: stellarPublicKey,
});

// The buyer's Stellar secret is required for server-side signing but must NOT
// travel in the JSON body, where it would be captured verbatim by request
// logging, error stacks, and APM/tracing layers. It is carried in a dedicated
// header that the logging pipeline is expected to redact (see deals.js).
// NOTE: the long-term fix is client-side signing — the client submits a signed
// XDR envelope and the secret never reaches the server at all.
const BuyerSecretHeaderSchema = z.object({
  'x-buyer-secret': stellarSecretKey,
});

const CreateDealSchema = z.object({
  seller: stellarPublicKey,
  amount: price,
  description: z.string().min(1).max(2000),
});

// State-machine transitions carry the caller's Stellar public key, which is
// used for the authorization check (buyer/seller match). Validate the format
// before it reaches that check — the same guarantee the create path has.
const ShipDealSchema    = z.object({ sellerId: stellarPublicKey });
const ConfirmDealSchema = z.object({ buyerId: stellarPublicKey });
const CancelDealSchema  = z.object({ buyerId: stellarPublicKey });
const DisputeDealSchema = z.object({ callerId: stellarPublicKey });

// users ---------------------------------------------------------------------

const CreateUserSchema = z.object({
  wallet: stellarPublicKey,
  handle: z.string().min(1).max(50).optional(),
  display_name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().max(2048).optional(),
});

const RoleSchema = z.object({
  role: z.enum(['buyer', 'seller', 'both']),
});

module.exports = {
  VALID_CATEGORIES,
  IdParamSchema,
  PostsQuerySchema,
  CreatePostSchema,
  ListingsQuerySchema,
  CreateListingSchema,
  ConversationsQuerySchema,
  CreateConversationSchema,
  MessagesQuerySchema,
  CreateMessageSchema,
  DealsQuerySchema,
  BuyerSecretHeaderSchema,
  CreateDealSchema,
  ShipDealSchema,
  ConfirmDealSchema,
  CancelDealSchema,
  DisputeDealSchema,
  CreateUserSchema,
  RoleSchema,
};
