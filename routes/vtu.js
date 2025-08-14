const express = require('express');
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const axios = require('axios');

const router = express.Router();

// Mock VTU service for demo purposes
const mockVTUService = {
  async buyAirtime(data) {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Simulate 95% success rate
    const isSuccess = Math.random() > 0.05;
    
    return {
      success: isSuccess,
      message: isSuccess ? 'Airtime purchase successful' : 'Airtime purchase failed',
      reference: `VTU_${Date.now()}`,
      data: isSuccess ? data : null
    };
  },

  async buyData(data) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const isSuccess = Math.random() > 0.05;
    
    return {
      success: isSuccess,
      message: isSuccess ? 'Data purchase successful' : 'Data purchase failed',
      reference: `VTU_${Date.now()}`,
      data: isSuccess ? data : null
    };
  },

  async payBill(data) {
    await new Promise(resolve => setTimeout(resolve, 1500));
    const isSuccess = Math.random() > 0.1; // 90% success rate for bills
    
    return {
      success: isSuccess,
      message: isSuccess ? 'Bill payment successful' : 'Bill payment failed',
      reference: `BILL_${Date.now()}`,
      data: isSuccess ? data : null
    };
  }
};

// Buy airtime
router.post('/airtime', authMiddleware, [
  body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']).withMessage('Invalid network'),
  body('phone').isMobilePhone().withMessage('Invalid phone number'),
  body('amount').isFloat({ min: 50, max: 50000 }).withMessage('Amount must be between ₦50 and ₦50,000')
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

    const { network, phone, amount } = req.body;

    // Call VTU service
    const vtuResponse = await mockVTUService.buyAirtime({
      network,
      phone,
      amount
    });

    if (!vtuResponse.success) {
      return res.status(400).json({
        success: false,
        message: vtuResponse.message
      });
    }

    res.json({
      success: true,
      message: 'Airtime purchase successful',
      data: {
        network,
        phone,
        amount,
        reference: vtuResponse.reference
      }
    });

  } catch (error) {
    console.error('Airtime purchase error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during airtime purchase'
    });
  }
});

// Buy data
router.post('/data', authMiddleware, [
  body('network').isIn(['mtn', 'glo', 'airtel', '9mobile']).withMessage('Invalid network'),
  body('phone').isMobilePhone().withMessage('Invalid phone number'),
  body('plan').notEmpty().withMessage('Data plan is required')
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

    const { network, phone, plan } = req.body;

    // Call VTU service
    const vtuResponse = await mockVTUService.buyData({
      network,
      phone,
      plan
    });

    if (!vtuResponse.success) {
      return res.status(400).json({
        success: false,
        message: vtuResponse.message
      });
    }

    res.json({
      success: true,
      message: 'Data purchase successful',
      data: {
        network,
        phone,
        plan,
        reference: vtuResponse.reference
      }
    });

  } catch (error) {
    console.error('Data purchase error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during data purchase'
    });
  }
});

// Pay bills
router.post('/bills', authMiddleware, [
  body('category').isIn(['electricity', 'cable', 'internet', 'water']).withMessage('Invalid bill category'),
  body('provider').notEmpty().withMessage('Provider is required'),
  body('accountNumber').notEmpty().withMessage('Account number is required'),
  body('amount').isFloat({ min: 100 }).withMessage('Minimum amount is ₦100')
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

    const { category, provider, accountNumber, amount, customerName } = req.body;

    // Call VTU service
    const vtuResponse = await mockVTUService.payBill({
      category,
      provider,
      accountNumber,
      amount,
      customerName
    });

    if (!vtuResponse.success) {
      return res.status(400).json({
        success: false,
        message: vtuResponse.message
      });
    }

    res.json({
      success: true,
      message: 'Bill payment successful',
      data: {
        category,
        provider,
        accountNumber,
        amount,
        customerName,
        reference: vtuResponse.reference
      }
    });

  } catch (error) {
    console.error('Bill payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during bill payment'
    });
  }
});

// Get data plans for a network
router.get('/data-plans/:network', authMiddleware, async (req, res) => {
  try {
    const { network } = req.params;

    if (!['mtn', 'glo', 'airtel', '9mobile'].includes(network)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid network'
      });
    }

    // Mock data plans
    const dataPlans = {
      mtn: [
        { id: 'mtn-1gb', name: '1GB - 30 Days', price: 350, data: '1GB', validity: '30 Days' },
        { id: 'mtn-2gb', name: '2GB - 30 Days', price: 700, data: '2GB', validity: '30 Days' },
        { id: 'mtn-5gb', name: '5GB - 30 Days', price: 1500, data: '5GB', validity: '30 Days' },
        { id: 'mtn-10gb', name: '10GB - 30 Days', price: 2500, data: '10GB', validity: '30 Days' }
      ],
      glo: [
        { id: 'glo-1gb', name: '1GB - 30 Days', price: 350, data: '1GB', validity: '30 Days' },
        { id: 'glo-2gb', name: '2GB - 30 Days', price: 700, data: '2GB', validity: '30 Days' },
        { id: 'glo-5gb', name: '5GB - 30 Days', price: 1500, data: '5GB', validity: '30 Days' },
        { id: 'glo-10gb', name: '10GB - 30 Days', price: 2500, data: '10GB', validity: '30 Days' }
      ],
      airtel: [
        { id: 'airtel-1gb', name: '1GB - 30 Days', price: 350, data: '1GB', validity: '30 Days' },
        { id: 'airtel-2gb', name: '2GB - 30 Days', price: 700, data: '2GB', validity: '30 Days' },
        { id: 'airtel-5gb', name: '5GB - 30 Days', price: 1500, data: '5GB', validity: '30 Days' },
        { id: 'airtel-10gb', name: '10GB - 30 Days', price: 2500, data: '10GB', validity: '30 Days' }
      ],
      '9mobile': [
        { id: '9mobile-1gb', name: '1GB - 30 Days', price: 350, data: '1GB', validity: '30 Days' },
        { id: '9mobile-2gb', name: '2GB - 30 Days', price: 700, data: '2GB', validity: '30 Days' },
        { id: '9mobile-5gb', name: '5GB - 30 Days', price: 1500, data: '5GB', validity: '30 Days' },
        { id: '9mobile-10gb', name: '10GB - 30 Days', price: 2500, data: '10GB', validity: '30 Days' }
      ]
    };

    res.json({
      success: true,
      plans: dataPlans[network] || []
    });

  } catch (error) {
    console.error('Get data plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

module.exports = router;