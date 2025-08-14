# Zippy Pay Backend API

A Node.js backend API for the Zippy Pay VTU (Virtual Top-Up) web application.

## Features

- **User Authentication**: JWT-based authentication with registration and login
- **Wallet Management**: Fund wallet, check balance, transaction processing
- **VTU Services**: Airtime, data bundles, and bill payments
- **Referral System**: User referrals with automatic reward processing
- **Transaction History**: Complete transaction tracking and reporting
- **Security**: Rate limiting, input validation, and secure password hashing

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MySQL with mysql2
- **Authentication**: JWT (jsonwebtoken)
- **Security**: bcryptjs, helmet, express-rate-limit
- **Validation**: express-validator
- **Environment**: dotenv

## Installation

1. **Clone and navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   DB_HOST=localhost
   DB_USER=root
   DB_PASSWORD=your_password
   DB_NAME=zippy_pay
   JWT_SECRET=your_super_secret_jwt_key
   PORT=5000
   FRONTEND_URL=http://localhost:5173
   ```

4. **Set up MySQL database**:
   - Create a MySQL database named `zippy_pay`
   - The application will automatically create the required tables on startup

5. **Start the server**:
   ```bash
   # Development mode with nodemon
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login

### User Management
- `GET /api/user/me` - Get current user profile
- `PUT /api/user/profile` - Update user profile
- `PUT /api/user/password` - Change password

### Wallet
- `GET /api/wallet/balance` - Get wallet balance
- `POST /api/wallet/fund` - Initiate wallet funding
- `POST /api/wallet/transaction` - Process transaction (deduct from wallet)
- `POST /api/wallet/webhook/paystack` - Paystack webhook for payment verification

### VTU Services
- `POST /api/vtu/airtime` - Buy airtime
- `POST /api/vtu/data` - Buy data bundle
- `POST /api/vtu/bills` - Pay bills
- `GET /api/vtu/data-plans/:network` - Get data plans for network

### Transactions
- `GET /api/transactions` - Get user transactions (with pagination)
- `GET /api/transactions/:id` - Get specific transaction
- `GET /api/transactions/stats/summary` - Get transaction statistics

### Referrals
- `GET /api/referral` - Get referral data and statistics
- `GET /api/referral/history` - Get referral history
- `POST /api/referral/process-reward` - Process referral rewards

### Health Check
- `GET /api/health` - API health check

## Database Schema

### Users Table
```sql
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  phone VARCHAR(20) UNIQUE,
  password VARCHAR(255) NOT NULL,
  wallet_balance DECIMAL(10,2) DEFAULT 0.00,
  referral_code VARCHAR(10) UNIQUE,
  referred_by VARCHAR(10),
  is_active BOOLEAN DEFAULT TRUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

### Transactions Table
```sql
CREATE TABLE transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type ENUM('airtime', 'data', 'bill', 'wallet_fund', 'withdrawal') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  details JSON,
  status ENUM('pending', 'success', 'failed') DEFAULT 'pending',
  reference VARCHAR(100) UNIQUE,
  external_reference VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

### Referrals Table
```sql
CREATE TABLE referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  referrer_id INT NOT NULL,
  referred_id INT NOT NULL,
  reward DECIMAL(10,2) DEFAULT 200.00,
  status ENUM('pending', 'paid') DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_referral (referrer_id, referred_id)
);
```

## Security Features

- **JWT Authentication**: Secure token-based authentication
- **Password Hashing**: bcryptjs with salt rounds
- **Rate Limiting**: Prevents API abuse
- **Input Validation**: express-validator for request validation
- **CORS Protection**: Configured for frontend domain
- **Helmet**: Security headers middleware

## Payment Integration

The API is designed to integrate with Paystack for payment processing:

1. **Wallet Funding**: Generates payment links and processes webhooks
2. **Transaction Verification**: Webhook endpoint for payment confirmation
3. **Automatic Crediting**: Updates user wallet balance on successful payment

## VTU Integration

Mock VTU service included for demonstration. In production, integrate with:
- VTpass API
- Baxi API
- Or other VTU service providers

## Error Handling

- Comprehensive error handling middleware
- Validation error responses
- Database transaction rollbacks
- Detailed error logging

## Development

```bash
# Install nodemon for development
npm install -g nodemon

# Run in development mode
npm run dev
```

## Production Deployment

1. Set `NODE_ENV=production` in environment
2. Use a process manager like PM2
3. Set up proper database credentials
4. Configure reverse proxy (nginx)
5. Set up SSL certificates

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the ISC License.# zippy-vtu-backend
# zippy-vtu-full-backend
# zippy-vtu-full-backend
# zippy-vtu-full-backend
