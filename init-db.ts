import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function initDb() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        avatar_url TEXT,
        role VARCHAR(50) DEFAULT 'student',
        xp INTEGER DEFAULT 0,
        rank VARCHAR(50) DEFAULT 'Bronze'
      );

      CREATE TABLE IF NOT EXISTS learning_items (
        id SERIAL PRIMARY KEY,
        term VARCHAR(255) NOT NULL,
        item_type VARCHAR(50) CHECK (item_type IN ('vocab', 'grammar')),
        definition TEXT,
        part_of_speech VARCHAR(100),
        example_sentence TEXT,
        fill_in_the_blank TEXT,
        incorrect_sentence TEXT,
        error_target TEXT,
        corrected_sentence TEXT,
        novel_node TEXT,
        cohort_id VARCHAR(255),
        is_active BOOLEAN DEFAULT true
      );

      CREATE TABLE IF NOT EXISTS user_progress (
        user_id INTEGER REFERENCES users(id),
        item_id INTEGER REFERENCES learning_items(id),
        repetition_count INTEGER DEFAULT 0,
        easiness_factor REAL DEFAULT 2.5,
        interval INTEGER DEFAULT 0,
        next_review_date TIMESTAMP,
        PRIMARY KEY (user_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS review_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        item_id INTEGER REFERENCES learning_items(id),
        score INTEGER,
        response_time_ms INTEGER,
        is_rushed BOOLEAN,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('Database schema created successfully');
  } catch (err) {
    console.error('Error creating database schema:', err);
  } finally {
    await client.end();
  }
}

initDb();
