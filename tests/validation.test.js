const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
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
} = require('../src/validation/schemas');

// Fixtures ------------------------------------------------------------------
const UUID = '11111111-1111-4111-8111-111111111111';
const PUBLIC = 'G' + 'A'.repeat(55);
const SECRET = 'S' + 'A'.repeat(55);

// PostsQuerySchema ----------------------------------------------------------
test('PostsQuerySchema: defaults limit to 20 and accepts ISO cursor', () => {
  const r = PostsQuerySchema.safeParse({ cursor: '2026-01-01T00:00:00Z' });
  assert.ok(r.success);
  assert.equal(r.data.limit, 20);
  assert.equal(r.data.cursor, '2026-01-01T00:00:00Z');
});

test('PostsQuerySchema: rejects non-timestamp cursor', () => {
  assert.equal(PostsQuerySchema.safeParse({ cursor: 'not-a-timestamp' }).success, false);
});

test('PostsQuerySchema: rejects out-of-range limits and the parseInt-prefix injection', () => {
  assert.equal(PostsQuerySchema.safeParse({ limit: '999' }).success, false);
  // Unlike parseInt("50 UNION SELECT") === 50, full-string coercion yields NaN.
  assert.equal(PostsQuerySchema.safeParse({ limit: '50 UNION SELECT' }).success, false);
  assert.equal(PostsQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(PostsQuerySchema.safeParse({ limit: '-1' }).success, false);
  assert.equal(PostsQuerySchema.safeParse({ limit: '3.5' }).success, false);
});

test('PostsQuerySchema: rejects non-decimal numeric forms (hex, scientific)', () => {
  // Only plain decimal-digit strings are accepted, so these never reach a query.
  assert.equal(PostsQuerySchema.safeParse({ limit: '0x1F' }).success, false);
  assert.equal(PostsQuerySchema.safeParse({ limit: '1e3' }).success, false);
});

test('PostsQuerySchema: an accepted limit is a clamped integer, never a raw string', () => {
  const r = PostsQuerySchema.safeParse({ limit: '25' });
  assert.ok(r.success);
  assert.equal(r.data.limit, 25);
  assert.equal(typeof r.data.limit, 'number');
});

// IdParamSchema -------------------------------------------------------------
test('IdParamSchema: accepts a UUID and rejects malformed ids', () => {
  assert.ok(IdParamSchema.safeParse({ id: UUID }).success);
  assert.equal(IdParamSchema.safeParse({ id: 'nonexistent-id-00000' }).success, false);
  assert.equal(IdParamSchema.safeParse({ id: '123' }).success, false);
});

test('PostsQuerySchema: coerces a valid in-range limit to a number', () => {
  const r = PostsQuerySchema.safeParse({ limit: '25' });
  assert.ok(r.success);
  assert.equal(r.data.limit, 25);
});

// CreatePostSchema ----------------------------------------------------------
test('CreatePostSchema: accepts valid content', () => {
  assert.ok(CreatePostSchema.safeParse({ user_id: UUID, text: 'hello' }).success);
});

test('CreatePostSchema: rejects empty, oversized, and missing text', () => {
  assert.equal(CreatePostSchema.safeParse({ user_id: UUID, text: '' }).success, false);
  assert.equal(CreatePostSchema.safeParse({ user_id: UUID, text: 'x'.repeat(2001) }).success, false);
  assert.equal(CreatePostSchema.safeParse({ user_id: UUID }).success, false);
});

test('CreatePostSchema: rejects non-UUID user_id', () => {
  assert.equal(CreatePostSchema.safeParse({ user_id: 'abc', text: 'hi' }).success, false);
});

// ListingsQuerySchema -------------------------------------------------------
test('ListingsQuerySchema: rejects negative, NaN, and Infinity prices', () => {
  assert.equal(ListingsQuerySchema.safeParse({ minPrice: '-999999' }).success, false);
  assert.equal(ListingsQuerySchema.safeParse({ maxPrice: 'Infinity' }).success, false);
  assert.equal(ListingsQuerySchema.safeParse({ minPrice: 'NaN' }).success, false);
});

test('ListingsQuerySchema: enforces minPrice ≤ maxPrice', () => {
  assert.equal(ListingsQuerySchema.safeParse({ minPrice: '100', maxPrice: '10' }).success, false);
  assert.ok(ListingsQuerySchema.safeParse({ minPrice: '10', maxPrice: '100' }).success);
});

test('ListingsQuerySchema: normalises category casing and rejects unknown category', () => {
  const r = ListingsQuerySchema.safeParse({ category: 'ELECTRONICS' });
  assert.ok(r.success);
  assert.equal(r.data.category, 'electronics');
  assert.equal(ListingsQuerySchema.safeParse({ category: 'weapons' }).success, false);
});

test('ListingsQuerySchema: rejects search longer than 100 chars', () => {
  assert.equal(ListingsQuerySchema.safeParse({ search: 'x'.repeat(101) }).success, false);
});

// CreateListingSchema -------------------------------------------------------
test('CreateListingSchema: rejects non-positive price', () => {
  assert.equal(CreateListingSchema.safeParse({ seller_id: UUID, title: 't', price: '0' }).success, false);
  assert.equal(CreateListingSchema.safeParse({ seller_id: UUID, title: 't', price: '-5' }).success, false);
  assert.ok(CreateListingSchema.safeParse({ seller_id: UUID, title: 't', price: '5' }).success);
});

// chat schemas --------------------------------------------------------------
test('ConversationsQuerySchema/MessagesQuerySchema: require a UUID', () => {
  assert.equal(ConversationsQuerySchema.safeParse({ userId: 'not-a-uuid' }).success, false);
  assert.ok(ConversationsQuerySchema.safeParse({ userId: UUID }).success);
  assert.equal(MessagesQuerySchema.safeParse({ conversationId: '1; DROP TABLE messages' }).success, false);
  assert.ok(MessagesQuerySchema.safeParse({ conversationId: UUID }).success);
});

test('CreateConversationSchema/CreateMessageSchema: validate ids and body', () => {
  assert.ok(CreateConversationSchema.safeParse({ listing_id: UUID, buyer_id: UUID, seller_id: UUID }).success);
  assert.equal(CreateConversationSchema.safeParse({ listing_id: UUID, buyer_id: UUID }).success, false);
  assert.ok(CreateMessageSchema.safeParse({ conversation_id: UUID, sender_id: UUID, body: 'hi' }).success);
  assert.equal(CreateMessageSchema.safeParse({ conversation_id: UUID, sender_id: UUID, body: '' }).success, false);
});

// deals schemas -------------------------------------------------------------
test('CreateDealSchema: rejects bad amounts and bad keys (no secret in body)', () => {
  const base = { seller: PUBLIC, description: 'widgets' };
  assert.ok(CreateDealSchema.safeParse({ ...base, amount: '100' }).success);
  assert.equal(CreateDealSchema.safeParse({ ...base, amount: '-5' }).success, false);
  assert.equal(CreateDealSchema.safeParse({ ...base, amount: 'Infinity' }).success, false);
  assert.equal(CreateDealSchema.safeParse({ ...base, amount: 'abc' }).success, false);
  assert.equal(CreateDealSchema.safeParse({ ...base, amount: '0' }).success, false);
  assert.equal(CreateDealSchema.safeParse({ seller: 'G123', amount: '1', description: 'x' }).success, false);
});

test('CreateDealSchema: a secret in the body is ignored, not stored', () => {
  // Object schemas strip unknown keys, so a stray buyerSecret never reaches req.body.
  const r = CreateDealSchema.safeParse({ seller: PUBLIC, amount: '5', description: 'x', buyerSecret: SECRET });
  assert.ok(r.success);
  assert.equal('buyerSecret' in r.data, false);
});

test('BuyerSecretHeaderSchema: requires a well-formed Stellar secret header', () => {
  assert.ok(BuyerSecretHeaderSchema.safeParse({ 'x-buyer-secret': SECRET }).success);
  assert.equal(BuyerSecretHeaderSchema.safeParse({ 'x-buyer-secret': 'nope' }).success, false);
  assert.equal(BuyerSecretHeaderSchema.safeParse({}).success, false);
});

test('Deal state-change schemas validate the caller key as a Stellar public key', () => {
  assert.ok(ShipDealSchema.safeParse({ sellerId: PUBLIC }).success);
  assert.equal(ShipDealSchema.safeParse({ sellerId: 'GBUYER123' }).success, false);
  assert.ok(ConfirmDealSchema.safeParse({ buyerId: PUBLIC }).success);
  assert.equal(ConfirmDealSchema.safeParse({ buyerId: 'nope' }).success, false);
  assert.ok(CancelDealSchema.safeParse({ buyerId: PUBLIC }).success);
  assert.ok(DisputeDealSchema.safeParse({ callerId: PUBLIC }).success);
  assert.equal(DisputeDealSchema.safeParse({}).success, false);
});

test('DealsQuerySchema: requires a Stellar public key', () => {
  assert.ok(DealsQuerySchema.safeParse({ userId: PUBLIC }).success);
  assert.equal(DealsQuerySchema.safeParse({ userId: 'GBADKEY' }).success, false);
});

// users schemas -------------------------------------------------------------
test('RoleSchema: accepts the enum and rejects everything else', () => {
  for (const role of ['buyer', 'seller', 'both']) {
    assert.ok(RoleSchema.safeParse({ role }).success);
  }
  assert.equal(RoleSchema.safeParse({ role: 'superadmin' }).success, false);
  assert.equal(RoleSchema.safeParse({ role: "'; DROP TABLE users;--" }).success, false);
  assert.equal(RoleSchema.safeParse({}).success, false);
});

test('CreateUserSchema: requires a valid Stellar wallet', () => {
  assert.ok(CreateUserSchema.safeParse({ wallet: PUBLIC }).success);
  assert.equal(CreateUserSchema.safeParse({ wallet: 'not-a-wallet' }).success, false);
  assert.equal(CreateUserSchema.safeParse({}).success, false);
});
