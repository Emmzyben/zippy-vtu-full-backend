const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../config/database');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Generate referral code
const generateReferralCode = () => {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

// Register
router.post('/register', [
  body('full_name').trim().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('phone').isMobilePhone().withMessage('Please provide a valid phone number'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
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

    const { full_name, email, phone, password, referral_code } = req.body;

    // Check if user already exists
    const [existingUsers] = await db.execute(
      'SELECT id FROM users WHERE email = ? OR phone = ?',
      [email, phone]
    );

    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone already exists'
      });
    }

    // Validate referral code if provided
    let referrerId = null;
    if (referral_code) {
      const [referrer] = await db.execute(
        'SELECT id FROM users WHERE referral_code = ?',
        [referral_code]
      );
      
      if (referrer.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Invalid referral code'
        });
      }
      referrerId = referrer[0].id;
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Generate unique referral code
    let userReferralCode;
    let isUnique = false;
    while (!isUnique) {
      userReferralCode = generateReferralCode();
      const [existing] = await db.execute(
        'SELECT id FROM users WHERE referral_code = ?',
        [userReferralCode]
      );
      isUnique = existing.length === 0;
    }

    // Create user
    const [result] = await db.execute(
      'INSERT INTO users (full_name, email, phone, password, referral_code, referred_by) VALUES (?, ?, ?, ?, ?, ?)',
      [full_name, email, phone, hashedPassword, userReferralCode, referral_code]
    );

    const userId = result.insertId;

    // Create referral record if referred by someone
    if (referrerId) {
      await db.execute(
        'INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)',
        [referrerId, userId]
      );
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get user data without password
    const [newUser] = await db.execute(
      'SELECT id, full_name, email, phone, wallet_balance, referral_code FROM users WHERE id = ?',
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: newUser[0]
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
});

// Login
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required')
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

    const { email, password } = req.body;

    // Find user
    const [users] = await db.execute(
      'SELECT id, full_name, email, phone, password, wallet_balance, referral_code, is_active FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const user = users[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    delete user.password;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
});

// Google OAuth Login/Register
router.post('/google', async (req, res) => {
  try {
    const { credential, referral_code } = req.body;

    if (!credential) {
      return res.status(400).json({
        success: false,
        message: 'Google credential is required'
      });
    }

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    if (!email || !name) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Google account data'
      });
    }

    // Check if user already exists
    const [existingUsers] = await db.execute(
      'SELECT id, full_name, email, phone, wallet_balance, referral_code, is_active FROM users WHERE email = ? OR google_id = ?',
      [email, googleId]
    );

    let user;
    let isNewUser = false;

    if (existingUsers.length > 0) {
      // User exists, update Google ID if not set
      user = existingUsers[0];
      
      if (!user.google_id) {
        await db.execute(
          'UPDATE users SET google_id = ?, profile_picture = ? WHERE id = ?',
          [googleId, picture, user.id]
        );
      }

      if (!user.is_active) {
        return res.status(401).json({
          success: false,
          message: 'Account is deactivated. Please contact support.'
        });
      }
    } else {
      // Create new user
      isNewUser = true;
      
      // Validate referral code if provided
      let referrerId = null;
      if (referral_code) {
        const [referrer] = await db.execute(
          'SELECT id FROM users WHERE referral_code = ?',
          [referral_code]
        );
        
        if (referrer.length === 0) {
          return res.status(400).json({
            success: false,
            message: 'Invalid referral code'
          });
        }
        referrerId = referrer[0].id;
      }

      // Generate unique referral code
      let userReferralCode;
      let isUnique = false;
      while (!isUnique) {
        userReferralCode = generateReferralCode();
        const [existing] = await db.execute(
          'SELECT id FROM users WHERE referral_code = ?',
          [userReferralCode]
        );
        isUnique = existing.length === 0;
      }

      // Create user with Google data
      const [result] = await db.execute(
        'INSERT INTO users (full_name, email, google_id, profile_picture, referral_code, referred_by, password) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [name, email, googleId, picture, userReferralCode, referral_code, 'google_oauth']
      );

      const userId = result.insertId;

      // Create referral record if referred by someone
      if (referrerId) {
        await db.execute(
          'INSERT INTO referrals (referrer_id, referred_id) VALUES (?, ?)',
          [referrerId, userId]
        );
      }

      // Get the created user
      const [newUsers] = await db.execute(
        'SELECT id, full_name, email, phone, wallet_balance, referral_code, profile_picture FROM users WHERE id = ?',
        [userId]
      );
      user = newUsers[0];
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: isNewUser ? 'Account created successfully with Google' : 'Login successful',
      token,
      user: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        phone: user.phone,
        wallet_balance: user.wallet_balance,
        referral_code: user.referral_code,
        profile_picture: user.profile_picture
      },
      isNewUser
    });

  } catch (error) {
    console.error('Google OAuth error:', error);
    res.status(500).json({
      success: false,
      message: 'Google authentication failed'
    });
  }
});

module.exports = router;