const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');

const router = express.Router();

// Get all email beneficiaries for a user
router.get('/', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const [beneficiaries] = await db.execute(
            'SELECT id, email, name, created_at FROM email_beneficiaries WHERE user_id = ? ORDER BY created_at DESC',
            [userId]
        );

        res.json({ success: true, beneficiaries });
    } catch (error) {
        console.error('Get email beneficiaries error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to fetch beneficiaries' });
    }
});

// Add a new email beneficiary
router.post('/', authMiddleware, [
    body('email').trim().isEmail().withMessage('Valid email is required'),
    body('name').optional().trim().isLength({ min: 1, max: 255 }).withMessage('Name must be between 1 and 255 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ success: false, errors: errors.array() });
        }

        const userId = req.user.id;
        const { email, name } = req.body;

        // Check if beneficiary already exists
        const [existing] = await db.execute(
            'SELECT id FROM email_beneficiaries WHERE user_id = ? AND email = ?',
            [userId, email]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Beneficiary already exists' });
        }

        // Add new beneficiary
        const [result] = await db.execute(
            'INSERT INTO email_beneficiaries (user_id, email, name) VALUES (?, ?, ?)',
            [userId, email, name || null]
        );

        res.json({
            success: true,
            message: 'Beneficiary added successfully',
            beneficiary: {
                id: result.insertId,
                email,
                name
            }
        });
    } catch (error) {
        console.error('Add email beneficiary error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to add beneficiary' });
    }
});

// Delete a email beneficiary
router.delete('/:id', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const beneficiaryId = req.params.id;

        const [result] = await db.execute(
            'DELETE FROM email_beneficiaries WHERE id = ? AND user_id = ?',
            [beneficiaryId, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, error: 'Beneficiary not found' });
        }

        res.json({ success: true, message: 'Beneficiary deleted successfully' });
    } catch (error) {
        console.error('Delete email beneficiary error:', error.message);
        res.status(500).json({ success: false, error: 'Failed to delete beneficiary' });
    }
});

module.exports = router;
