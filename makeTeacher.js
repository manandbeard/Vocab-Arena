const { Client } = require('pg');
require('dotenv').config();

const email = process.argv[2];

if (!email) {
  console.error('Usage: node makeTeacher.js <email>');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function makeTeacher() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    const res = await client.query('UPDATE users SET role = $1 WHERE email = $2 RETURNING *', ['teacher', email]);
    
    if (res.rowCount === 0) {
      console.log(`User with email ${email} not found.`);
    } else {
      console.log(`Successfully updated ${email} to teacher role.`);
      console.log(res.rows[0]);
    }
  } catch (err) {
    console.error('Error updating user:', err);
  } finally {
    await client.end();
  }
}

makeTeacher();
