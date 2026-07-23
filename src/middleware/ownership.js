const supabase = require('../config/supabase');

/**
 * Middleware factory: fetches the row at :id from `table` and requires the
 * caller (req.user, set by attachUser/requireRole) to either own it via
 * `ownerField` or hold the admin role. The fetched row is attached to
 * req[attachAs] so the handler doesn't need a second read.
 *
 * @param {string} table
 * @param {string} ownerField - column on the row holding the owning user's id
 * @param {string} attachAs   - property name to attach the fetched row under
 */
function requireOwnership(table, ownerField, attachAs) {
  return async (req, res, next) => {
    const { data: row, error } = await supabase
      .from(table).select('*').eq('id', req.params.id).single();

    if (error || !row) return res.status(404).json({ error: 'Not found' });

    if (row[ownerField] !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ error: 'Not the owner of this resource' });

    req[attachAs] = row;
    next();
  };
}

module.exports = { requireOwnership };
