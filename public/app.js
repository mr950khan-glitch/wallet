
"use strict";

// =====================================
// XNCEER WALLET - APP.JS
// =====================================


// =====================================
// 1. FIREBASE INITIALIZATION
// =====================================

if (
  !window.firebaseConfig ||
  !window.firebaseConfig.apiKey ||
  window.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY"
) {
  alert("Firebase API Key সেট করুন!");
  throw new Error("Firebase configuration missing");
}

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}

const auth = firebase.auth();


// =====================================
// 2. DOM HELPERS
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
  return "৳" + Number(value || 0).toLocaleString("en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function showMessage(message, success = false) {
  const el = $("authMessage");

  if (!el) return;

  el.textContent = message;
  el.style.color = success ? "green" : "red";
}


// =====================================
// 3. APP VARIABLES
// =====================================

let currentBalance = 0;
let balanceVisible = true;

let currentSlide = 0;
let sliderTimer = null;


// =====================================
// 4. API REQUEST
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
// 5. LOGIN / SIGNUP VIEW
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

if ($("showSignup")) {
  $("showSignup").addEventListener("click", showSignup);
}

if ($("showLogin")) {
  $("showLogin").addEventListener("click", showLogin);
}


// =====================================
// 6. ACCOUNT PROVISION
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
    {
      name: name || user.displayName || "User"
    }
  );
}


// =====================================
// 7. BALANCE DISPLAY
// =====================================

function updateBalance(value) {

  currentBalance = Number(value || 0);

  const balance = $("balance");

  if (!balance) return;

  balance.dataset.balance = money(currentBalance);

  balance.textContent = balanceVisible
    ? money(currentBalance)
    : "৳ ••••••";
}


// =====================================
// 8. BALANCE SHOW / HIDE
// =====================================

if ($("toggleBalance")) {

  $("toggleBalance").addEventListener("click", () => {

    balanceVisible = !balanceVisible;

    updateBalance(currentBalance);

    $("toggleBalance").textContent =
      balanceVisible ? "◉" : "◎";

  });

}


// =====================================
// 9. LOAD WALLET
// =====================================

async function loadWallet() {

  const user = auth.currentUser;

  if (!user) return;

  let data;

  try {

    data = await apiRequest("/api/me");

  } catch (error) {

    if (
      error.message.includes("Account setup required") ||
      error.message.includes("Account creation")
    ) {

      await provisionAccount(
        user.displayName || "User"
      );

      data = await apiRequest("/api/me");

    } else {

      throw error;

    }
  }

  const profile = data.user || data.profile || {};
  const wallet = data.wallet || {};

  const name =
    profile.name ||
    user.displayName ||
    "User";

  const userId =
    profile.userId ||
    "Not available";

  const balance = Number(
    wallet.balance ?? data.balance ?? 0
  );

  // USER NAME

  if ($("userName")) {
    $("userName").textContent = name;
  }

  if ($("profileName")) {
    $("profileName").textContent = name;
  }

  // USER ID

  if ($("userId")) {
    $("userId").textContent = userId;
  }

  if ($("profileId")) {
    $("profileId").textContent = userId;
  }

  // EMAIL

  if ($("profileEmail")) {
    $("profileEmail").textContent =
      profile.email || user.email || "";
  }

  // BALANCE

  updateBalance(balance);

  // PROFILE PHOTO

  const photo = profile.photoURL || user.photoURL;

  if (photo && $("profilePhoto")) {
    $("profilePhoto").src = photo;
  }

  // TRANSACTIONS

  showTransactions(data.transactions || []);

}


// =====================================
// 10. TRANSACTION HISTORY
// =====================================

