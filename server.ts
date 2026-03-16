import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";

// Extend Express Request interface to include user
declare global {
  namespace Express {
    interface Request {
      user?: any;
    }
  }
}

dotenv.config();

// Process-level error handling to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Initialize Firebase Admin
let db: any;
let auth: any;

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
  try {
    console.log("Attempting to initialize Firebase Admin for project:", process.env.FIREBASE_PROJECT_ID);
    
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (privateKey.startsWith('"') && privateKey.endsWith('"')) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n');

    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
    });
    db = getFirestore();
    auth = getAuth();
    console.log("Firebase Admin initialized successfully.");
  } catch (error: any) {
    console.error("Error initializing Firebase Admin:", error.message);
  }
} else {
  console.warn("Firebase Admin environment variables missing. Backend features requiring auth will fail.");
  console.log("Missing variables:", 
    !process.env.FIREBASE_PROJECT_ID ? "FIREBASE_PROJECT_ID " : "",
    !process.env.FIREBASE_CLIENT_EMAIL ? "FIREBASE_CLIENT_EMAIL " : "",
    !process.env.FIREBASE_PRIVATE_KEY ? "FIREBASE_PRIVATE_KEY" : ""
  );
}

const app = express();

async function startServer() {
  const PORT = process.env.PORT || 3000;

  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Auth-Token', 'Authorization']
  }));
  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/debug", (req, res) => {
    res.json({ status: "ok", message: "Debug endpoint reached", headers: req.headers });
  });

  // Middleware to verify Firebase Token
  const verifyFirebaseToken = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!auth || !db) {
      console.error('Firebase Admin not initialized. Cannot verify token.');
      return res.status(500).json({ error: 'Database connection not initialized. Please check server environment variables.' });
    }

    console.log('Verifying token. Headers:', JSON.stringify(req.headers));
    const idToken = req.headers['x-auth-token'] as string;
    
    if (!idToken) {
      console.warn('No token provided in request (X-Auth-Token missing)');
      return res.status(401).json({ error: 'No token provided' });
    }

    // Developer Mode Bypass
    if (idToken === 'dev-token-nbend-2026') {
      console.log('Developer Mode Bypass triggered');
      req.user = { uid: 'dev-user', email: 'dev@nbend.k12.or.us', name: 'Developer' };
      return next();
    }

    try {
      const decodedToken = await auth.verifyIdToken(idToken);
      req.user = decodedToken;
      next();
    } catch (error: any) {
      console.error('Error verifying token:', error.message);
      return res.status(403).json({ error: 'Unauthorized', details: error.message });
    }
  };

  // Teacher Verification Middleware
  const verifyTeacher = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.log('Verifying teacher role for UID:', req.user?.uid);
    const { uid } = req.user;

    // Developer Mode Bypass
    if (uid === 'dev-user') {
      console.log('Teacher role bypass for dev-user');
      return next();
    }

    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.data()?.role !== 'teacher') {
        return res.status(403).json({ error: 'Requires Teacher Role' });
      }
      next();
    } catch (error) {
      console.error('Error verifying teacher:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  };

  // Auth Route: Sync User
  app.post("/api/v1/session", verifyFirebaseToken, async (req, res) => {
    const { uid, email, name, picture } = req.user;
    
    if (!email?.endsWith('@nbend.k12.or.us')) {
       return res.status(403).json({ error: 'Restricted to school domain only' });
    }

    try {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();

      if (!userDoc.exists) {
        await userRef.set({
          email,
          name: name || 'Student',
          role: 'student',
          xp: 0,
          rank: 'Bronze',
          createdAt: new Date().toISOString(),
          lastActive: new Date().toISOString(),
          inventory: { insight_scrolls: 1 }, // Start with 1 free scroll
          relics: [], // Array of strings (e.g., 'First Blood', 'Streak Master')
          quests: {
            bosses_slain: 0,
            words_mastered: 0,
            current_streak: 0,
            quests_claimed: [] // Array of quest IDs they've completed this week
          }
        });
      } else {
        await userRef.update({
          lastActive: new Date().toISOString()
        });
      }
      
      const userData = (await userRef.get()).data();
      res.json({ role: userData?.role });
    } catch (error) {
      console.error('Error syncing user:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Step 1: The Leaderboard API (Backend)
  app.get("/api/leaderboard", verifyFirebaseToken, async (req, res) => {
    try {
      // 1. Fetch all students
      const studentsSnapshot = await db.collection('users').where('role', '==', 'student').get();
      const students = studentsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2. Fetch all active classes
      const classesSnapshot = await db.collection('classes').where('is_archived', '==', false).get();
      const classesMap = new Map();
      classesSnapshot.docs.forEach(doc => {
        classesMap.set(doc.id, doc.data());
      });

      // 3. Calculate Top Players
      const topPlayers = students
        .sort((a: any, b: any) => (b.xp || 0) - (a.xp || 0))
        .slice(0, 10)
        .map((s: any) => ({
          id: s.id,
          name: s.name,
          xp: s.xp || 0,
          rank: s.rank || 'Bronze',
          cohort_name: classesMap.get(s.cohort_id)?.name || 'Unknown Class'
        }));

      // 4. Calculate Team Standings
      const teamStats = new Map(); // cohortId -> { totalXp, studentCount, name }

      students.forEach((s: any) => {
        if (s.cohort_id && classesMap.has(s.cohort_id)) {
          const cohort = classesMap.get(s.cohort_id);
          const current = teamStats.get(s.cohort_id) || { 
            totalXp: 0, 
            studentCount: 0, 
            name: cohort.name,
            theme_color: cohort.theme_color
          };
          
          current.totalXp += (s.xp || 0);
          current.studentCount += 1;
          teamStats.set(s.cohort_id, current);
        }
      });

      const teamStandings = Array.from(teamStats.values())
        .map((team: any) => ({
          name: team.name,
          studentCount: team.studentCount,
          averageXp: Math.round(team.totalXp / team.studentCount),
          theme_color: team.theme_color
        }))
        .sort((a, b) => b.averageXp - a.averageXp);

      res.json({ topPlayers, teamStandings });
    } catch (error) {
      console.error('Error fetching leaderboard:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Step 1: The Classes Database (Backend)
  app.post("/api/admin/classes", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { name, theme_color } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Class name is required' });
    }

    try {
      // Generate a random 6-character uppercase join code
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let join_code = '';
      for (let i = 0; i < 6; i++) {
        join_code += chars.charAt(Math.floor(Math.random() * chars.length));
      }

      // Ensure uniqueness (simple check)
      const existing = await db.collection('classes').where('join_code', '==', join_code).get();
      if (!existing.empty) {
        // Retry once if collision (rare)
        join_code = '';
        for (let i = 0; i < 6; i++) {
          join_code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
      }

      const newClass = {
        name,
        join_code,
        theme_color: theme_color || 'indigo',
        is_archived: false,
        created_at: new Date().toISOString(),
        student_count: 0,
        boss_encounter_rate: 15,
        ai_strictness: 'standard'
      };

      const docRef = await db.collection('classes').add(newClass);
      res.json({ id: docRef.id, ...newClass });
    } catch (error) {
      console.error('Error creating class:', error);
      res.status(500).json({ error: 'Failed to create class' });
    }
  });

  app.patch('/api/admin/classes/:id', verifyFirebaseToken, verifyTeacher, async (req, res) => {
    try {
      const { id } = req.params;
      const { name, theme_color } = req.body;
      
      const classRef = db.collection('classes').doc(id);
      const doc = await classRef.get();
      if (!doc.exists) return res.status(404).json({error: 'Class not found'});
      
      const oldName = doc.data()?.name;
      await classRef.update({ name, theme_color });

      // Cascade the name change so words and students don't detach
      if (name && oldName && name !== oldName) {
         const batch = db.batch();
         
         const itemsSnapshot = await db.collection('learning_items').where('target_classes', 'array-contains', oldName).get();
         itemsSnapshot.docs.forEach(itemDoc => {
           const data = itemDoc.data();
           const newTargetClasses = data.target_classes.map((c: string) => c === oldName ? name : c);
           batch.update(itemDoc.ref, { target_classes: newTargetClasses });
         });
         
         const usersSnapshot = await db.collection('users').where('cohort_id', '==', id).get();
         usersSnapshot.docs.forEach(userDoc => {
           batch.update(userDoc.ref, { cohort_name: name });
         });

         await batch.commit();
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating class:', error);
      res.status(500).json({error: 'Failed to update class'});
    }
  });

  app.patch("/api/admin/classes/:id/settings", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { id } = req.params;
    const { boss_encounter_rate, ai_strictness } = req.body;
    
    try {
      await db.collection('classes').doc(id).update({
        boss_encounter_rate,
        ai_strictness
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error updating class settings:', error);
      res.status(500).json({ error: 'Failed to update class settings' });
    }
  });

  app.patch("/api/admin/classes/:id/archive", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { id } = req.params;
    try {
      await db.collection('classes').doc(id).update({
        is_archived: true
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error archiving class:', error);
      res.status(500).json({ error: 'Failed to archive class' });
    }
  });

  app.delete("/api/admin/classes/:id", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    try {
      await db.collection('classes').doc(req.params.id).delete();
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting class:', error);
      res.status(500).json({ error: 'Failed to delete class' });
    }
  });

  app.post("/api/user/join-class", verifyFirebaseToken, async (req, res) => {
    const { joinCode } = req.body;
    const { uid } = req.user;

    if (!joinCode) {
      return res.status(400).json({ error: 'Join code is required' });
    }

    try {
      const classesSnapshot = await db.collection('classes')
        .where('join_code', '==', joinCode.toUpperCase())
        .where('is_archived', '==', false)
        .limit(1)
        .get();

      if (classesSnapshot.empty) {
        return res.status(404).json({ error: 'Invalid or archived class code' });
      }

      const classDoc = classesSnapshot.docs[0];
      const classId = classDoc.id;
      const classData = classDoc.data();

      // Update user profile
      await db.collection('users').doc(uid).update({
        cohort_id: classId,
        cohort_name: classData.name // Optional: store name for easier access
      });

      // Increment student count (optional, but good for UI)
      await db.collection('classes').doc(classId).update({
        student_count: (classData.student_count || 0) + 1
      });

      res.json({ success: true, classId, className: classData.name });
    } catch (error) {
      console.error('Error joining class:', error);
      res.status(500).json({ error: 'Failed to join class' });
    }
  });

  // Step 1: The Analytics API Route (Backend)
  app.get("/api/admin/roster", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    try {
      const studentsSnapshot = await db.collection('users').where('role', '==', 'student').get();
      const roster = [];

      for (const studentDoc of studentsSnapshot.docs) {
        const studentData = studentDoc.data();
        const studentId = studentDoc.id;

        const progressSnapshot = await db.collection('users').doc(studentId).collection('user_progress').get();
        let masteredItems = 0;
        let decayingMastery = 0;

        progressSnapshot.forEach(doc => {
          const data = doc.data();
          if ((data.interval || 0) >= 21) {
            masteredItems++;
            if ((data.easeFactor || 2.5) < 2.0) decayingMastery++;
          }
        });

        let cohortName = studentData.cohort_name || 'Unassigned';
        if (studentData.cohort_id && !studentData.cohort_name) {
           const cohortDoc = await db.collection('classes').doc(studentData.cohort_id).get();
           if (cohortDoc.exists) cohortName = cohortDoc.data()?.name || 'Unassigned';
        }

        roster.push({
          id: studentId,
          name: studentData.name || 'Unknown',
          email: studentData.email,
          xp: studentData.xp || 0,
          rank: studentData.rank || 'Bronze',
          cohort_id: studentData.cohort_id || null,
          cohort_name: cohortName,
          lastActive: studentData.lastActive || studentData.createdAt || null,
          masteredItems,
          decayingMastery
        });
      }
      res.json(roster);
    } catch (error) {
      console.error('Error fetching roster analytics:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Step 2: Claim Bounty API
  app.post("/api/study/claim-bounty", verifyFirebaseToken, async (req, res) => {
    const { bountyId, rewardType, rewardAmount } = req.body;
    const { uid } = req.user;
    try {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await userRef.get();
      const data = userDoc.data() || {};
      
      const questsClaimed = data.quests?.quests_claimed || [];
      if (questsClaimed.includes(bountyId)) return res.status(400).json({ error: "Already claimed" });
      
      const updates: any = { 
        'quests.quests_claimed': [...questsClaimed, bountyId],
        xp: (data.xp || 0) + (rewardType === 'xp' ? rewardAmount : 0)
      };

      if (rewardType === 'scroll') {
        updates['inventory.insight_scrolls'] = (data.inventory?.insight_scrolls || 0) + rewardAmount;
      } else if (rewardType === 'relic') {
        updates.relics = [...(data.relics || []), rewardAmount]; // rewardAmount is the relic name
      }

      await userRef.update(updates);
      res.json({ success: true, updates });
    } catch (e) {
      res.status(500).json({ error: "Failed to claim" });
    }
  });

  // Step 1: The Rank-Up Logic (Backend)
  app.post("/api/study/log-review", verifyFirebaseToken, async (req, res) => {
    const { itemId, score, responseTimeMs, sm2Result, isBoss, xpAwarded } = req.body;
    const { uid } = req.user;

    if (!itemId || score === undefined || !responseTimeMs) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
      const isRushed = responseTimeMs < 1200;
      let xpGained = 0;

      // Anti-Cheat Logic
      if (!isRushed) {
        if (xpAwarded !== undefined) {
          xpGained = xpAwarded;
        } else {
          if (score >= 3) xpGained = 50; // Standard XP for correct answer
          else xpGained = 10; // Participation XP
        }
      }

      let leveledUp = false;
      let newRank = '';

      // Fetch old progress to check mastery
      let progressData: any = null;
      if (sm2Result) {
        const progressRef = db.collection('users').doc(uid).collection('user_progress').doc(itemId);
        const progressDoc = await progressRef.get();
        if (progressDoc.exists) {
          progressData = progressDoc.data();
        }
      }

      // 1. Determine if quest criteria were met
      const isBossSlay = isBoss && score >= 3;
      const isNewMastery = sm2Result?.interval >= 21 && (progressData?.interval || 0) < 21;

      // Update User XP and Check Rank
      const userRef = db.collection('users').doc(uid);
      await db.runTransaction(async (t) => {
        const doc = await t.get(userRef);
        
        let currentXp = 0;
        let currentRank = 'Bronze';
        let userData: any = {};

        if (doc.exists) {
          userData = doc.data() || {};
          currentXp = userData.xp || 0;
          currentRank = userData.rank || 'Bronze';
        } else {
          // Initialize default user data if doc doesn't exist
          userData = {
            email: req.user.email,
            name: req.user.name || 'Student',
            role: 'student',
            createdAt: new Date().toISOString(),
            quests: {
              bosses_slain: 0,
              words_mastered: 0,
              current_streak: 0,
              quests_claimed: []
            }
          };
        }
        
        const updatedXp = currentXp + xpGained;
        
        // Rank Thresholds
        let calculatedRank = 'Bronze';
        if (updatedXp >= 5000) calculatedRank = 'Platinum';
        else if (updatedXp >= 2500) calculatedRank = 'Gold';
        else if (updatedXp >= 1000) calculatedRank = 'Silver';

        // Check for promotion
        if (calculatedRank !== currentRank) {
          const rankValue = { 'Bronze': 0, 'Silver': 1, 'Gold': 2, 'Platinum': 3 };
          if ((rankValue[calculatedRank as keyof typeof rankValue] || 0) > (rankValue[currentRank as keyof typeof rankValue] || 0)) {
            leveledUp = true;
            newRank = calculatedRank;
          }
        }

        // 2. Prepare the user document updates
        const userUpdates: any = {
          xp: FieldValue.increment(xpGained),
          rank: leveledUp ? newRank : currentRank,
          last_study_date: new Date().toISOString().split('T')[0],
          lastActive: new Date().toISOString()
        };

        // 3. Trigger Bounties if conditions are met
        if (isBossSlay) {
          userUpdates['quests.bosses_slain'] = FieldValue.increment(1);
        }
        if (isNewMastery) {
          userUpdates['quests.words_mastered'] = FieldValue.increment(1);
        }

        // Streak Logic
        const today = new Date().toISOString().split('T')[0];
        const lastStudyDate = userData.last_study_date;
        
        if (lastStudyDate !== today) {
          if (lastStudyDate) {
            const lastDate = new Date(lastStudyDate);
            const currentDate = new Date(today);
            const diffTime = Math.abs(currentDate.getTime() - lastDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
            if (diffDays === 1) {
              userUpdates['quests.current_streak'] = FieldValue.increment(1);
            } else {
              userUpdates['quests.current_streak'] = 1;
            }
          } else {
            userUpdates['quests.current_streak'] = 1;
          }
        }

        if (doc.exists) {
          t.update(userRef, userUpdates);
        } else {
          // For new docs, we can't use dot notation in set, so we construct the nested object
          const newQuests = {
            bosses_slain: isBossSlay ? 1 : 0,
            words_mastered: isNewMastery ? 1 : 0,
            current_streak: 1,
            quests_claimed: []
          };
          t.set(userRef, {
            ...userData,
            xp: xpGained,
            rank: leveledUp ? newRank : currentRank,
            last_study_date: today,
            lastActive: new Date().toISOString(),
            quests: newQuests
          });
        }
      });

      // Log Review
      await db.collection('review_logs').add({
        user_id: uid,
        item_id: itemId,
        score,
        response_time_ms: responseTimeMs,
        is_rushed: isRushed,
        created_at: new Date().toISOString()
      });

      // Update User Progress with provided SM-2 results
      if (sm2Result) {
        const progressRef = db.collection('users').doc(uid).collection('user_progress').doc(itemId);
        
        let consecutiveFailures = progressData?.consecutive_failures || 0;
        let isNemesis = progressData?.is_nemesis || false;

        const correct = score >= 3;

        // Nemesis Logic
        if (!correct) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) {
            isNemesis = true;
          }
        } else {
          consecutiveFailures = 0;
          isNemesis = false; // They defeated it!
        }

        await progressRef.set({
          item_id: itemId,
          last_reviewed: new Date().toISOString(),
          repetition_count: sm2Result.repetitions,
          easeFactor: sm2Result.easeFactor,
          interval: sm2Result.interval,
          nextReviewDate: sm2Result.nextReviewDate,
          consecutive_failures: consecutiveFailures,
          is_nemesis: isNemesis,
          lastReviewed: FieldValue.serverTimestamp()
        }, { merge: true });
      }

      res.json({ success: true, xpGained, isRushed, leveledUp, newRank });

    } catch (error) {
      console.error('Error logging review:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.post('/api/dev/reset-progress', verifyFirebaseToken, async (req: any, res) => {
    try {
      const { uid } = req.user;
      const progressRef = db.collection('users').doc(uid).collection('user_progress');
      const snapshot = await progressRef.get();
      
      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();

      // Optionally reset quest counters and XP
      await db.collection('users').doc(uid).update({
        xp: 0,
        'quests.bosses_slain': 0,
        'quests.words_mastered': 0,
        'quests.current_streak': 0
      });

      res.json({ success: true, message: 'Progress wiped.' });
    } catch (error) {
      console.error('Error wiping progress:', error);
      res.status(500).json({ error: 'Failed to wipe progress' });
    }
  });

  // Step 1: The Bottleneck API (Backend)
  app.get("/api/admin/bottlenecks/:cohortId", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { cohortId } = req.params;
    try {
      // Query the learning_items collection for the specific cohort
      const itemsSnapshot = await db.collection('learning_items').where('target_classes', 'array-contains', cohortId).get();
      
      const bottlenecks = [];

      for (const itemDoc of itemsSnapshot.docs) {
        const itemData = itemDoc.data();
        const itemId = itemDoc.id;

        // Query review_logs for this item
        const logsSnapshot = await db.collection('review_logs').where('item_id', '==', itemId).get();
        
        const totalReviews = logsSnapshot.size;
        if (totalReviews === 0) continue; // Skip items with no reviews

        let correctReviews = 0;
        let totalResponseTime = 0;

        logsSnapshot.forEach(logDoc => {
          const logData = logDoc.data();
          if (logData.score >= 3) {
            correctReviews++;
          }
          totalResponseTime += logData.response_time_ms || 0;
        });

        const accuracyRate = (correctReviews / totalReviews) * 100;
        const averageResponseTime = totalResponseTime / totalReviews;

        bottlenecks.push({
          id: itemId,
          term: itemData.term || 'Unknown Term',
          totalReviews,
          accuracyRate,
          averageResponseTime
        });
      }

      // Sort by Accuracy Rate ascending
      bottlenecks.sort((a, b) => a.accuracyRate - b.accuracyRate);

      res.json(bottlenecks);
    } catch (error) {
      console.error('Error fetching bottlenecks:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Roster Management Routes
  app.get("/api/admin/roster/:cohortId", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { cohortId } = req.params;
    try {
      const studentsSnapshot = await db.collection('users')
        .where('role', '==', 'student')
        .where('cohort_id', '==', cohortId)
        .get();
      
      const roster = studentsSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      
      res.json(roster);
    } catch (error) {
      console.error('Error fetching class roster:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.patch("/api/admin/student/:userId/move", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { userId } = req.params;
    const { newCohortId } = req.body;
    
    if (!newCohortId) {
      return res.status(400).json({ error: 'newCohortId is required' });
    }

    try {
      await db.collection('users').doc(userId).update({
        cohort_id: newCohortId
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error moving student:', error);
      res.status(500).json({ error: 'Failed to move student' });
    }
  });

  app.delete("/api/admin/student/:userId/remove", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { userId } = req.params;
    
    try {
      await db.collection('users').doc(userId).update({
        cohort_id: null
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error removing student:', error);
      res.status(500).json({ error: 'Failed to remove student' });
    }
  });

  // Set Cohort
  app.post('/api/user/set-cohort', verifyFirebaseToken, async (req, res) => {
    const { uid } = (req as any).user;
    const { cohortId } = req.body;

    if (!cohortId) {
      return res.status(400).json({ error: 'Cohort ID is required' });
    }

    try {
      await db.collection('users').doc(uid).set({
        cohort_id: cohortId
      }, { merge: true });
      res.json({ success: true });
    } catch (error) {
      console.error('Error setting cohort:', error);
      res.status(500).json({ error: 'Failed to set cohort' });
    }
  });

  // Step 1: The Study Queue API (Backend)
  app.get("/api/study/queue", verifyFirebaseToken, async (req, res) => {
    const { uid } = req.user;

    try {
      // 0. Fetch user's cohort
      const userDoc = await db.collection('users').doc(uid).get();
      
      let itemsQuery: any = db.collection('learning_items').where('is_active', '==', true);

      // If user has a class assigned, filter by the class NAME (not the ID)
      if (userDoc.exists && userDoc.data()?.cohort_id) {
        const cohortId = userDoc.data()?.cohort_id;
        const cohortDoc = await db.collection('classes').doc(cohortId).get();
        
        if (cohortDoc.exists) {
          const cohortName = cohortDoc.data()?.name;
          itemsQuery = itemsQuery.where('target_classes', 'array-contains', cohortName);
        }
      }

      // 1. Fetch learning items
      const itemsSnapshot = await itemsQuery.get();
      
      let allItems = itemsSnapshot.docs.map((doc: any) => ({
        id: doc.id,
        ...doc.data()
      }));

      // Sort by created_at desc
      allItems.sort((a: any, b: any) => {
        const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return dateB - dateA;
      });

      // 2. Fetch user progress
      const progressSnapshot = await db.collection('users').doc(uid).collection('user_progress').get();
      const progressMap = new Map();
      progressSnapshot.docs.forEach(doc => {
        progressMap.set(doc.data().item_id, { id: doc.id, ...doc.data() });
      });

      // 3. Merge and Filter by SM-2 Dates
      const now = new Date();
      const dueItems = allItems.map((item: any) => {
        const progress = progressMap.get(item.id);
        return { ...item, progress };
      }).filter((item: any) => {
        if (!item.progress) return true; // New items are always due
        const nextReview = item.progress.nextReviewDate ? new Date(item.progress.nextReviewDate) : new Date();
        return nextReview <= now;
      });

      res.json(dueItems);
    } catch (error) {
      console.error('Error fetching study queue:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  app.get('/api/study/endless', verifyFirebaseToken, async (req: any, res) => {
    try {
      const userId = req.user.uid;
      const userDoc = await db.collection('users').doc(userId).get();
      
      // Start with a base query for ALL items (we will filter active status in-memory to avoid missing-field bugs)
      let itemsQuery: any = db.collection('learning_items');

      // If the user has a profile AND a class assigned, filter by their specific class
      if (userDoc.exists && userDoc.data()?.cohort_id) {
        const cohortId = userDoc.data()?.cohort_id;
        const cohortDoc = await db.collection('classes').doc(cohortId).get();
        
        if (cohortDoc.exists) {
          const cohortName = cohortDoc.data()?.name;
          itemsQuery = itemsQuery.where('target_classes', 'array-contains', cohortName);
        }
      }

      const itemsSnapshot = await itemsQuery.get();
      let allItems = itemsSnapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));
      
      // In-memory filter: Keep items unless they are explicitly marked as inactive
      allItems = allItems.filter((item: any) => item.is_active !== false);
      
      // Shuffle the array to randomize the endless practice deck
      allItems = allItems.sort(() => 0.5 - Math.random());
      
      // Return up to 15 random items for this session
      res.json(allItems.slice(0, 15));
    } catch (error) {
      console.error('Error fetching endless items:', error);
      res.status(500).json({ error: 'Failed to fetch items' });
    }
  });

  // Get Word Bank with Stats
  app.get("/api/admin/word-bank", verifyFirebaseToken, verifyTeacher, async (req, res) => {
    try {
      const itemsSnapshot = await db.collection('learning_items').orderBy('created_at', 'desc').get();
      const wordBank = [];

      for (const itemDoc of itemsSnapshot.docs) {
        const itemData = itemDoc.data();
        const itemId = itemDoc.id;

        const logsSnapshot = await db.collection('review_logs').where('item_id', '==', itemId).get();
        
        const totalReviews = logsSnapshot.size;
        let correctReviews = 0;

        logsSnapshot.forEach(logDoc => {
          if (logDoc.data().score >= 3) {
            correctReviews++;
          }
        });

        const masteryPercentage = totalReviews > 0 ? Math.round((correctReviews / totalReviews) * 100) : 0;

        wordBank.push({
          id: itemId,
          ...itemData,
          totalReviews,
          masteryPercentage
        });
      }

      res.json(wordBank);
    } catch (error) {
      console.error('Error fetching word bank:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  });

  // Edit Learning Item
  app.patch('/api/admin/edit-item/:itemId', verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { itemId } = req.params;
    const updates = req.body; // Accept all fields dynamically
    try {
      await db.collection('learning_items').doc(itemId).update(updates);
      res.json({ success: true });
    } catch (error) {
      console.error('Error editing item:', error);
      res.status(500).json({ error: 'Failed to edit item' });
    }
  });

  // Toggle Learning Item Status
  app.patch('/api/admin/toggle-status/:itemId', verifyFirebaseToken, verifyTeacher, async (req, res) => {
    const { itemId } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active must be a boolean' });
    }

    try {
      await db.collection('learning_items').doc(itemId).update({
        is_active: is_active
      });
      res.json({ success: true, is_active });
    } catch (error) {
      console.error('Error toggling item status:', error);
      res.status(500).json({ error: 'Failed to toggle item status' });
    }
  });

  // Global Error Handler for API routes
  app.use('/api', (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('API Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  });

  // 404 handler for API routes
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    
    // Catch-all route for SPA
    app.get('*', (req, res, next) => {
      if (req.url.startsWith('/api')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  if (process.env.VERCEL !== "1") {
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server fully initialized and running on http://localhost:${PORT}`);
    });
  }
}

startServer();

export default app;
