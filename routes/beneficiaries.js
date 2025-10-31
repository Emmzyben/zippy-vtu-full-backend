const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// Get all beneficiaries for a user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [beneficiaries] = await db.execute(
      'SELECT id, phone_number, name, network, created_at FROM beneficiaries WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    res.json({ success: true, beneficiaries });
  } catch (error) {
    console.error('Get beneficiaries error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch beneficiaries' });
  }
});

// Add a new beneficiary
router.post('/', authMiddleware, [
  body('phone_number').isMobilePhone().withMessage('Valid phone number is required'),
  body('name').optional().isLength({ min: 1, max: 255 }).withMessage('Name must be between 1 and 255 characters'),
  body('network').optional().isIn(['mtn', 'glo', 'airtel', 'etisalat']).withMessage('Invalid network')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user.id;
    const { phone_number, name, network } = req.body;

    // Check if beneficiary already exists
    const [existing] = await db.execute(
      'SELECT id FROM beneficiaries WHERE user_id = ? AND phone_number = ?',
      [userId, phone_number]
    );

    if (existing.length > 0) {
      return res.status(400).json({ success: false, error: 'Beneficiary already exists' });
    }

    // Add new beneficiary
    const [result] = await db.execute(
      'INSERT INTO beneficiaries (user_id, phone_number, name, network) VALUES (?, ?, ?, ?)',
      [userId, phone_number, name || null, network || null]
    );

    res.json({
      success: true,
      message: 'Beneficiary added successfully',
      beneficiary: {
        id: result.insertId,
        phone_number,
        name,
        network
      }
    });
  } catch (error) {
    console.error('Add beneficiary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to add beneficiary' });
  }
});

// Delete a beneficiary
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const beneficiaryId = req.params.id;

    const [result] = await db.execute(
      'DELETE FROM beneficiaries WHERE id = ? AND user_id = ?',
      [beneficiaryId, userId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'Beneficiary not found' });
    }

    res.json({ success: true, message: 'Beneficiary deleted successfully' });
  } catch (error) {
    console.error('Delete beneficiary error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete beneficiary' });
  }
});

module.exports = router;
