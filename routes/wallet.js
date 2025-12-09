const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');
const crypto = require('crypto');
const axios = require('axios');

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

    // Get user email
    const [users] = await db.execute(
      'SELECT email FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const userEmail = users[0].email;

    // Generate unique reference
    const reference = `ZP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Calculate Paystack fee
    let fee = 0;
    if (amount < 2500) {
      fee = amount * 0.015;
    } else {
      fee = (amount * 0.015) + 100;
    }

    const amountToCredit = amount - fee;

    // Initialize Paystack transaction
    const paystackResponse = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        amount: amount * 100, // Convert to kobo (Gross Amount)
        email: userEmail,
        reference: reference,
        callback_url: `${process.env.FRONTEND_URL}/wallet`,
        metadata: {
          user_id: userId,
          type: 'wallet_fund'
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!paystackResponse.data.status) {
      return res.status(400).json({
        success: false,
        message: 'Failed to initialize payment'
      });
    }

    // Create transaction as "pending" with NET amount to credit
    await db.execute(
      'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
      [
        userId,
        'wallet_fund',
        amountToCredit,
        reference,
        'pending',
        JSON.stringify({
          payment_method: 'paystack',
          original_amount: amount,
          fee: fee
        })
      ]
    );

    res.json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        authorization_url: paystackResponse.data.data.authorization_url,
        access_code: paystackResponse.data.data.access_code,
        reference: reference
      },
      email: userEmail
    });

  } catch (error) {
    console.error('Fund wallet error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during wallet funding'
    });
  }
});


// Verify payment (called after successful payment callback)
router.post('/verify', authMiddleware, async (req, res) => {
  try {
    const { reference } = req.body;

    if (!reference) {
      return res.status(400).json({
        success: false,
        message: 'Reference is required'
      });
    }

    // Verify with Paystack
    const verifyResponse = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!verifyResponse.data.status) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed'
      });
    }

    const { status, reference: paystackRef, amount } = verifyResponse.data.data;

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
        ['success', paystackRef, transaction.id]
      );

      // Credit user wallet
      await db.execute(
        'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
        [transaction.amount, transaction.user_id]
      );

      console.log(`Wallet funded: User ${transaction.user_id}, Amount: ${transaction.amount}`);

      res.json({
        success: true,
        message: 'Payment verified and wallet funded successfully'
      });
    } else {
      // Update transaction status based on Paystack status
      const transactionStatus = status === 'abandoned' ? 'cancelled' : 'failed';
      await db.execute(
        'UPDATE transactions SET status = ?, external_reference = ? WHERE id = ?',
        [transactionStatus, paystackRef, transaction.id]
      );

      res.status(400).json({
        success: false,
        message: `Payment ${status}`
      });
    }

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed'
    });
  }
});

// Webhook for payment verification (Paystack webhook) - kept as backup
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
        // Map Paystack statuses to transaction statuses
        let transactionStatus;
        switch (status) {
          case 'abandoned':
            transactionStatus = 'cancelled';
            break;
          case 'failed':
          case 'reversed':
            transactionStatus = 'failed';
            break;
          default:
            transactionStatus = 'failed';
        }

        await db.execute(
          'UPDATE transactions SET status = ?, external_reference = ? WHERE id = ?',
          [transactionStatus, data.id, transaction.id]
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

// Transfer funds to another user via email
router.post('/transfer', authMiddleware, [
  body('recipient_email').isEmail().withMessage('Valid recipient email is required'),
  body('amount').isFloat({ min: 1 }).withMessage('Transfer amount must be greater than 0')
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

    const { recipient_email, amount } = req.body;
    const senderId = req.user.id;

    // Check if sender is trying to transfer to themselves
    const [sender] = await db.execute(
      'SELECT email FROM users WHERE id = ?',
      [senderId]
    );

    if (sender[0].email === recipient_email) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer funds to yourself'
      });
    }

    // Find recipient by email
    const [recipients] = await db.execute(
      'SELECT id, full_name FROM users WHERE email = ?',
      [recipient_email]
    );

    if (recipients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Recipient not found'
      });
    }

    const recipient = recipients[0];

    // Check sender's balance
    const [senderBalance] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [senderId]
    );

    const currentBalance = parseFloat(senderBalance[0].wallet_balance);
    if (currentBalance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient wallet balance'
      });
    }

    // Generate unique reference
    const reference = `ZP_P2P_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Start transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Deduct from sender
      await connection.execute(
        'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
        [amount, senderId]
      );

      // Credit to recipient
      await connection.execute(
        'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
        [amount, recipient.id]
      );

      // Create transaction record for sender
      await connection.execute(
        'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
        [senderId, 'p2p_transfer', amount, `${reference}_DEBIT`, 'success', JSON.stringify({
          recipient_email: recipient_email,
          recipient_name: recipient.full_name,
          transfer_type: 'debit'
        })]
      );

      // Create transaction record for recipient
      await connection.execute(
        'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
        [recipient.id, 'p2p_transfer', amount, `${reference}_CREDIT`, 'success', JSON.stringify({
          sender_email: sender[0].email,
          sender_name: req.user.full_name || 'Unknown',
          transfer_type: 'credit'
        })]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Transfer completed successfully',
        data: {
          recipient_name: recipient.full_name,
          amount: amount,
          reference: `${reference}_DEBIT`
        }
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Transfer error:', error);
    res.status(500).json({
      success: false,
      message: 'Transfer failed'
    });
  }
});

// Validate recipient email and get details
router.post('/validate-recipient', authMiddleware, [
  body('email').isEmail().withMessage('Valid email is required')
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

    const { email } = req.body;
    const senderId = req.user.id;

    // Check if sender is trying to validate themselves
    const [sender] = await db.execute(
      'SELECT email FROM users WHERE id = ?',
      [senderId]
    );

    if (sender[0].email === email) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer funds to yourself'
      });
    }

    // Find recipient by email
    const [recipients] = await db.execute(
      'SELECT id, full_name, email FROM users WHERE email = ?',
      [email]
    );

    if (recipients.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found with this email address'
      });
    }

    const recipient = recipients[0];

    res.json({
      success: true,
      recipient: {
        id: recipient.id,
        name: recipient.full_name,
        email: recipient.email
      }
    });

  } catch (error) {
    console.error('Validate recipient error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate recipient'
    });
  }
});

module.exports = router;
