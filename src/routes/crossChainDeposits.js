const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { CreateCrossChainDepositSchema, IdParamSchema } = require('../validation/schemas');
const { initiateCrossChainDeposit, getDepositStatus } = require('../services/crossChainDeposit');
const { listSupportedChains } = require('../services/cctp');

const router = Router();

// GET /api/deposits/chains — list supported EVM chains
router.get('/chains', (req, res) => {
  res.json({ chains: listSupportedChains() });
});

// POST /api/deposits — initiate a cross-chain USDC deposit
router.post('/', requireAuth, validate(CreateCrossChainDepositSchema), async (req, res) => {
  const { dealId, burnTxHash, sourceChain, amount } = req.body;

  try {
    const result = await initiateCrossChainDeposit({
      dealId,
      buyerWallet: req.wallet,
      burnTxHash,
      sourceChain,
      amount,
    });

    res.status(202).json({
      ...result,
      message: 'Deposit initiated. Poll GET /api/deposits/:id for status updates.',
      pollIntervalMs: 5000,
    });
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('Not the buyer') ? 403
      : err.message.includes('not in created') ? 409
      : 400;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/deposits/:id — check deposit status
router.get('/:id', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  try {
    const status = await getDepositStatus(req.params.id, req.wallet);
    res.json(status);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 403;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
