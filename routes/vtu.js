const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

const VT_PASS_API = process.env.VTPASS_BASE_URL;
const API_KEY = process.env.VTPASS_API_KEY;
const PUBLIC_KEY = process.env.VTPASS_PUBLIC_KEY;
const SECRET_KEY = process.env.VTPASS_SECRET_KEY;

// Axios instance for GET requests
const vtpassGet = axios.create({
  baseURL: VT_PASS_API,
  headers: {
    "api-key": API_KEY,
    "public-key": PUBLIC_KEY,
    "Content-Type": "application/json"
  }
});

// Axios instance for POST requests
const vtpassPost = axios.create({
  baseURL: VT_PASS_API,
  headers: {
    "api-key": API_KEY,
    "secret-key": SECRET_KEY,
    "Content-Type": "application/json"
  }
});

// Generate request ID (unique)
const generateRequestId = () => `VTU_${Date.now()}`;

// =================== Airtime ===================
router.post('/airtime', authMiddleware, [
  body('network').notEmpty(),
  body('phone').isMobilePhone(),
  body('amount').isFloat({ min: 50, max: 50000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const { network, phone, amount } = req.body;
    const request_id = generateRequestId();

    const response = await vtpassPost.post("/pay", {
      request_id,
      serviceID: network,
      amount,
      phone
    });

    res.json(response.data);
  } catch (error) {
    console.error("Airtime error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// =================== Data ===================
router.post('/data', authMiddleware, [
  body('network').notEmpty(),
  body('phone').isMobilePhone(),
  body('plan').notEmpty()
], async (req, res) => {
  try {
    const { network, phone, plan } = req.body;
    const request_id = generateRequestId();

    const response = await vtpassPost.post("/pay", {
      request_id,
      serviceID: network,   // e.g., "mtn-data"
      variation_code: plan, // e.g., "mtn-1gb"
      phone
    });

    res.json(response.data);
  } catch (error) {
    console.error("Data error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// =================== Bills (TV, Electricity, etc.) ===================
router.post('/bills', authMiddleware, [
  body('serviceID').notEmpty(),
  body('billersCode').notEmpty(),
  body('variation_code').notEmpty(),
  body('amount').isFloat({ min: 100 }),
  body('phone').isMobilePhone()
], async (req, res) => {
  try {
    const { serviceID, billersCode, variation_code, amount, phone } = req.body;
    const request_id = generateRequestId();

    const response = await vtpassPost.post("/pay", {
      request_id,
      serviceID,
      billersCode,     
      variation_code,  
      amount,
      phone
    });

    res.json(response.data);
  } catch (error) {
    console.error("Bills error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// =================== Fetch Services ===================
router.get('/services', authMiddleware, async (req, res) => {
  try {
    const response = await vtpassGet.get(`/service-categories`);
    res.json(response.data);
  } catch (error) {
    console.error("Services error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// =================== Fetch Variations ===================
router.get('/variations/:serviceID', authMiddleware, async (req, res) => {
  try {
    const { serviceID } = req.params;
    const response = await vtpassGet.get(`/service-variations?serviceID=${serviceID}`);
    res.json(response.data);
  } catch (error) {
    console.error("Variations error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

module.exports = router;