function formatDate(value) {

  if (!value) return "Date unavailable";

  let date;

  if (typeof value === "object" && value.seconds) {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString("bn-BD");
}


function showTransactions(transactions) {

  const container = $("transactionList");

  if (!container) return;

  if (
    !Array.isArray(transactions) ||
    transactions.length === 0
  ) {

    container.innerHTML =
      '<p class="empty">কোনো Transaction পাওয়া যায়নি।</p>';

    return;
  }

  container.innerHTML = transactions.map(item => {

    const credit = item.type === "credit";

    const reason = escapeHTML(
      item.reason ||
      item.description ||
      item.type ||
      "Transaction"
    );

    const number = escapeHTML(
      item.phoneNumber ||
      item.recipientNumber ||
      item.number ||
      ""
    );

    const transactionId = escapeHTML(
      item.transactionId ||
      item.id ||
      ""
    );

    const status = escapeHTML(
      item.status || "Completed"
    );

    const date = escapeHTML(
      formatDate(item.createdAt)
    );

    return `
      <div class="transaction">

        <div class="transaction-info">

          <strong>${reason}</strong>

          ${number ? `
            <small>নম্বর: ${number}</small>
          ` : ""}

          ${transactionId ? `
            <small>Transaction ID: ${transactionId}</small>
          ` : ""}

          <small>${date}</small>

          <small>Status: ${status}</small>

        </div>

        <strong class="${credit ? "success" : "error"}">
          ${credit ? "+" : "-"}${money(item.amount)}
        </strong>

      </div>
    `;

  }).join("");

}


// =====================================
// 11. SIGNUP
// =====================================

if ($("signupForm")) {

  $("signupForm").addEventListener("submit", async event => {

    event.preventDefault();

    const name = $("signupName").value.trim();

    const email = $("signupEmail").value.trim();

    const password = $("signupPassword").value;

    if (!name || !email || password.length < 6) {

      showMessage(
        "নাম, সঠিক Email এবং কমপক্ষে ৬ অক্ষরের Password দিন"
      );

      return;
    }

    const button = event.submitter;

    if (button) button.disabled = true;

    try {

      const credential =
        await auth.createUserWithEmailAndPassword(
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

      showMessage(
        "Account সফলভাবে তৈরি হয়েছে",
        true
      );

    } catch (error) {

      console.error("Signup error:", error);

      if (auth.currentUser) {

        showMessage(
          "Signup হয়েছে, কিন্তু Wallet setup সম্পূর্ণ হয়নি। আবার Login করুন।"
        );

      } else {

        showMessage(error.message);

      }

    } finally {

      if (button) button.disabled = false;

    }

  });

}


// =====================================
// 12. LOGIN
// =====================================

if ($("loginForm")) {

  $("loginForm").addEventListener("submit", async event => {

    event.preventDefault();

    const email = $("loginEmail").value.trim();

    const password = $("loginPassword").value;

    if (!email || !password) {

      showMessage("Email ও Password লিখুন");

      return;
    }

    const button = event.submitter;

    if (button) button.disabled = true;

    try {

      await auth.signInWithEmailAndPassword(
        email,
        password
      );

      await loadWallet();

      $("authView").classList.add("hidden");

      $("appView").classList.remove("hidden");

      startSlider();

    } catch (error) {

      console.error("Login error:", error);

      showMessage(error.message);

    } finally {

      if (button) button.disabled = false;

    }

  });

}


// =====================================
// 13. REFRESH BALANCE
// =====================================

if ($("refreshBtn")) {

  $("refreshBtn").addEventListener("click", async () => {

    const button = $("refreshBtn");

    button.disabled = true;

    button.textContent = "Loading...";

    try {

      await loadWallet();

    } catch (error) {

      alert(error.message);

    } finally {

      button.disabled = false;

      button.textContent = "↻ Refresh Balance";

    }

  });

}


// =====================================
// 14. LOGOUT
// =====================================

if ($("logoutBtn")) {

  $("logoutBtn").addEventListener("click", async () => {

    if (!confirm("Logout করতে চান?")) return;

    try {

      await auth.signOut();

      stopSlider();

      window.location.reload();

    } catch (error) {

      alert(error.message);

    }

  });

}


// =====================================
// 15. HOME SLIDER
// =====================================

function startSlider() {

  const slider = $("slides");

  if (!slider) return;

  const images = slider.querySelectorAll("img");

  if (images.length <= 1) return;

  // Prevent multiple timers

  stopSlider();

  currentSlide = 0;

  slider.style.transform = "translateX(0%)";

  sliderTimer = setInterval(() => {

    currentSlide =
      (currentSlide + 1) % images.length;

    slider.style.transform =
      `translateX(-${currentSlide * 100}%)`;

  }, 3000);

}


function stopSlider() {

  if (sliderTimer !== null) {

    clearInterval(sliderTimer);

    sliderTimer = null;

  }

}


// =====================================
// 16. AUTH STATE
// =====================================

auth.onAuthStateChanged(async user => {

  if (!user) {

    stopSlider();

    $("authView").classList.remove("hidden");

    $("appView").classList.add("hidden");

    return;
  }

  try {

    await loadWallet();

    $("authView").classList.add("hidden");

    $("appView").classList.remove("hidden");

    startSlider();

  } catch (error) {

    console.error("Wallet loading:", error);

    $("authView").classList.remove("hidden");

    $("appView").classList.add("hidden");

    showMessage(error.message);

  }

});


// =====================================
// 17. IMAGE ERROR HANDLING
// =====================================

document.querySelectorAll(".service img, .nav-item img")
  .forEach(img => {

    img.addEventListener("error", () => {

      img.style.opacity = "0.3";

    });

  });


// =====================================
// 18. APP READY
// =====================================

console.log("XNCEER Wallet App Loaded Successfully");
