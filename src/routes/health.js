const { Router } = require('express');
const supabase   = require('../config/supabase');
const { server } = require('../config/stellar');

const router = Router();

// Known active account on testnet used only for liveness probe
const STELLAR_PROBE_ACCOUNT = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';

// GET /api/health
router.get('/', async (req, res) => {
  const checks = await Promise.allSettled([
    supabase.from('users').select('count').limit(1),
    server.loadAccount(STELLAR_PROBE_ACCOUNT),
  ]);

  const [dbCheck, stellarCheck] = checks;
  const healthy = checks.every(c => c.status === 'fulfilled');

  res.status(healthy ? 200 : 503).json({
    status:  healthy ? 'ok' : 'degraded',
    checks: {
      database: dbCheck.status    === 'fulfilled' ? 'ok' : 'error',
      stellar:  stellarCheck.status === 'fulfilled' ? 'ok' : 'error',
    },
    ts: new Date().toISOString(),
  });
});

module.exports = router;
