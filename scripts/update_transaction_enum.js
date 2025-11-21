const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: 3306,
    ssl: false
};

const updateEnum = async () => {
    let connection;
    try {
        console.log('Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database');

        console.log('Updating transactions table type enum...');

        // Alter the table to include 'p2p_transfer' in the enum
        await connection.execute(`
      ALTER TABLE transactions 
      MODIFY COLUMN type ENUM('airtime', 'data', 'bill', 'wallet_fund', 'withdrawal', 'p2p_transfer') NOT NULL
    `);

        console.log('✅ Successfully updated transactions type enum to include p2p_transfer');

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Connection closed');
        }
    }
};

updateEnum();
