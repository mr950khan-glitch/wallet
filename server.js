
const express = require("express");
const admin = require("firebase-admin");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cache-Control", "no-store");
  next();
});

// ===============================
// FIREBASE ADMIN INITIALIZATION
// ===============================

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        "https://xnceeer-default-rtdb.firebaseio.com"
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        "https://xnceeer-default-rtdb.firebaseio.com"
    });
  }
} catch (error) {
  console.error("Firebase initialization error:", error.message);
  process.exit(1);
}

const auth = admin.auth();
const db = admin.database();

// ===============================
// COMMON HELPERS
// ===============================

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message
  });
}

function cleanText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function validAmount(value) {
  const amount = Number(value);

  return Number.isSafeInteger(amount) && amount > 0
    ? amount
    : null;
}

async function logAdminAction(adminUid, action, userId, details = {}) {
  const logId = crypto.randomUUID();

  await db.ref("adminLogs/" + logId).set({
    adminUid,
    action,
    userId: String(userId || ""),
    details,
    createdAt: Date.now()
  });
}

async function findUserById(userId) {
  const id = String(userId || "").trim();

  if (!/^\d{7}$/.test(id)) {
    return null;
  }

  const uidSnapshot = await db.ref("userIds/" + id).get();

  if (!uidSnapshot.exists()) {
    return null;
  }

  const uid = uidSnapshot.val();
  const userSnapshot = await db.ref("users/" + uid).get();

  if (!userSnapshot.exists()) {
    return null;
  }

  return {
    uid,
    user: userSnapshot.val()
  };
}

// ===============================
// AUTHENTICATION MIDDLEWARE
// ===============================

// Token check only.
// New signup users do not have a users/{uid} record yet.
async function verifyToken(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return sendError(res, 401, "Authentication required");
    }

    const token = header.substring(7).trim();

    if (!token) {
      return sendError(res, 401, "Invalid token");
    }

    const decoded = await auth.verifyIdToken(token, true);

    req.auth = decoded;
    return next();

  } catch (error) {
    console.error("Token error:", error.message);
    return sendError(res, 401, "Invalid or expired login");
  }
}

// Token + active user profile check.
async function verifyUser(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return sendError(res, 401, "Authentication required");
    }

    const token = header.substring(7).trim();
    const decoded = await auth.verifyIdToken(token, true);

    const snapshot = await db.ref("users/" + decoded.uid).get();

    if (!snapshot.exists()) {
      return sendError(res, 403, "Account setup required");
    }

    const profile = snapshot.val();

    if (profile.status === "banned") {
      return sendError(res, 403, "Your account is banned");
    }

    req.auth = decoded;
    req.profile = profile;

    return next();

  } catch (error) {
    console.error("User verification error:", error.message);
    return sendError(res, 401, "Invalid or expired login");
  }
}

// Admin must have Firebase custom claim: admin=true
async function verifyAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
      return sendError(res, 401, "Authentication required");
    }

    const token = header.substring(7).trim();
    const decoded = await auth.verifyIdToken(token, true);

    if (decoded.admin !== true) {
      return sendError(res, 403, "Admin access denied");
    }

    const snapshot = await db.ref("users/" + decoded.uid).get();

    if (!snapshot.exists()) {
      return sendError(res, 403, "Admin profile not found");
    }

    const profile = snapshot.val();

    if (profile.status === "banned") {
      return sendError(res, 403, "Admin account is disabled");
    }

    req.auth = decoded;
    req.profile = profile;

    return next();

  } catch (error) {
    console.error("Admin verification error:", error.message);
    return sendError(res, 401, "Admin authentication failed");
  }
}

// ===============================
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "online",
    service: "XNCE EER Wallet API"
  });
});

// ===============================
// CREATE USER ACCOUNT
// ===============================

