const { Router } = require('express');
const supabase   = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { IdParamSchema, InitiateFiatPaymentSchema, FiatWebhookSchema } = require('../validation/schemas');
const { createTransakSession, verifyTransakWebhook } = require('../services/onRamp');
const { canTransition } = require('../services/dealStateMachine');
const { logTransition } = require('../services/dealTransitions');
const { logger } = require('../lib/logger');
const router = Router();

// POST /api/fiat/initiate — start a fiat on-ramp session for a deal
router.post('/initiate', requireAuth, validate(InitiateFiatPaymentSchema), async (req, res) => {
  const { dealId, currency, amountFiat } = req.body;

  try {
    // 1. Fetch the deal and verify ownership
    const { data: deal, error: fetchErr } = await supabase
      .from('deals').select('*').eq('id', dealId).single();
    if (fetchErr) return res.status(404).json({ error: 'Deal not found' });
    if (deal.buyer !== req.wallet) return res.status(403).json({ error: 'Not the buyer' });
    if (!canTransition(deal.status, 'fiat_pending')) {
      return res.status(400).json({ error: 'Deal is not in a state that supports fiat payment' });
    }

    // 2. Transition deal to fiat_pending
    const { data: updated, error: updateErr } = await supabase
      .from('deals')
      .update({ status: 'fiat_pending', payment_method: 'fiat' })
      .eq('id', dealId)
      .eq('status', 'created')
      .select()
      .single();

    if (updateErr || !updated) {
      return res.status(409).json({ error: 'Could not initiate fiat payment — deal may already be in progress' });
    }
    await logTransition(dealId, req.wallet, deal.status, 'fiat_pending');

    // 3. Create on-ramp session
    const amountUsdc = Number(deal.amount);
    const { sessionId, url } = await createTransakSession({
      dealId,
      amountUsdc,
      wallet: req.wallet,
      currency,
    });

    // 4. Record the fiat payment
    const { data: payment, error: payErr } = await supabase
      .from('fiat_payments')
      .insert({
        deal_id: dealId,
        provider: 'transak',
        provider_session_id: sessionId,
        amount_fiat: amountFiat,
        currency,
        amount_usdc: amountUsdc,
        status: 'pending',
        wallet: req.wallet,
      })
      .select()
      .single();

    if (payErr) throw payErr;

    res.status(201).json({ paymentId: payment.id, url });
  } catch (err) {
    logger.error({ err, dealId }, 'Failed to initiate fiat payment');
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fiat/:id — check fiat payment status
router.get('/:id', requireAuth, validate(IdParamSchema, 'params'), async (req, res) => {
  const { data: payment, error } = await supabase
    .from('fiat_payments')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Payment not found' });
  if (payment.wallet !== req.wallet) return res.status(403).json({ error: 'Access denied' });

  res.json(payment);
});

// POST /api/fiat/webhook/transak — provider callback (no auth — signature verified)
router.post('/webhook/transak', async (req, res) => {
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-transak-signature'] || '';

  if (!verifyTransakWebhook(rawBody, signature)) {
    logger.warn('Transak webhook signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { eventID, eventName, data } = req.body;
  logger.info({ eventID, eventName }, 'Transak webhook received');

  // Only handle completed or failed events
  if (eventName !== 'TRANSAK_ORDER_SUCCESSFUL' && eventName !== 'TRANSAK_ORDER_FAILED') {
    return res.status(200).json({ received: true });
  }

  try {
    const dealId = data?.partnerOrderId;
    if (!dealId) {
      logger.warn({ eventID }, 'Webhook missing partnerOrderId');
      return res.status(200).json({ received: true });
    }

    // Find the fiat payment record
    const { data: payment, error: payErr } = await supabase
      .from('fiat_payments')
      .select('*')
      .eq('deal_id', dealId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (payErr || !payment) {
      logger.warn({ dealId, eventID }, 'No pending fiat payment found for deal');
      return res.status(200).json({ received: true });
    }

    if (eventName === 'TRANSAK_ORDER_SUCCESSFUL') {
      // Update payment record
      await supabase
        .from('fiat_payments')
        .update({
          status: 'completed',
          provider_tx_id: data?.id || null,
          updated_at: new Date().toISOString(),
          metadata: data || {},
        })
        .eq('id', payment.id);

      // Transition deal to fiat_locked
      const { data: deal } = await supabase
        .from('deals').select('*').eq('id', dealId).single();

      if (deal && canTransition(deal.status, 'fiat_locked')) {
        await supabase
          .from('deals')
          .update({ status: 'fiat_locked' })
          .eq('id', dealId)
          .eq('status', 'fiat_pending');
        await logTransition(dealId, 'webhook', deal.status, 'fiat_locked', 'Transak payment completed');
      }

      logger.info({ dealId, paymentId: payment.id }, 'Fiat payment completed, deal locked');
    } else {
      // Payment failed
      await supabase
        .from('fiat_payments')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
          metadata: data || {},
        })
        .eq('id', payment.id);

      // Revert deal back to created so buyer can retry
      const { data: deal } = await supabase
        .from('deals').select('*').eq('id', dealId).single();

      if (deal && canTransition(deal.status, 'created')) {
        await supabase
          .from('deals')
          .update({ status: 'created', payment_method: 'crypto' })
          .eq('id', dealId)
          .eq('status', 'fiat_pending');
        await logTransition(dealId, 'webhook', deal.status, 'created', 'Transak payment failed');
      }

      logger.warn({ dealId, paymentId: payment.id }, 'Fiat payment failed, deal reverted');
    }

    res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ err, eventID }, 'Error processing Transak webhook');
    // Return 200 to avoid retries for non-retryable errors
    res.status(200).json({ received: true });
  }
});

module.exports = router;
