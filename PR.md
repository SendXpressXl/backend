Closes #16

### Summary of Changes
Implemented periodic pruning for the `sessions` Map in `src/middleware/auth.js` to bound memory usage and prevent potential Denial of Service via memory exhaustion. The auth `challenges` Map was previously migrated to Supabase, but the `sessions` Map had remained unbounded.

### What changed
- Added a `setInterval` in `src/middleware/auth.js` that runs every 2 minutes.
- The interval iterates over all entries in the `sessions` Map and aggressively deletes any sessions whose expiry time has passed.
- This ensures that unused tokens (which otherwise sat in the Map forever since cleanup only triggered when explicitly accessed) are cleaned up, plugging the memory leak.
