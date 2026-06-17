const { z } = require('zod');

// Shared building blocks ----------------------------------------------------

const stellarPublicKey = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'Invalid Stellar public key');

const uuid = z.string().uuid();

const isoDateTime = z.iso.datetime({ offset: true });

const pageLimit = z
  .union([z.number(), z.string().regex(/^\d+$/, 'limit must be a positive integer')])
  .pipe(z.coerce.number().int().min(1).max(50))
  .default(20);

const pagination = {
  cursor: isoDateTime.optional(),
  limit: pageLimit,
};

// A bare resource id used in a route param — validates as UUID so a malformed
// id becomes a clean 400 instead of a Postgres type error surfacing as a 500.
const IdParamSchema = z.object({ id: uuid });

const VALID_CATEGORIES = [
  'electronics', 'fashion', 'home', 'beauty',
  'sports', 'food', 'automotive', 'industrial', 'other',
];

const category = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(VALID_CATEGORIES));

const price = z.coerce.number().finite().positive().max(1_000_000_000);

// posts ---------------------------------------------------------------------

const PostsQuerySchema = z.object({ ...pagination });

const CreatePostSchema = z.object({
  // user_id is optional — derived from the authenticated session server-side
  user_id: uuid.optional(),
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
    { message: 'minPrice must be <= maxPrice', path: ['minPrice'] },
  );

const CreateListingSchema = z.object({
  // seller_id is optional — derived from the authenticated session server-side
  seller_id: uuid.optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  price,
  category: category.optional(),
  moq: z.coerce.number().int().positive().optional(),
  ship_days: z.coerce.number().int().nonnegative().max(365).optional(),
  image_url: z.string().url().max(2048).optional(),
});

// chat ----------------------------------------------------------------------

const ConversationsQuerySchema = z.object({ userId: uuid });

const CreateConversationSchema = z.object({
  listing_id: uuid,
  buyer_id: uuid,
  seller_id: uuid,
});

const MessagesQuerySchema = z.object({ conversationId: uuid });

const CreateMessageSchema = z.object({
  conversation_id: uuid,
  sender_id: uuid,
  type: z.enum(['text', 'offer', 'system']).optional(),
  body: z.string().min(1).max(5000),
  offer_amount: z.coerce.number().finite().nonnegative().optional(),
});

// deals ---------------------------------------------------------------------

// The buyer signs the XDR envelope client-side; the signed envelope is sent to
// the server for submission. The buyer secret key never reaches the server.
const CreateDealSchema = z.object({
  signedXdr: z.string().min(1),
  seller: stellarPublicKey,
  amount: price,
  description: z.string().min(1).max(2000),
});

// users ---------------------------------------------------------------------

const CreateUserSchema = z.object({
  // wallet is optional — derived from the authenticated session server-side
  wallet: stellarPublicKey.optional(),
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
  CreateDealSchema,
  CreateUserSchema,
  RoleSchema,
};
