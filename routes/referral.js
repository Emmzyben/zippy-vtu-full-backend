const express = require('express');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// Get referral data
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's referral code
    const [user] = await db.execute(
      'SELECT referral_code FROM users WHERE id = ?',
      [userId]
    );

    if (user.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get referral statistics
    const [stats] = await db.execute(
      `SELECT 
         COUNT(*) as total_referred,
         SUM(CASE WHEN status = 'paid' THEN reward ELSE 0 END) as total_earned,
         SUM(CASE WHEN status = 'pending' THEN reward ELSE 0 END) as pending_earnings
       FROM referrals 
       WHERE referrer_id = ?`,
      [userId]
    );

    const referralStats = stats[0] || {
      total_referred: 0,
      total_earned: 0,
      pending_earnings: 0
    };

    res.json({
      success: true,
      data: {
        referral_code: user[0].referral_code,
        total_referred: parseInt(referralStats.total_referred),
        total_earned: parseFloat(referralStats.total_earned) || 0,
        pending_earnings: parseFloat(referralStats.pending_earnings) || 0
      }
    });

  } catch (error) {
    console.error('Get referral data error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get referral history
router.get('/history', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    // Get referral history with referred user details
    const [referrals] = await db.execute(
      `SELECT 
         r.id,
         r.reward,
         r.status,
         r.created_at,
         u.full_name,
         u.phone,
         u.email
       FROM referrals r
       JOIN users u ON r.referred_id = u.id
       WHERE r.referrer_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), parseInt(offset)]
    );

    // Get total count
    const [countResult] = await db.execute(
      'SELECT COUNT(*) as total FROM referrals WHERE referrer_id = ?',
      [userId]
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      referrals,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get referral history error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Process referral rewards (called after user's first transaction)
router.post('/process-reward', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user was referred by someone
    const [user] = await db.execute(
      'SELECT referred_by FROM users WHERE id = ?',
      [userId]
    );

    if (user.length === 0 || !user[0].referred_by) {
      return res.json({
        success: true,
        message: 'No referral to process'
      });
    }

    // Find the referrer
    const [referrer] = await db.execute(
      'SELECT id FROM users WHERE referral_code = ?',
      [user[0].referred_by]
    );

    if (referrer.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Referrer not found'
      });
    }

    const referrerId = referrer[0].id;

    // Check if reward has already been processed
    const [existingReferral] = await db.execute(
      'SELECT id, status FROM referrals WHERE referrer_id = ? AND referred_id = ?',
      [referrerId, userId]
    );

    if (existingReferral.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Referral record not found'
      });
    }

    if (existingReferral[0].status === 'paid') {
      return res.json({
        success: true,
        message: 'Reward already processed'
      });
    }

    // Process the reward
    const rewardAmount = 200; // ₦200 per referral

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // Update referral status
      await connection.execute(
        'UPDATE referrals SET status = ? WHERE id = ?',
        ['paid', existingReferral[0].id]
      );

      // Credit referrer's wallet
      await connection.execute(
        'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
        [rewardAmount, referrerId]
      );

      // Create transaction record for the reward
      await connection.execute(
        'INSERT INTO transactions (user_id, type, amount, status, details) VALUES (?, ?, ?, ?, ?)',
        [
          referrerId,
          'wallet_fund',
          rewardAmount,
          'success',
          JSON.stringify({
            type: 'referral_reward',
            referred_user_id: userId,
            description: 'Referral reward'
          })
        ]
      );

      await connection.commit();

      res.json({
        success: true,
        message: 'Referral reward processed successfully',
        reward_amount: rewardAmount
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    console.error('Process referral reward error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during reward processing'
    });
  }
});

module.exports = router;