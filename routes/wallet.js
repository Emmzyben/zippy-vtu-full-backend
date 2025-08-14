const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');
const crypto = require('crypto');

const router = express.Router();

// Get wallet balance
router.get('/balance', authMiddleware, async (req, res) => {
  try {
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      balance: parseFloat(users[0].wallet_balance)
    });

  } catch (error) {
    console.error('Get balance error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Fund wallet (initiate payment)
router.post('/fund', authMiddleware, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum funding amount is ₦100')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { amount } = req.body;
    const userId = req.user.id;

    // Generate unique reference
    const reference = `ZP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Create pending transaction
    await db.execute(
      'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
      [userId, 'wallet_fund', amount, reference, 'pending', JSON.stringify({ payment_method: 'paystack' })]
    );

    // In a real implementation, you would integrate with Paystack here
    // For demo purposes, we'll simulate a successful payment
    
    // Simulate payment gateway response
    const paymentResponse = {
      status: 'success',
      reference: reference,
      payment_url: `https://checkout.paystack.com/demo?reference=${reference}&amount=${amount * 100}`,
      access_code: `access_code_${crypto.randomBytes(8).toString('hex')}`
    };

    res.json({
      success: true,
      message: 'Payment initiated successfully',
      data: paymentResponse
    });

  } catch (error) {
    console.error('Fund wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during wallet funding'
    });
  }
});

// Webhook for payment verification (Paystack webhook)
router.post('/webhook/paystack', async (req, res) => {
  try {
    const { event, data } = req.body;

    if (event === 'charge.success') {
      const { reference, amount, status } = data;

      // Find the transaction
      const [transactions] = await db.execute(
        'SELECT id, user_id, amount FROM transactions WHERE reference = ? AND status = ?',
        [reference, 'pending']
      );

      if (transactions.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Transaction not found'
        });
      }

      const transaction = transactions[0];

      if (status === 'success') {
        // Update transaction status
        await db.execute(
          'UPDATE transactions SET status = ?, external_reference = ? WHERE id = ?',
          ['success', data.id, transaction.id]
        );

        // Credit user wallet
        await db.execute(
          'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
          [transaction.amount, transaction.user_id]
        );

        console.log(`Wallet funded: User ${transaction.user_id}, Amount: ${transaction.amount}`);
      } else {
        // Update transaction as failed
        await db.execute(
          'UPDATE transactions SET status = ? WHERE id = ?',
          ['failed', transaction.id]
        );
      }
    }

    res.status(200).json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({
      success: false,
      message: 'Webhook processing failed'
    });
  }
});

// Process transaction (deduct from wallet)
router.post('/transaction', authMiddleware, [
  body('type').isIn(['airtime', 'data', 'bill']).withMessage('Invalid transaction type'),
  body('amount').isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('details').isObject().withMessage('Transaction details are required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { type, amount, details } = req.body;
    const userId = req.user.id;

    // Check wallet balance
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const currentBalance = parseFloat(users[0].wallet_balance);
    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Generate unique reference
    const reference = `ZP_${type.toUpperCase()}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Start transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Deduct from wallet
      await connection.execute(
        'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
        [amount, userId]
      );

      // Create transaction record
      const [result] = await connection.execute(
        'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
        [userId, type, amount, reference, 'success', JSON.stringify(details)]
      );

      await connection.commit();

      // Get the created transaction
      const [newTransaction] = await db.execute(
        'SELECT * FROM transactions WHERE id = ?',
        [result.insertId]
      );

      res.json({
        success: true,
        message: 'Transaction processed successfully',
        transaction: {
          ...newTransaction[0],
          details: JSON.parse(newTransaction[0].details)
        }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Process transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during transaction processing'
    });
  }
});

module.exports = router;