import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import dotenv from "dotenv";

dotenv.config();

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
} else {
  console.error("Missing Firebase Admin credentials.");
  process.exit(1);
}

const db = getFirestore();

async function migrate() {
  console.log("Starting migration...");
  const itemsRef = db.collection('learning_items');
  const snapshot = await itemsRef.get();
  
  let count = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (data.cohort_id && !data.target_classes) {
      await doc.ref.update({
        target_classes: [data.cohort_id],
        cohort_id: require('firebase-admin/firestore').FieldValue.delete()
      });
      count++;
      console.log(`Migrated item ${doc.id}`);
    } else if (!data.target_classes) {
      // If no cohort_id, maybe default to empty array or some default
      await doc.ref.update({
        target_classes: []
      });
      count++;
      console.log(`Migrated item ${doc.id} (no cohort_id)`);
    }
  }
  console.log(`Migration complete. Updated ${count} items.`);
}

migrate().catch(console.error);
