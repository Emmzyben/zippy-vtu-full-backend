const db = require('../config/database');

async function migrate() {
    console.log('Starting migration...');

    try {
        // Create phone_beneficiaries table
        await db.execute(`
      CREATE TABLE IF NOT EXISTS phone_beneficiaries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('Created phone_beneficiaries table');

        // Create email_beneficiaries table
        await db.execute(`
      CREATE TABLE IF NOT EXISTS email_beneficiaries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
        console.log('Created email_beneficiaries table');

        // Migrate existing data
        const [beneficiaries] = await db.execute('SELECT * FROM beneficiaries');
        console.log(`Found ${beneficiaries.length} existing beneficiaries to migrate`);

        for (const b of beneficiaries) {
            if (b.phone_number) {
                // Check if already exists to avoid duplicates during re-runs
                const [exists] = await db.execute(
                    'SELECT id FROM phone_beneficiaries WHERE user_id = ? AND phone_number = ?',
                    [b.user_id, b.phone_number]
                );
                if (exists.length === 0) {
                    await db.execute(
                        'INSERT INTO phone_beneficiaries (user_id, phone_number, name, created_at) VALUES (?, ?, ?, ?)',
                        [b.user_id, b.phone_number, b.name, b.created_at]
                    );
                }
            }

            if (b.email) {
                // Check if already exists
                const [exists] = await db.execute(
                    'SELECT id FROM email_beneficiaries WHERE user_id = ? AND email = ?',
                    [b.user_id, b.email]
                );
                if (exists.length === 0) {
                    await db.execute(
                        'INSERT INTO email_beneficiaries (user_id, email, name, created_at) VALUES (?, ?, ?, ?)',
                        [b.user_id, b.email, b.name, b.created_at]
                    );
                }
            }
        }
        console.log('Data migration completed');

        console.log('Migration successful!');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