app.post("/api/account/provision", verifyToken, async (req, res) => {
  try {
    const uid = req.auth.uid;

    const existing = await db.ref("users/" + uid).get();

    // Idempotent: do not create another ID for an existing account.
    if (existing.exists()) {
      const wallet = await db.ref("wallets/" + uid).get();

      return res.json({
        success: true,
        user: existing.val(),
        wallet: wallet.val() || { balance: 0, transactions: {} }
      });
    }

    const firebaseUser = await auth.getUser(uid);

    const name = cleanText(
      req.body.name || firebaseUser.displayName || "User",
      80
    );

    const email = cleanText(firebaseUser.email, 150);

    let userId = null;

    // Generate a unique 7-digit ID.
    for (let attempt = 0; attempt < 30; attempt++) {
      const candidate = String(
        Math.floor(1111111 + Math.random() * 8888889)
      );

      const idRef = db.ref("userIds/" + candidate);
      const result = await idRef.transaction(current => {
        if (current === null) {
          return uid;
        }

        return;
      });

      if (result.committed) {
        userId = candidate;
        break;
      }
    }

    if (!userId) {
      return sendError(res, 500, "Could not generate user ID");
    }

    const now = Date.now();

    const profile = {
      uid,
      userId,
      name,
      email,
      photoURL: firebaseUser.photoURL || "",
      status: "active",
      createdAt: now
    };

    try {
      await db.ref("users/" + uid).set(profile);

      await db.ref("wallets/" + uid).set({
        balance: 0,
        transactions: {}
      });

    } catch (error) {
      // Release the allocated ID if account creation fails.
      await db.ref("userIds/" + userId).remove().catch(() => {});
      await db.ref("users/" + uid).remove().catch(() => {});
      await db.ref("wallets/" + uid).remove().catch(() => {});
      throw error;
    }

    return res.json({
      success: true,
      message: "Account created successfully",
      user: profile,
      wallet: {
        balance: 0,
        transactions: {}
      }
    });

  } catch (error) {
    console.error("Provision error:", error);
    return sendError(res, 500, "Account creation failed");
  }
});

// ===============================
// USER PROFILE AND WALLET
// ===============================

