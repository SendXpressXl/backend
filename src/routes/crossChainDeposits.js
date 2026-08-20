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
    const statusMap = {
      DEAL_NOT_FOUND: 404,
      NOT_BUYER: 403,
      INVALID_DEAL_STATUS: 409,
      DUPLICATE_BURN_HASH: 409,
    };
    res.status(statusMap[err.code] || 400).json({ error: err.message, code: err.code });
  }
});

// GET /api/deposits/:id — check deposit status
router.get('/:id', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  try {
    const status = await getDepositStatus(req.params.id, req.wallet);
    res.json(status);
  } catch (err) {
    const statusMap = { DEAL_NOT_FOUND: 404, NOT_BUYER: 403 };
    res.status(statusMap[err.code] || 400).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
