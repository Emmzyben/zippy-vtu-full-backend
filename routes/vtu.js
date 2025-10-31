const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const db = require('../config/database');
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

// Generate request ID in the format YYYYMMDDHHII + random alphanumeric string
const generateRequestId = () => {
  // Get current date in Africa/Lagos timezone (GMT +1)
  const now = new Date();
  const lagosTime = new Date(now.getTime() + (1 * 60 * 60 * 1000)); // Add 1 hour for GMT+1

  // Format to YYYYMMDDHHII
  const year = lagosTime.getUTCFullYear();
  const month = String(lagosTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(lagosTime.getUTCDate()).padStart(2, '0');
  const hours = String(lagosTime.getUTCHours()).padStart(2, '0');
  const minutes = String(lagosTime.getUTCMinutes()).padStart(2, '0');
  const dateString = `${year}${month}${day}${hours}${minutes}`;

  // Generate random alphanumeric string (8 characters for uniqueness)
  const crypto = require('crypto');
  const randomString = crypto.randomBytes(4).toString('hex'); // 8 characters

  // Concatenate: first 12 numeric (date), then random string
  return `${dateString}${randomString}`;
};

// =================== Airtime ===================
router.post('/airtime', authMiddleware, [
  body('network').isIn(['mtn', 'glo', 'airtel', 'etisalat']),
  body('phone').isMobilePhone(),
  body('amount').isFloat({ min: 50, max: 50000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user.id;
    const { network, phone, amount } = req.body;
    const request_id = generateRequestId();

    // Check wallet balance before proceeding
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const currentBalance = parseFloat(users[0].wallet_balance);
    if (currentBalance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient wallet balance' });
    }

    // ✅ Map 'etisalat' to VTpass '9mobile'
    const serviceMap = {
      mtn: 'mtn',
      glo: 'glo',
      airtel: 'airtel',
      etisalat: 'etisalat'
    };
    const serviceID = serviceMap[network];
    if (!serviceID) {
      return res.status(400).json({ success: false, error: 'Invalid network selected' });
    }

    // Step 1: Make purchase
    const purchaseResponse = await vtpassPost.post("/pay", {
      request_id,
      serviceID,
      amount,
      phone
    });

    const purchaseData = purchaseResponse.data;
    console.log("Exact purchase response from VTpass:", JSON.stringify(purchaseData, null, 2));

    // Step 2: Immediately requery transaction status
    let statusResponse;
    try {
      const requeryResponse = await vtpassPost.post("/requery", { request_id });
      statusResponse = requeryResponse.data;
      console.log("Exact requery response from VTpass:", JSON.stringify(statusResponse, null, 2));
    } catch (requeryError) {
      console.error("Requery error:", requeryError.response?.data || requeryError.message);
      return res.status(500).json({
        success: false,
        error: "Unable to confirm transaction status",
        raw: purchaseData
      });
    }

    const txStatus = statusResponse?.content?.transactions?.status || "unknown";

    // Step 3: Map VTpass status into success/failure/pending and record all transactions
    // VTpass statuses: initiated (transaction initiated), pending (awaiting confirmation), delivered (successful)
    const reference = request_id;
    const transactionDetails = {
      network: network,
      phone: phone,
      amount: amount,
      serviceID: serviceID,
      request_id: request_id
    };

    let responsePayload;
    let transactionStatus;

    if (txStatus === "delivered") {
      transactionStatus = 'success';
      responsePayload = { success: true, status: "success", data: statusResponse };

      try {
        // Start database transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        // Deduct from wallet
        await connection.execute(
          'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
          [amount, userId]
        );

        // Create transaction record
        await connection.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'airtime', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );

        await connection.commit();
        connection.release();

        console.log(`Airtime transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
        // Continue with response even if DB fails
      }
    } else if (txStatus === "pending" || txStatus === "initiated") {
      transactionStatus = 'pending';
      responsePayload = { success: true, status: "pending", data: statusResponse };

      try {
        // Record pending transaction (don't deduct wallet yet)
        await db.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'airtime', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );
        console.log(`Airtime transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
      }
    } else {
      transactionStatus = 'failed';
      responsePayload = { success: false, status: "failed", data: statusResponse };

      try {
        // Record failed transaction (don't deduct wallet)
        await db.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'airtime', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );
        console.log(`Airtime transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
      }
    }

    console.log("Response sent to frontend:", JSON.stringify(responsePayload, null, 2));
    return res.json(responsePayload);

  } catch (error) {
    console.error("Airtime error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});



// =================== Data ===================
router.post('/data', authMiddleware, [
  body('network').notEmpty(),
  body('phone').isMobilePhone(),
  body('variation_code').notEmpty(),
  body('amount').isFloat({ min: 50, max: 500000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const userId = req.user.id;
    const { network, phone, variation_code, amount } = req.body;
    const request_id = generateRequestId();

    // Check wallet balance before proceeding
    const [users] = await db.execute(
      'SELECT wallet_balance FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const currentBalance = parseFloat(users[0].wallet_balance);
    if (currentBalance < amount) {
      return res.status(400).json({ success: false, error: 'Insufficient wallet balance' });
    }

    // Map network to serviceID for data
    const serviceMap = {
      mtn: 'mtn-data',
      glo: 'glo-data',
      airtel: 'airtel-data',
      etisalat: 'etisalat-data'
    };
    const serviceID = serviceMap[network];
    if (!serviceID) {
      return res.status(400).json({ success: false, error: 'Invalid network selected' });
    }

    // Step 1: Make purchase
    const purchaseResponse = await vtpassPost.post("/pay", {
      request_id,
      serviceID,
      variation_code,
      phone
    });

    const purchaseData = purchaseResponse.data;
    console.log("Exact data purchase response from VTpass:", JSON.stringify(purchaseData, null, 2));

    // Step 2: Immediately requery transaction status
    let statusResponse;
    try {
      const requeryResponse = await vtpassPost.post("/requery", { request_id });
      statusResponse = requeryResponse.data;
      console.log("Exact data requery response from VTpass:", JSON.stringify(statusResponse, null, 2));
    } catch (requeryError) {
      console.error("Data requery error:", requeryError.response?.data || requeryError.message);
      return res.status(500).json({
        success: false,
        error: "Unable to confirm transaction status",
        raw: purchaseData
      });
    }

    const txStatus = statusResponse?.content?.transactions?.status || "unknown";

    // Step 3: Map VTpass status into success/failure/pending and record all transactions
    const reference = request_id;
    const transactionDetails = {
      network: network,
      phone: phone,
      variation_code: variation_code,
      amount: amount,
      serviceID: serviceID,
      request_id: request_id
    };

    let responsePayload;
    let transactionStatus;

    if (txStatus === "delivered") {
      transactionStatus = 'success';
      responsePayload = { success: true, status: "success", data: statusResponse };

      try {
        // Start database transaction
        const connection = await db.getConnection();
        await connection.beginTransaction();

        // Deduct from wallet
        await connection.execute(
          'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
          [amount, userId]
        );

        // Create transaction record
        await connection.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'data', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );

        await connection.commit();
        connection.release();

        console.log(`Data transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
        // Continue with response even if DB fails
      }
    } else if (txStatus === "pending" || txStatus === "initiated") {
      transactionStatus = 'pending';
      responsePayload = { success: true, status: "pending", data: statusResponse };

      try {
        // Record pending transaction (don't deduct wallet yet)
        await db.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'data', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );
        console.log(`Data transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
      }
    } else {
      transactionStatus = 'failed';
      const errorMessage = statusResponse?.content?.transactions?.product_name ?
        `Data purchase failed for ${statusResponse.content.transactions.product_name}` :
        'Data purchase failed';
      responsePayload = { success: false, status: "failed", error: errorMessage, data: statusResponse };

      try {
        // Record failed transaction (don't deduct wallet)
        await db.execute(
          'INSERT INTO transactions (user_id, type, amount, reference, status, details) VALUES (?, ?, ?, ?, ?, ?)',
          [userId, 'data', amount, reference, transactionStatus, JSON.stringify(transactionDetails)]
        );
        console.log(`Data transaction recorded: User ${userId}, Amount: ${amount}, Network: ${network}, Status: ${transactionStatus}`);
      } catch (dbError) {
        console.error('Database error recording transaction:', dbError);
      }
    }

    console.log("Data response sent to frontend:", JSON.stringify(responsePayload, null, 2));
    return res.json(responsePayload);

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

// =================== Fetch Service Categories ===================
router.get('/services',authMiddleware, async (req, res) => {
  try {
    const response = await vtpassGet.get(`/service-categories`);
    res.json(response.data);
  } catch (error) {
    console.error("Service categories error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// =================== Fetch Service IDs ===================
router.get('/services/:identifier', authMiddleware, async (req, res) => {
  try {
    const { identifier } = req.params;
    const response = await vtpassGet.get(`/services?identifier=${identifier}`);
    res.json(response.data);
  } catch (error) {
    console.error("Service IDs error:", error.response?.data || error.message);
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

// =================== Transaction Status Requery ===================
router.post('/requery', authMiddleware, [
  body('request_id').notEmpty().withMessage('request_id is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { request_id } = req.body;
    const response = await vtpassPost.post("/requery", { request_id });
    res.json(response.data);
  } catch (error) {
    console.error("Requery error:", error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

module.exports = router;
