const express = require('express');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// Get user transactions
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    // Build query conditions
    let whereConditions = 'WHERE user_id = ?';
    let queryParams = [userId];

    if (type && type !== 'all') {
      whereConditions += ' AND type = ?';
      queryParams.push(type);
    }

    if (status && status !== 'all') {
      whereConditions += ' AND status = ?';
      queryParams.push(status);
    }

    // Get transactions with pagination
    // Get transactions with pagination
    const limitNum = parseInt(limit) || 20;
    const offsetNum = parseInt(offset) || 0;

    const [transactions] = await db.execute(
      `SELECT id, type, amount, status, reference, details, created_at, updated_at 
       FROM transactions
       ${whereConditions} 
       ORDER BY created_at DESC 
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      queryParams
    );

    // Get total count
    const [countResult] = await db.execute(
      `SELECT COUNT(*) as total FROM transactions ${whereConditions}`,
      queryParams
    );

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    // Parse JSON details
    const formattedTransactions = transactions.map(transaction => ({
      ...transaction,
      details: transaction.details ? JSON.parse(transaction.details) : null
    }));

    res.json({
      success: true,
      transactions: formattedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get transaction by ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [transactions] = await db.execute(
      'SELECT * FROM transactions WHERE id = ? AND user_id = ?',
      [id, userId]
    );

    if (transactions.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }

    const transaction = transactions[0];
    transaction.details = transaction.details ? JSON.parse(transaction.details) : null;

    res.json({
      success: true,
      transaction
    });

  } catch (error) {
    console.error('Get transaction error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get transaction statistics
router.get('/stats/summary', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get transaction counts by status
    const [statusStats] = await db.execute(
      `SELECT 
         status,
         COUNT(*) as count,
         SUM(amount) as total_amount
       FROM transactions 
       WHERE user_id = ? 
       GROUP BY status`,
      [userId]
    );

    // Get transaction counts by type
    const [typeStats] = await db.execute(
      `SELECT 
         type,
         COUNT(*) as count,
         SUM(amount) as total_amount
       FROM transactions 
       WHERE user_id = ? 
       GROUP BY type`,
      [userId]
    );

    // Get monthly statistics
    const [monthlyStats] = await db.execute(
      `SELECT 
         DATE_FORMAT(created_at, '%Y-%m') as month,
         COUNT(*) as count,
         SUM(amount) as total_amount
       FROM transactions 
       WHERE user_id = ? 
         AND created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(created_at, '%Y-%m')
       ORDER BY month DESC`,
      [userId]
    );

    res.json({
      success: true,
      stats: {
        byStatus: statusStats,
        byType: typeStats,
        monthly: monthlyStats
      }
    });

  } catch (error) {
    console.error('Get transaction stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// Get distinct transaction types for the user
router.get('/types', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;

    const [types] = await db.execute(
      'SELECT DISTINCT type FROM transactions WHERE user_id = ? ORDER BY type',
      [userId]
    );

    const transactionTypes = types.map(row => row.type);

    res.json({
      success: true,
      types: transactionTypes
    });

  } catch (error) {
    console.error('Get transaction types error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;
