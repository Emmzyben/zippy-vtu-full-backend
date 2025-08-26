const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

const VT_PASS_API = process.env.VTPASS_BASE_URL || "https://vtpass.com/api";
const USERNAME = process.env.VTPASS_USERNAME;
const PASSWORD = process.env.VTPASS_PASSWORD;

// Axios instance for VTpass
const vtpass = axios.create({
  baseURL: VT_PASS_API,
  auth: {
    username: USERNAME,
    password: PASSWORD
  },
  headers: {
    "Content-Type": "application/json"
  }
});

// Generate request ID (unique)
const generateRequestId = () => `VTU_${Date.now()}`;

// =================== Airtime ===================
router.post('/airtime', authMiddleware, [
  body('network').notEmpty().withMessage('Network is required'),
  body('phone').isMobilePhone().withMessage('Invalid phone number'),
  body('amount').isFloat({ min: 50, max: 50000 }).withMessage('Amount must be between ₦50 and ₦50,000')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { network, phone, amount } = req.body;

    const request_id = generateRequestId();

    const response = await vtpass.post("/pay", {
      request_id,
      serviceID: network,   
      amount,
      phone
    });

    return res.json(response.data);

  } catch (error) {
    console.error("Airtime error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Server error during airtime purchase",
      error: error.response?.data || error.message
    });
  }
});

// =================== Data ===================
router.post('/data', authMiddleware, [
  body('network').notEmpty().withMessage('Network is required'),
  body('phone').isMobilePhone().withMessage('Invalid phone number'),
  body('plan').notEmpty().withMessage('Data plan variation code is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { network, phone, plan } = req.body;
    const request_id = generateRequestId();

    const response = await vtpass.post("/pay", {
      request_id,
      serviceID: network,   // e.g., "mtn-data"
      variation_code: plan, // e.g., "mtn-1gb"
      phone
    });

    return res.json(response.data);

  } catch (error) {
    console.error("Data error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Server error during data purchase",
      error: error.response?.data || error.message
    });
  }
});

// =================== Bills (Electricity, TV, etc.) ===================
router.post('/bills', authMiddleware, [
  body('serviceID').notEmpty().withMessage('ServiceID is required'),
  body('billersCode').notEmpty().withMessage('BillersCode is required'),
  body('variation_code').notEmpty().withMessage('Variation code is required'),
  body('amount').isFloat({ min: 100 }).withMessage('Minimum amount is ₦100'),
  body('phone').isMobilePhone().withMessage('Valid phone number required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { serviceID, billersCode, variation_code, amount, phone } = req.body;
    const request_id = generateRequestId();

    const response = await vtpass.post("/pay", {
      request_id,
      serviceID,       // e.g., "dstv", "gotv", "eko-electric"
      billersCode,     // e.g., Smartcard number / Meter number
      variation_code,  // Package code (e.g., "dstv-padi")
      amount,
      phone
    });

    return res.json(response.data);

  } catch (error) {
    console.error("Bills error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Server error during bill payment",
      error: error.response?.data || error.message
    });
  }
});


// =================== Fetch Available Services ===================
router.get('/services', authMiddleware, async (req, res) => {
  try {
    const response = await vtpass.get(`/service-categories`);
    res.json(response.data);
  } catch (error) {
    console.error("Services error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Server error fetching services",
      error: error.response?.data || error.message
    });
  }
});

// =================== Fetch Data Plans / Variations ===================
router.get('/variations/:serviceID', authMiddleware, async (req, res) => {
  try {
    const { serviceID } = req.params;

    const response = await vtpass.get(`/service-variations?serviceID=${serviceID}`);

    res.json(response.data);

  } catch (error) {
    console.error("Variations error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Server error fetching service variations",
      error: error.response?.data || error.message
    });
  }
});

module.exports = router;
