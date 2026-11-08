
"use strict";

// =====================================
// FIREBASE INITIALIZATION
// =====================================

if (!window.firebaseConfig || !window.firebaseConfig.apiKey ||
    window.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
  alert("Firebase API Key সেট করুন!");
  throw new Error("Firebase configuration missing");
}

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}

const auth = firebase.auth();

// =====================================
// DOM HELPERS
// =====================================

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return "৳" + Number(value || 0).toLocaleString("en-BD");
}

function showMessage(text, success = false) {
  const el = $("authMessage");

  if (!el) return;

  el.textContent = text;
  el.style.color = success ? "green" : "red";
}

// =====================================
// API REQUEST
// =====================================

async function apiRequest(url, method = "GET", body = null) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please login first");
  }

  const token = await user.getIdToken();

  const options = {
    method,
    headers: {
      Authorization: "Bearer " + token
    }
  };

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Server response error");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

// =====================================
// AUTH VIEW
// =====================================

function showLogin() {
  $("loginBox").classList.remove("hidden");
  $("signupBox").classList.add("hidden");
  showMessage("");
}

function showSignup() {
  $("signupBox").classList.remove("hidden");
  $("loginBox").classList.add("hidden");
  showMessage("");
}

$("showSignup").addEventListener("click", showSignup);
$("showLogin").addEventListener("click", showLogin);

// =====================================
// ACCOUNT PROVISION
// =====================================

async function provisionAccount(name) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Login required");
  }

  await user.getIdToken(true);

  return await apiRequest(
    "/api/account/provision",
    "POST",
    { name: name || user.displayName || "User" }
  );
}

// =====================================
// LOAD WALLET
// =====================================

async function loadWallet() {
  const user = auth.currentUser;

  if (!user) return;

  let data;

  try {
    data = await apiRequest("/api/me");

  } catch (error) {

    // New account may exist in Firebase Auth
    // but provisioning may not have completed.
    if (
      error.message.includes("Account setup required") ||
      error.message.includes("Account creation")
    ) {
      await provisionAccount(user.displayName || "User");
      data = await apiRequest("/api/me");
    } else {
      throw error;
    }
  }

  const profile = data.user || data.profile || {};
  const wallet = data.wallet || {};

  const name = profile.name || user.displayName || "User";
  const userId = profile.userId || "Not available";
  const balance = Number(
    wallet.balance ?? data.balance ?? 0
  );

  $("userName").textContent = name;
  $("profileName").textContent = name;
  $("userId").textContent = userId;
  $("profileId").textContent = userId;
  $("profileEmail").textContent = profile.email || user.email || "";
  $("balance").textContent = money(balance);

  const photo = profile.photoURL || user.photoURL;

  if (photo && $("profilePhoto")) {
    $("profilePhoto").src = photo;
  }

  showTransactions(data.transactions || []);
}

// =====================================
// TRANSACTION HISTORY
// =====================================

function showTransactions(transactions) {
  const container = $("transactionList");

  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML =
      '<p class="empty">কোনো Transaction নেই</p>';
    return;
  }

  container.innerHTML = transactions.map(item => {
    const credit = item.type === "credit";

    return `
      <div class="transaction">
        <div>
          <strong>${escapeHTML(item.reason || item.type)}</strong>
          <small>${new Date(
            item.createdAt || Date.now()
          ).toLocaleString("bn-BD")}</small>
        </div>

        <strong style="color:${credit ? "green" : "red"}">
          ${credit ? "+" : "-"}${money(item.amount)}
        </strong>
      </div>
    `;
  }).join("");
}

// =====================================
// SIGNUP
// =====================================

$("signupForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("signupName").value.trim();
  const email = $("signupEmail").value.trim();
  const password = $("signupPassword").value;

  if (!name || !email || password.length < 6) {
    return showMessage("নাম, সঠিক Email এবং কমপক্ষে ৬ অক্ষরের Password দিন");
  }

  const button = event.submitter;

  if (button) button.disabled = true;

  try {
    const credential = await auth.createUserWithEmailAndPassword(
      email,
      password
    );

    await credential.user.updateProfile({
      displayName: name
    });

    await provisionAccount(name);

    await loadWallet();

    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");

    showMessage("Account সফলভাবে তৈরি হয়েছে", true);

  } catch (error) {
    console.error("Signup error:", error);

    if (auth.currentUser) {
      try {
        // If Auth account exists but profile setup failed,
        // next login can retry provisioning.
        showMessage(
          "Signup হয়েছে, কিন্তু Wallet setup সম্পূর্ণ হয়নি। আবার Login করুন।"
        );
      } catch (_) {}
    } else {
      showMessage(error.message);
    }

  } finally {
    if (button) button.disabled = false;
  }
});

// =====================================
// LOGIN
// =====================================

$("loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  if (!email || !password) {
    return showMessage("Email ও Password লিখুন");
  }

  const button = event.submitter;

  if (button) button.disabled = true;

  try {
    await auth.signInWithEmailAndPassword(email, password);

    // loadWallet retries account provisioning
    // if the previous signup did not finish.
    await loadWallet();

    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");

  } catch (error) {
    console.error("Login error:", error);
    showMessage(error.message);

  } finally {
    if (button) button.disabled = false;
  }
});

// =====================================
// REFRESH WALLET
// =====================================

if ($("refreshBtn")) {
  $("refreshBtn").addEventListener("click", async () => {
    try {
      await loadWallet();
    } catch (error) {
      alert(error.message);
    }
  });
}

// =====================================
// LOGOUT
// =====================================

if ($("logoutBtn")) {
  $("logoutBtn").addEventListener("click", async () => {
    if (!confirm("Logout করতে চান?")) return;

    await auth.signOut();
    window.location.reload();
  });
}

// =====================================
// AUTH STATE
// =====================================

auth.onAuthStateChanged(async user => {
  if (!user) {
    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");
    return;
  }

  try {
    await loadWallet();

    $("authView").classList.add("hidden");
    $("appView").classList.remove("hidden");

  } catch (error) {
    console.error("Wallet loading:", error);

    $("authView").classList.remove("hidden");
    $("appView").classList.add("hidden");

    showMessage(error.message);
  }
});