app.get("/api/me", verifyUser, async (req, res) => {
  try {
    const uid = req.auth.uid;

    const [userSnapshot, walletSnapshot] = await Promise.all([
      db.ref("users/" + uid).get(),
      db.ref("wallets/" + uid).get()
    ]);

    const user = userSnapshot.val();
    const wallet = walletSnapshot.val() || {
      balance: 0,
      transactions: {}
    };

    const transactions = Object.entries(
      wallet.transactions || {}
    )
      .map(([id, item]) => ({
        id,
        ...item
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 100);

    return res.json({
      success: true,
      user,
      profile: user,
      wallet: {
        balance: Number(wallet.balance || 0)
      },
      balance: Number(wallet.balance || 0),
      transactions
    });

  } catch (error) {
    console.error("Me API error:", error);
    return sendError(res, 500, "Could not load account");
  }
});

// ===============================
// ADMIN CHECK
// ===============================

app.get("/api/admin/check", verifyAdmin, (req, res) => {
  res.json({
    success: true,
    admin: true,
    profile: req.profile
  });
});

// ===============================
// ADMIN STATISTICS
// ===============================

app.get("/api/admin/stats", verifyAdmin, async (req, res) => {
  try {
    const [usersSnapshot, walletsSnapshot] = await Promise.all([
      db.ref("users").get(),
      db.ref("wallets").get()
    ]);

    const users = usersSnapshot.val() || {};
    const wallets = walletsSnapshot.val() || {};

    const userList = Object.values(users);

    const totalUsers = userList.length;

    const activeUsers = userList.filter(
      user => user.status !== "banned"
    ).length;

    const bannedUsers = userList.filter(
      user => user.status === "banned"
    ).length;

    let totalBalance = 0;

    Object.values(wallets).forEach(wallet => {
      totalBalance += Number(wallet.balance || 0);
    });

    return res.json({
      success: true,
      totalUsers,
      activeUsers,
      bannedUsers,
      totalBalance
    });

  } catch (error) {
    console.error("Stats error:", error);
    return sendError(res, 500, "Could not load statistics");
  }
});

// ===============================
// ADMIN USER LIST
// ===============================

app.get("/api/admin/users", verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.ref("users").get();
    const users = snapshot.val() || {};

    const list = Object.values(users)
      .map(user => ({
        uid: user.uid,
        userId: user.userId,
        name: user.name,
        email: user.email,
        status: user.status || "active",
        createdAt: user.createdAt || 0
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);

    return res.json({
      success: true,
      users: list
    });

  } catch (error) {
    console.error("Users list error:", error);
    return sendError(res, 500, "Could not load users");
  }
});

// ===============================
// ADMIN USER SEARCH
// ===============================

app.get("/api/admin/user/:userId", verifyAdmin, async (req, res) => {
  try {
    const result = await findUserById(req.params.userId);

    if (!result) {
      return sendError(res, 404, "User not found");
    }

    const walletSnapshot = await db.ref(
      "wallets/" + result.uid
    ).get();

    const wallet = walletSnapshot.val() || {
      balance: 0,
      transactions: {}
    };

    const transactions = Object.entries(
      wallet.transactions || {}
    )
      .map(([id, item]) => ({ id, ...item }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 100);

    return res.json({
      success: true,
      user: result.user,
      wallet: {
        balance: Number(wallet.balance || 0)
      },
      transactions
    });

  } catch (error) {
    console.error("User search error:", error);
    return sendError(res, 500, "User search failed");
  }
});

// ===============================
// ADMIN BAN USER
// ===============================

app.post("/api/admin/user/ban", verifyAdmin, async (req, res) => {
  try {
    const userId = cleanText(req.body.userId, 20);
    const reason = cleanText(req.body.reason || "Admin action", 200);

    const result = await findUserById(userId);

    if (!result) {
      return sendError(res, 404, "User not found");
    }

    if (result.uid === req.auth.uid) {
      return sendError(res, 400, "You cannot ban yourself");
    }

    await db.ref("users/" + result.uid).update({
      status: "banned",
      banReason: reason,
      bannedAt: Date.now(),
      bannedBy: req.auth.uid
    });

    await auth.revokeRefreshTokens(result.uid);

    await logAdminAction(
      req.auth.uid,
      "BAN_USER",
      userId,
      { reason }
    );

    return res.json({
      success: true,
      message: "User banned successfully"
    });

  } catch (error) {
    console.error("Ban error:", error);
    return sendError(res, 500, "Could not ban user");
  }
});

// ===============================
// ADMIN UNBAN USER
// ===============================

app.post("/api/admin/user/unban", verifyAdmin, async (req, res) => {
  try {
    const userId = cleanText(req.body.userId, 20);
    const result = await findUserById(userId);

    if (!result) {
      return sendError(res, 404, "User not found");
    }

    await db.ref("users/" + result.uid).update({
      status: "active",
      banReason: null,
      unbannedAt: Date.now(),
      unbannedBy: req.auth.uid
    });

    await logAdminAction(
      req.auth.uid,
      "UNBAN_USER",
      userId
    );

    return res.json({
      success: true,
      message: "User unbanned successfully"
    });

  } catch (error) {
    console.error("Unban error:", error);
    return sendError(res, 500, "Could not unban user");
  }
});

// ===============================
// ADMIN ADD / DEDUCT BALANCE
// ===============================

async function changeBalance(req, res, type) {
  try {
    const userId = cleanText(req.body.userId, 20);
    const amount = validAmount(req.body.amount);
    const reason = cleanText(req.body.reason || "Admin transaction", 200);

    if (!amount) {
      return sendError(res, 400, "Enter a valid positive whole amount");
    }

    const result = await findUserById(userId);

    if (!result) {
      return sendError(res, 404, "User not found");
    }

    if (result.user.status === "banned") {
      return sendError(res, 403, "Cannot modify a banned user");
    }

    const uid = result.uid;
    const balanceRef = db.ref("wallets/" + uid + "/balance");

    let newBalance = 0;

    const transaction = await balanceRef.transaction(current => {
      const oldBalance = Number(current || 0);

      if (!Number.isSafeInteger(oldBalance) || oldBalance < 0) {
        return;
      }

      if (type === "debit" && oldBalance < amount) {
        return;
      }

      newBalance = type === "credit"
        ? oldBalance + amount
        : oldBalance - amount;

      if (!Number.isSafeInteger(newBalance) || newBalance < 0) {
        return;
      }

      return newBalance;
    });

    if (!transaction.committed) {
      return sendError(
        res,
        400,
        type === "debit"
          ? "Insufficient balance or balance update failed"
          : "Balance update failed"
      );
    }

    newBalance = Number(transaction.snapshot.val() || 0);

    const transactionId = db.ref(
      "wallets/" + uid + "/transactions"
    ).push().key;

    const transactionData = {
      type: type === "credit" ? "credit" : "debit",
      amount,
      reason,
      adminUid: req.auth.uid,
      createdAt: Date.now(),
      balanceAfter: newBalance
    };

    await db.ref(
      "wallets/" + uid + "/transactions/" + transactionId
    ).set(transactionData);

    await logAdminAction(
      req.auth.uid,
      type === "credit" ? "ADD_BALANCE" : "DEDUCT_BALANCE",
      userId,
      {
        amount,
        reason,
        transactionId
      }
    );

    return res.json({
      success: true,
      message: type === "credit"
        ? "Balance added successfully"
        : "Balance deducted successfully",
      balance: newBalance,
      transactionId
    });

  } catch (error) {
    console.error("Balance action error:", error);
    return sendError(res, 500, "Balance operation failed");
  }
}

app.post("/api/admin/credit", verifyAdmin, (req, res) => {
  return changeBalance(req, res, "credit");
});

app.post("/api/admin/debit", verifyAdmin, (req, res) => {
  return changeBalance(req, res, "debit");
});

// ===============================
// ADMIN DELETE USER
// ===============================

app.post("/api/admin/user/delete", verifyAdmin, async (req, res) => {
  try {
    const userId = cleanText(req.body.userId, 20);
    const result = await findUserById(userId);

    if (!result) {
      return sendError(res, 404, "User not found");
    }

    if (result.uid === req.auth.uid) {
      return sendError(res, 400, "You cannot delete yourself");
    }

    // Prevent deleting another admin account.
    const targetAuth = await auth.getUser(result.uid);

    if (targetAuth.customClaims?.admin === true) {
      return sendError(res, 403, "Cannot delete an admin account");
    }

    await logAdminAction(
      req.auth.uid,
      "DELETE_USER",
      userId
    );

    await auth.deleteUser(result.uid);

    await Promise.all([
      db.ref("users/" + result.uid).remove(),
      db.ref("wallets/" + result.uid).remove(),
      db.ref("userIds/" + userId).remove()
    ]);

    return res.json({
      success: true,
      message: "User deleted successfully"
    });

  } catch (error) {
    console.error("Delete user error:", error);
    return sendError(res, 500, "Could not delete user");
  }
});

// ===============================
// ADMIN ACTIVITY LOGS
// ===============================

app.get("/api/admin/logs", verifyAdmin, async (req, res) => {
  try {
    const snapshot = await db.ref("adminLogs")
      .orderByChild("createdAt")
      .limitToLast(200)
      .get();

    const logs = Object.entries(snapshot.val() || {})
      .map(([id, item]) => ({
        id,
        ...item
      }))
      .sort((a, b) => b.createdAt - a.createdAt);

    return res.json({
      success: true,
      logs
    });

  } catch (error) {
    console.error("Admin logs error:", error);
    return sendError(res, 500, "Could not load activity logs");
  }
});

// ===============================
// NOT FOUND
// ===============================

app.use("/api", (req, res) => {
  return sendError(res, 404, "API endpoint not found");
});

// ===============================
// GLOBAL ERROR HANDLER
// ===============================

app.use((error, req, res, next) => {
  console.error("Server error:", error);

  if (res.headersSent) {
    return next(error);
  }

  return sendError(res, 500, "Internal server error");
});

// ===============================
// START SERVER
// ===============================

app.listen(PORT, "0.0.0.0", () => {
  console.log("Wallet server running on port " + PORT);
});
