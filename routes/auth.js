const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const sendEmail = require('../services/sendEmail');
const db = require('../config/database');

const router = express.Router();



// Register
router.post('/register', [
  body('full_name').trim().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
  body('phone').isMobilePhone().withMessage('Please provide a valid phone number'),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{}|;':",./<>?]).*$/).withMessage('Password must be at least 8 characters, contain at least one capital letter, and one special character')
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

    const { full_name, email, phone, password } = req.body;

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

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user as unverified
    const [result] = await db.execute(
      'INSERT INTO users (full_name, email, phone, password, is_verified) VALUES (?, ?, ?, ?, ?)',
      [full_name, email, phone, hashedPassword, false]
    );

    const userId = result.insertId;

    // Send verification email
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user with verification code
    await db.execute(
      'UPDATE users SET email_verification_code = ?, email_code_expires_at = ? WHERE id = ?',
      [verificationCode, codeExpiresAt, userId]
    );

    // Send verification email
    const subject = 'Verify Your Email - Zippy Pay';
    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #5C2D91;">Verify Your Email</h2>
        <p>Hello ${full_name},</p>
        <p>Please verify your email address to complete your Zippy Pay registration.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
          <h3 style="color: #5C2D91; margin: 0 0 10px 0;">Your Verification Code</h3>
          <span style="font-size: 32px; font-weight: bold; color: #F59E0B; letter-spacing: 5px;">${verificationCode}</span>
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't create this account, please ignore this email.</p>
        <p>Best regards,<br>Zippy Pay Team</p>
      </div>
    `;

    const emailSent = await sendEmail(email, subject, message);

    if (!emailSent) {
      // If email fails, delete the user and return error
      await db.execute('DELETE FROM users WHERE id = ?', [userId]);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try registering again.'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get user data
    const [newUsers] = await db.execute(
      'SELECT id, full_name, email, phone, wallet_balance, is_verified FROM users WHERE id = ?',
      [userId]
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please check your email for verification code.',
      token,
      user: newUsers[0]
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
      'SELECT id, full_name, email, phone, password, wallet_balance, is_active, is_verified FROM users WHERE email = ?',
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

    // Check if user needs email verification
    if (!user.is_verified) {
      // Send verification code if not verified
      const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      await db.execute(
        'UPDATE users SET email_verification_code = ?, email_code_expires_at = ? WHERE id = ?',
        [verificationCode, codeExpiresAt, user.id]
      );

      // Send verification email
      const subject = 'Verify Your Email - Zippy Pay';
      const message = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #5C2D91;">Verify Your Email</h2>
          <p>Hello ${user.full_name},</p>
          <p>Please verify your email address to complete your Zippy Pay account setup.</p>
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
            <h3 style="color: #5C2D91; margin: 0 0 10px 0;">Your Verification Code</h3>
            <span style="font-size: 32px; font-weight: bold; color: #F59E0B; letter-spacing: 5px;">${verificationCode}</span>
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't create this account, please ignore this email.</p>
          <p>Best regards,<br>Zippy Pay Team</p>
        </div>
      `;

      await sendEmail(user.email, subject, message);
    }

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

// Forgot Password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email')
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

    // Find user by email
    const [users] = await db.execute(
      'SELECT id, full_name FROM users WHERE email = ? AND is_active = TRUE',
      [email]
    );

    if (users.length === 0) {
      // Don't reveal if email exists or not for security
      return res.json({
        success: true,
        message: 'If an account with this email exists, a password reset link has been sent.'
      });
    }

    const user = users[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Save reset token
    await db.execute(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)',
      [user.id, resetToken, expiresAt]
    );

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    const subject = 'Password Reset - Zippy Pay';
    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #5C2D91;">Password Reset Request</h2>
        <p>Hello ${user.full_name},</p>
        <p>You requested a password reset for your Zippy Pay account.</p>
        <p>Please click the link below to reset your password:</p>
        <a href="${resetUrl}" style="background-color: #F59E0B; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin: 10px 0;">Reset Password</a>
        <p>This link will expire in 15 minutes.</p>
        <p>If you didn't request this reset, please ignore this email.</p>
        <p>Best regards,<br>Zippy Pay Team</p>
      </div>
    `;

    await sendEmail(email, subject, message);

    res.json({
      success: true,
      message: 'If an account with this email exists, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset request'
    });
  }
});

// Reset Password
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('newPassword').isLength({ min: 8 }).matches(/^(?=.*[A-Z])(?=.*[!@#$%^&*()_+\-=\[\]{}|;':",./<>?]).*$/).withMessage('New password must be at least 8 characters, contain at least one capital letter, and one special character')
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

    const { token, newPassword } = req.body;

    // Find valid reset token
    const [resetRecords] = await db.execute(
      'SELECT id, user_id FROM password_resets WHERE token = ? AND expires_at > NOW() AND used = FALSE',
      [token]
    );

    if (resetRecords.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    const resetRecord = resetRecords[0];

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update user password
    await db.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, resetRecord.user_id]
    );

    // Mark token as used
    await db.execute(
      'UPDATE password_resets SET used = TRUE WHERE id = ?',
      [resetRecord.id]
    );

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during password reset'
    });
  }
});



// Verify Email with Code
router.post('/verify-email', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Verification code must be 6 digits')
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

    const { email, code } = req.body;

    // Find user with valid verification code
    const [users] = await db.execute(
      'SELECT id, full_name, email FROM users WHERE email = ? AND email_verification_code = ? AND email_code_expires_at > NOW() AND is_verified = FALSE',
      [email, code]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const user = users[0];

    // Update user as verified
    await db.execute(
      'UPDATE users SET is_verified = TRUE, email_verification_code = NULL, email_code_expires_at = NULL WHERE id = ?',
      [user.id]
    );

    // Generate JWT token for auto-login
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get user data
    const [verifiedUser] = await db.execute(
      'SELECT id, full_name, email, phone, wallet_balance, is_verified FROM users WHERE id = ?',
      [user.id]
    );

    res.json({
      success: true,
      message: 'Email verified successfully! Welcome to Zippy Pay.',
      token: jwtToken,
      user: verifiedUser[0]
    });

  } catch (error) {
    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during email verification'
    });
  }
});

// Send Verification Code
router.post('/send-verification', [
  body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email')
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

    // Find unverified user
    const [users] = await db.execute(
      'SELECT id, full_name FROM users WHERE email = ? AND is_verified = FALSE AND is_active = TRUE',
      [email]
    );

    if (users.length === 0) {
      // Don't reveal if email exists for security
      return res.json({
        success: true,
        message: 'If an unverified account exists, a verification code has been sent.'
      });
    }

    const user = users[0];

    // Generate new verification code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Update user with new code
    await db.execute(
      'UPDATE users SET email_verification_code = ?, email_code_expires_at = ? WHERE id = ?',
      [verificationCode, codeExpiresAt, user.id]
    );

    // Send verification email with code
    const subject = 'Verify Your Email - Zippy Pay';
    const message = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #5C2D91;">Verify Your Email</h2>
        <p>Hello ${user.full_name},</p>
        <p>Please verify your email address to complete your Zippy Pay registration.</p>
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
          <h3 style="color: #5C2D91; margin: 0 0 10px 0;">Your Verification Code</h3>
          <span style="font-size: 32px; font-weight: bold; color: #F59E0B; letter-spacing: 5px;">${verificationCode}</span>
        </div>
        <p>This code will expire in 10 minutes.</p>
        <p>If you didn't create this account, please ignore this email.</p>
        <p>Best regards,<br>Zippy Pay Team</p>
      </div>
    `;

    const emailSent = await sendEmail(email, subject, message);

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification email. Please try again.'
      });
    }

    res.json({
      success: true,
      message: 'Verification code sent successfully.',
      code: verificationCode // For testing purposes - remove in production
    });

  } catch (error) {
    console.error('Send verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during verification code send'
    });
  }
});

// Verify Code
router.post('/verify-code', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('code').isLength({ min: 6, max: 6 }).withMessage('Verification code must be 6 digits')
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

    const { email, code } = req.body;

    // Find user with valid verification code
    const [users] = await db.execute(
      'SELECT id, full_name, email FROM users WHERE email = ? AND email_verification_code = ? AND email_code_expires_at > NOW() AND is_verified = FALSE',
      [email, code]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const user = users[0];

    // Update user as verified
    await db.execute(
      'UPDATE users SET is_verified = TRUE, email_verification_code = NULL, email_code_expires_at = NULL WHERE id = ?',
      [user.id]
    );

    // Generate JWT token for auto-login
    const jwtToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Get user data
    const [verifiedUser] = await db.execute(
      'SELECT id, full_name, email, phone, wallet_balance, is_verified FROM users WHERE id = ?',
      [user.id]
    );

    res.json({
      success: true,
      message: 'Email verified successfully! Welcome to Zippy Pay.',
      token: jwtToken,
      user: verifiedUser[0]
    });

  } catch (error) {
    console.error('Code verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during code verification'
    });
  }
});

module.exports = router;
