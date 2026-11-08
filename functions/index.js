
const { onCall, HttpsError } =
  require("firebase-functions/v2/https");

const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getAuth } = require("firebase-admin/auth");
const crypto = require("crypto");

initializeApp();

const db = getDatabase();

function requireLogin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required");
  }

  return request.auth.uid;
}

function requireAdmin(request) {
  const uid = requireLogin(request);

  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin only");
  }

  return uid;
}

// নতুন User Account এবং 7 digit ID তৈরি
exports.provisionAccount = onCall(async request => {
  const uid = requireLogin(request);
  const name = String(request.data?.name || "").trim();

  if (name.length < 2 || name.length > 60) {
    throw new HttpsError("invalid-argument", "Invalid name");
  }

  const profileRef = db.ref("users/" + uid);

  const existing = await profileRef.get();

  if (existing.exists()) {
    return { success: true, userId: existing.val().userId };
  }

  const user = await getAuth().getUser(uid);
  let assignedId = null;

  for (let i = 0; i < 30; i++) {
    const id = String(crypto.randomInt(1111111, 10000000));
    const idRef = db.ref("userIds/" + id);

    const result = await idRef.transaction(
      current => current === null ? uid : undefined,
      undefined,
      false
    );

    if (result.committed) {
      assignedId = id;
      break;
    }
  }

  if (!assignedId) {
    throw new HttpsError("resource-exhausted", "ID unavailable");
  }

  try {
    await profileRef.set({
      name,
      email: user.email || "",
      userId: assignedId,
      status: "Active",
      createdAt: Date.now()
    });

    await db.ref("wallets/" + uid).set({
      balance: 0,
      transactions: {}
    });

    return { success: true, userId: assignedId };

  } catch (error) {
    const idRef = db.ref("userIds/" + assignedId);
    await idRef.transaction(
      current => current === uid ? null : current
    );
    throw new HttpsError("internal", "Account creation failed");
  }
});

// Admin পরিচয় যাচাই
exports.checkAdmin = onCall(async request => {
  const uid = requireLogin(request);

  return {
    admin: request.auth.token.admin === true,
    uid
  };
});

// User ID দিয়ে তথ্য খোঁজা
exports.lookupUser = onCall(async request => {
  requireAdmin(request);

  const id = String(request.data?.userId || "").trim();

  if (!/^\d{7}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Invalid User ID");
  }

  const mapping = await db.ref("userIds/" + id).get();

  if (!mapping.exists()) {
    throw new HttpsError("not-found", "User not found");
  }

  const uid = mapping.val();

  const profile = await db.ref("users/" + uid).get();
  const wallet = await db.ref("wallets/" + uid).get();

  if (!profile.exists()) {
    throw new HttpsError("not-found", "Profile not found");
  }

  return {
    uid,
    profile: profile.val(),
    balance: Number(wallet.child("balance").val() || 0)
  };
});

// Admin থেকে Balance যোগ
exports.creditBalance = onCall(async request => {
  requireAdmin(request);

  const id = String(request.data?.userId || "").trim();
  const amount = request.data?.amount;
  const requestId = String(request.data?.requestId || "");

  if (!/^\d{7}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Invalid User ID");
  }

  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 1000000
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Amount must be between 1 and 1000000 taka"
    );
  }

  if (!/^[a-f0-9-]{36}$/i.test(requestId)) {
    throw new HttpsError("invalid-argument", "Invalid request ID");
  }

  const mapping = await db.ref("userIds/" + id).get();

  if (!mapping.exists()) {
    throw new HttpsError("not-found", "User not found");
  }

  const uid = mapping.val();

  const profile = await db.ref("users/" + uid).get();

  if (!profile.exists() || profile.val().status !== "Active") {
    throw new HttpsError("failed-precondition", "User is not active");
  }

  const walletRef = db.ref("wallets/" + uid);
  const txId = requestId;
  const timestamp = Date.now();

  const result = await walletRef.transaction(current => {
    if (!current) {
      current = { balance: 0, transactions: {} };
    }

    current.transactions = current.transactions || {};

    // একই request দ্বিতীয়বার balance যোগ করবে না
    if (current.transactions[txId]) {
      return current;
    }

    current.balance = Number(current.balance || 0) + amount;

    current.transactions[txId] = {
      type: "credit",
      amount,
      createdAt: timestamp,
      adminUid: request.auth.uid,
      note: "Admin Balance Credit"
    };

    return current;
  });

  if (!result.committed) {
    throw new HttpsError("aborted", "Transaction failed");
  }

  return {
    success: true,
    balance: result.snapshot.child("balance").val(),
    message: "Balance added successfully"
  };
});
